/**
 * geoLocationiq
 *
 * Thin proxy to the LocationIQ APIs (managed Nominatim/OSM): city/address search
 * + reverse + autocomplete. The LocationIQ key is a billable secret with no
 * HTTP-referrer restriction on Free, so it must never reach the browser — the
 * client calls this function and we attach `LOCATIONIQ_API_KEY` server-side.
 *
 * POST body (one of):
 *   { action: 'search',        q, lang?, limit? }                       → forward geocode (city), cached
 *   { action: 'reverse',       lat, lon, lang? }                        → reverse geocode, cached
 *   { action: 'autocomplete',  q, lang?, limit?, tag? }                 → address autocomplete, NOT cached
 *   { action: 'resolveCities', cities: [{ q, lang? }], priority? }      → batch city resolve, cached (shares 'search')
 *   { action: 'geocodeAddress', q, lang?, priority? }                   → forward geocode (street address), NOT cached
 *
 * Response: { results } for single actions; { results: Array<Array>, degraded }
 * for resolveCities. Normalization into the app's city shape stays client-side
 * in src/lib/geo.js.
 *
 * TRIP-145 caching (P1): cities are immutable → search/reverse/resolveCities are
 * cached in `geocode_cache` forever (a hit never touches LocationIQ). autocomplete
 * and geocodeAddress are addresses (high cardinality, ~zero cross-user reuse) →
 * never cached; their rate is held by the token bucket instead.
 *
 * TRIP-145 throttle (P2): one shared Postgres token bucket (`take_geocode_token`)
 * caps the single-key LocationIQ rate across all browsers/entry points. A token
 * is taken ONLY before a real upstream call (cache hits skip it). Interactive
 * callers (autocomplete, manual search) have priority over background ones (AI
 * batch, booking-address resolve) via `p_min`.
 */

import { corsHeaders } from '../_shared/cors.ts';
import { getRequestUser, supabaseAdmin } from '../_shared/supabaseAdmin.ts';
import { captureEdgeError } from '../_shared/sentry.ts';

const LIQ_BASE = 'https://us1.locationiq.com/v1';
const DEFAULT_LIMIT = 12;

// Normalize a text query to a stable cache key: lowercase, collapsed whitespace.
function normKey(q: unknown): string {
  return String(q).trim().toLowerCase().replace(/\s+/g, ' ');
}

// Cache key for a single action. reverse rounds lat/lon to ~1 m (cities don't
// move); search/autocomplete fold the text query; autocomplete also folds its
// `tag` bias (it changes the result set).
function geocodeQueryKey(action: string, q: unknown, lat: unknown, lon: unknown, tag: unknown): string {
  if (action === 'reverse') return `${Number(lat).toFixed(5)},${Number(lon).toFixed(5)}`;
  let key = normKey(q);
  if (action === 'autocomplete' && tag) key += `|tag:${String(tag).trim().toLowerCase()}`;
  return key;
}

// ── Token bucket (TRIP-145 P2) ───────────────────────────────────────────────
// Take one token from the shared Postgres bucket. Interactive=1 (may drain to
// zero), background=2 (only takes with headroom). Fail-open: if the limiter
// itself errors, don't block geocoding.
async function takeToken(priority: string): Promise<boolean> {
  const p_min = priority === 'background' ? 2 : 1;
  const { data, error } = await supabaseAdmin.rpc('take_geocode_token', { p_min });
  if (error) {
    console.error('[geoLocationiq] take_geocode_token failed', error.message);
    return true;
  }
  return data === true;
}

// Wait briefly for a token, then give up (caller degrades). Total ≤ ~1.2 s,
// well under the edge wall-clock/idle limits; the sleep is async I/O, so it does
// NOT count against the per-request CPU limit.
async function acquireToken(priority: string): Promise<boolean> {
  const waits = priority === 'background' ? [0, 300, 500] : [0, 250, 450, 500];
  for (let i = 0; i < waits.length; i++) {
    if (waits[i]) await new Promise((r) => setTimeout(r, waits[i]));
    if (await takeToken(priority)) return true;
  }
  return false;
}

function buildUrl(
  endpoint: string,
  apiKey: string,
  p: { q?: unknown; lat?: unknown; lon?: unknown; lang: string; limit: string; tag?: unknown },
): string {
  if (endpoint === 'reverse') {
    const params = new URLSearchParams({
      key: apiKey, lat: String(p.lat), lon: String(p.lon),
      format: 'json', addressdetails: '1', 'accept-language': p.lang,
    });
    return `${LIQ_BASE}/reverse?${params}`;
  }
  if (endpoint === 'autocomplete') {
    const params = new URLSearchParams({
      key: apiKey, q: String(p.q), namedetails: '1', limit: p.limit, 'accept-language': p.lang,
    });
    if (p.tag) params.set('tag', String(p.tag)); // e.g. 'place:city' to bias city results
    return `${LIQ_BASE}/autocomplete?${params}`;
  }
  // search — also used by resolveCities items and geocodeAddress.
  const params = new URLSearchParams({
    key: apiKey, q: String(p.q), format: 'json', addressdetails: '1',
    namedetails: '1', limit: p.limit, 'accept-language': p.lang,
  });
  return `${LIQ_BASE}/search?${params}`;
}

// Parse a LocationIQ response into a results array; null = transient upstream
// error (NOT cached, surfaced as 502). 404 = genuine no-match → [].
async function parseUpstream(res: Response): Promise<unknown[] | null> {
  if (res.status === 404) return [];
  if (!res.ok) return null;
  const data = await res.json();
  return Array.isArray(data) ? data : (data?.error ? [] : (data ? [data] : []));
}

type ResolveOutcome = { results: unknown[] } | { degraded: true } | { upstreamError: number };

// Resolve one lookup: cache read (cacheable only) → token → upstream → cache write.
async function resolveOne(
  endpoint: string,
  cacheKeyAction: string | null, // null = uncached (autocomplete / geocodeAddress)
  queryKey: string,
  lang: string,
  priority: string,
  urlParams: { q?: unknown; lat?: unknown; lon?: unknown; limit: string; tag?: unknown },
  apiKey: string,
): Promise<ResolveOutcome> {
  if (cacheKeyAction) {
    const { data: cached } = await supabaseAdmin
      .from('geocode_cache')
      .select('id, results, hit_count')
      .eq('action', cacheKeyAction).eq('query_key', queryKey).eq('lang', lang)
      .maybeSingle();
    if (cached) {
      // Fire-and-forget usage bump — never pay a write on the hot read path.
      supabaseAdmin
        .from('geocode_cache')
        .update({ hit_count: (cached.hit_count ?? 0) + 1, last_used_at: new Date().toISOString() })
        .eq('id', cached.id)
        .then(() => {}, () => {});
      return { results: cached.results as unknown[] };
    }
  }

  // Real upstream call → take a token first.
  if (!(await acquireToken(priority))) return { degraded: true };

  const url = buildUrl(endpoint, apiKey, { ...urlParams, lang });
  const res = await fetch(url, { headers: { accept: 'application/json' } });
  const results = await parseUpstream(res);
  if (results === null) {
    console.error('[geoLocationiq] upstream error', endpoint, res.status);
    return { upstreamError: res.status };
  }

  if (cacheKeyAction) {
    const { error } = await supabaseAdmin
      .from('geocode_cache')
      .upsert(
        { action: cacheKeyAction, query_key: queryKey, lang, results, last_used_at: new Date().toISOString() },
        { onConflict: 'action,query_key,lang' },
      );
    if (error) console.error('[geoLocationiq] cache write failed', cacheKeyAction, error.message);
  }
  return { results };
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });

  try {
    const user = await getRequestUser(req);
    if (!user) return Response.json({ error: 'Unauthorized' }, { status: 401, headers: corsHeaders });

    const apiKey = Deno.env.get('LOCATIONIQ_API_KEY');
    if (!apiKey) return Response.json({ error: 'LOCATIONIQ_API_KEY not configured' }, { status: 500, headers: corsHeaders });

    const body = await req.json();
    const { action, q, lat, lon, lang, limit, tag, cities, priority } = body;

    const acceptLang = (typeof lang === 'string' && lang.trim()) ? lang.trim() : 'en';
    const lim = String(limit && limit > 0 ? limit : DEFAULT_LIMIT);

    // ── Batch city resolve: one call resolves all trip cities, dedups identical
    // queries, shares the 'search' cache. Background priority by default.
    if (action === 'resolveCities') {
      if (!Array.isArray(cities)) {
        return Response.json({ error: 'cities[] is required' }, { status: 400, headers: corsHeaders });
      }
      const prio = priority || 'background';
      const memo = new Map<string, unknown[]>();
      let degraded = false;
      const out: unknown[][] = [];
      for (const c of cities) {
        const cq = c?.q;
        if (!cq || !String(cq).trim()) { out.push([]); continue; }
        const cLang = (typeof c?.lang === 'string' && c.lang.trim()) ? c.lang.trim() : acceptLang;
        const key = `${normKey(cq)}|${cLang}`;
        if (memo.has(key)) { out.push(memo.get(key)!); continue; }
        const r = await resolveOne('search', 'search', normKey(cq), cLang, prio, { q: cq, limit: lim }, apiKey);
        const arr = 'results' in r ? r.results : [];
        if ('degraded' in r) degraded = true;
        memo.set(key, arr);
        out.push(arr);
      }
      if (degraded) {
        await captureEdgeError(new Error('geocode bucket exhausted'), 'geoLocationiq', { action: 'resolveCities', count: cities.length });
      }
      return Response.json({ results: out, degraded }, { headers: corsHeaders });
    }

    // ── Single-shot actions ──
    let endpoint: string;
    let cacheKeyAction: string | null;
    let defaultPrio = 'interactive';
    if (action === 'search') {
      endpoint = 'search'; cacheKeyAction = 'search';
    } else if (action === 'reverse') {
      if (lat === undefined || lat === null || lon === undefined || lon === null) {
        return Response.json({ error: 'lat and lon are required' }, { status: 400, headers: corsHeaders });
      }
      endpoint = 'reverse'; cacheKeyAction = 'reverse';
    } else if (action === 'autocomplete') {
      endpoint = 'autocomplete'; cacheKeyAction = null; // addresses → never cached
    } else if (action === 'geocodeAddress') {
      endpoint = 'search'; cacheKeyAction = null; defaultPrio = 'background'; // addresses → never cached
    } else {
      return Response.json({ error: `Unknown action: ${action}` }, { status: 400, headers: corsHeaders });
    }

    if (endpoint !== 'reverse' && (!q || !String(q).trim())) {
      return Response.json({ error: 'q is required' }, { status: 400, headers: corsHeaders });
    }

    const prio = priority || defaultPrio;
    const queryKey = geocodeQueryKey(action, q, lat, lon, tag);
    const outcome = await resolveOne(endpoint, cacheKeyAction, queryKey, acceptLang, prio, { q, lat, lon, limit: lim, tag }, apiKey);

    if ('degraded' in outcome) {
      // Bucket exhausted even after the short wait → degrade. Client retries
      // (TRIP-160). Surface a 429 + Retry-After rather than a fake empty 200.
      await captureEdgeError(new Error('geocode bucket exhausted'), 'geoLocationiq', { action });
      return Response.json(
        { error: 'geocode_rate_limited', results: [] },
        { status: 429, headers: { ...corsHeaders, 'Retry-After': '2' } },
      );
    }
    if ('upstreamError' in outcome) {
      return Response.json(
        { error: 'locationiq_upstream_error', status: outcome.upstreamError },
        { status: 502, headers: corsHeaders },
      );
    }
    return Response.json({ results: outcome.results }, { headers: corsHeaders });
  } catch (e) {
    console.error('geoLocationiq error:', e);
    await captureEdgeError(e, 'geoLocationiq');
    return Response.json({ error: (e as Error).message }, { status: 500, headers: corsHeaders });
  }
});
