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

import { corsFor } from '../_shared/cors.ts';
import { getRequestUser, supabaseAdmin } from '../_shared/supabaseAdmin.ts';
import { captureEdgeError } from '../_shared/sentry.ts';

const LIQ_BASE = 'https://us1.locationiq.com/v1';
const DEFAULT_LIMIT = 12;

// Normalize a text query to a stable cache key: lowercase, collapsed whitespace.
function normKey(q: unknown): string {
  return String(q).trim().toLowerCase().replace(/\s+/g, ' ');
}

// Cache key for a cacheable action. reverse rounds lat/lon to ~1 m (cities don't
// move); search folds the text query. autocomplete/geocodeAddress are uncached,
// so their key is never used — no per-action folding needed here.
function geocodeQueryKey(action: string, q: unknown, lat: unknown, lon: unknown): string {
  if (action === 'reverse') return `${Number(lat).toFixed(5)},${Number(lon).toFixed(5)}`;
  return normKey(q);
}

// ── Fair FIFO admission (TRIP-145 P2 follow-up) ──────────────────────────────
// The shared Postgres token bucket caps the single-key LocationIQ rate; a ticket
// queue in front of it (geocode_queue) serves waiters in arrival order —
// interactive ahead of background, FIFO within a priority — instead of letting
// over-capacity callers time out at random. priority → p_min: background needs
// headroom (2), interactive may drain to zero (1). All three calls fail-open: a
// limiter error must never block geocoding.
function priorityNum(priority: string): number {
  return priority === 'background' ? 2 : 1;
}

async function enqueueTicket(priority: string): Promise<number | null> {
  const { data, error } = await supabaseAdmin.rpc('geocode_enqueue', { p_priority: priorityNum(priority) });
  if (error) {
    console.error('[geoLocationiq] geocode_enqueue failed', error.message);
    return null;
  }
  return data == null ? null : Number(data);
}

async function serveTicket(ticket: number, priority: string): Promise<boolean> {
  const { data, error } = await supabaseAdmin.rpc('geocode_serve_fair', { p_ticket: ticket, p_min: priorityNum(priority) });
  if (error) {
    console.error('[geoLocationiq] geocode_serve_fair failed', error.message);
    return false;
  }
  return data === true;
}

// Fire-and-forget — giving up the slot must not add latency to the caller.
function dequeueTicket(ticket: number): void {
  supabaseAdmin.rpc('geocode_dequeue', { p_ticket: ticket }).then(() => {}, () => {});
}

// Per-request token-wait budget. Background waits patiently so batches (AI
// cities, booking addresses, layovers) RESOLVE instead of going red; the budget
// is shared across a whole request (all cities in resolveCities), so total
// wall-clock stays bounded well under the edge/gateway limit even for big trips.
// Interactive (autocomplete / manual search) stays snappy — it rarely waits at
// all because background yields to it (p_min). Sleeping is async I/O → no CPU cost.
const TOKEN_WAIT_MS = { background: 20000, interactive: 3000 } as const;

// Take a ticket, then poll until we're the queue head with a free token or the
// request `deadline` passes (only then does the caller degrade). Jittered to
// avoid lock-step polling on the bucket row. A successful serve removes the
// ticket itself; on give-up we dequeue so a dead waiter never blocks the line.
async function acquireToken(priority: string, deadline: number): Promise<boolean> {
  const ticket = await enqueueTicket(priority);
  if (ticket == null) return true; // fail-open: queue unavailable → don't block
  if (await serveTicket(ticket, priority)) return true;
  while (Date.now() < deadline) {
    await new Promise((r) => setTimeout(r, 200 + Math.random() * 200));
    if (await serveTicket(ticket, priority)) return true;
  }
  dequeueTicket(ticket);
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
  deadline: number,
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

  // Real upstream call → take a token first (waits up to the request deadline).
  if (!(await acquireToken(priority, deadline))) return { degraded: true };

  const url = buildUrl(endpoint, apiKey, { ...urlParams, lang });
  const res = await fetch(url, { headers: { accept: 'application/json' } });
  const results = await parseUpstream(res);
  if (results === null) {
    console.error('[geoLocationiq] upstream error', endpoint, res.status);
    return { upstreamError: res.status };
  }

  // Only cache NON-EMPTY results. Empty (zero-match) responses are dominated by
  // typos and abandoned partial queries from the city search box; caching them
  // would permanently pollute geocode_cache with dead rows that are never reused.
  // Skipping them also gives a genuinely-missing city another chance next time
  // (a 404 here can be transient), rather than pinning it to an empty hit.
  if (cacheKeyAction && Array.isArray(results) && results.length > 0) {
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

// Batch item resolve with bounded retry on a TRANSIENT upstream failure
// (LocationIQ 429/5xx). TRIP-145 follow-up: the single-shot path is retried by
// the FE `liq()` backoff + a surfaced 502, but the batch path used to swallow a
// per-item `upstreamError` as `[]` (city goes red, no retry, no signal) — the
// exact failure when a cold batch's burst trips LocationIQ's own ~2 req/s limit.
// A genuine no-match returns `{ results: [] }` and is NOT retried. `degraded`
// means the rate budget is already spent (acquireToken waited to the deadline),
// so retrying can't help → stop. Retries share the batch `deadline`, so one
// flaky city can't drain the whole budget and starve later cities.
const BATCH_ITEM_MAX_RETRIES = 2;
async function resolveBatchItem(
  queryKey: string,
  lang: string,
  priority: string,
  urlParams: { q?: unknown; limit: string },
  apiKey: string,
  deadline: number,
): Promise<{ results: unknown[]; failed: boolean }> {
  for (let attempt = 0; ; attempt++) {
    const r = await resolveOne('search', 'search', queryKey, lang, priority, urlParams, apiKey, deadline);
    if ('results' in r) return { results: r.results, failed: false };
    if ('degraded' in r || attempt >= BATCH_ITEM_MAX_RETRIES || Date.now() >= deadline) {
      return { results: [], failed: true };
    }
    // Back off so LocationIQ's own 1 s window clears before we re-take a token.
    await new Promise((res) => setTimeout(res, 700 + Math.random() * 300));
    if (Date.now() >= deadline) return { results: [], failed: true };
  }
}

// ── Local directory (TRIP-145 P3) ────────────────────────────────────────────
// resolveCities first asks the curated `cities` table by (name_en, country_code)
// via resolve_cities_local. A hit returns coords with NO upstream call. We shape
// the hit back into a LocationIQ/Nominatim-style row so the client's refineCities
// path consumes it unchanged; external_city_id becomes a stable `dir:<id>` (an
// opaque identity key client-side). city_id/viator are re-attached at save by
// the existing coords trigger (set_city_id), so nothing is plumbed here.
function directoryRow(h: { city_id: number; name_en: string; country_code: string; lat: number; lng: number }): Record<string, unknown> {
  return {
    place_id: `dir:${h.city_id}`,
    lat: String(h.lat),
    lon: String(h.lng),
    display_name: h.name_en,
    name: h.name_en,
    namedetails: { 'name:en': h.name_en },
    address: { country_code: String(h.country_code || '').toLowerCase() },
    type: 'city',
    class: 'place',
    importance: 1,
  };
}

// Pick the most relevant row's coords from a LocationIQ result array (highest
// importance with finite lat/lon). Used only to seed the directory (learn_city).
function bestCoords(rows: unknown[]): { lat: number; lng: number } | null {
  let best: { lat: number; lng: number } | null = null;
  let bestImp = -Infinity;
  for (const d of (rows || []) as Array<{ lat?: unknown; lon?: unknown; importance?: unknown }>) {
    const lat = parseFloat(String(d?.lat));
    const lng = parseFloat(String(d?.lon));
    if (!Number.isFinite(lat) || !Number.isFinite(lng)) continue;
    const imp = Number(d?.importance) || 0;
    if (imp > bestImp) { bestImp = imp; best = { lat, lng }; }
  }
  return best;
}

Deno.serve(async (req) => {
  const corsHeaders = corsFor(req);
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
      // One shared deadline for the whole batch → bounded total wall-clock.
      const deadline = Date.now() + TOKEN_WAIT_MS[prio === 'background' ? 'background' : 'interactive'];

      // (C) Directory-first: one RPC resolves the whole batch by name → hits skip
      // LocationIQ entirely. Fail-open: a limiter/RPC error just falls through to
      // the geocoder for every city (old behaviour).
      let dir: Array<{ city_id: number; name_en: string; country_code: string; lat: number; lng: number } | null> = [];
      try {
        const { data: dirData } = await supabaseAdmin.rpc('resolve_cities_local', {
          p_items: cities.map((c: { name_en?: unknown; country_code?: unknown }) => ({
            name_en: c?.name_en ?? null,
            country_code: c?.country_code ?? null,
          })),
        });
        if (Array.isArray(dirData)) dir = dirData;
      } catch (e) {
        console.error('[geoLocationiq] resolve_cities_local failed', (e as Error).message);
      }

      const memo = new Map<string, unknown[]>();
      let degraded = false;
      const out: unknown[][] = [];
      for (let i = 0; i < cities.length; i++) {
        const c = cities[i];
        const hit = dir[i];
        if (hit && hit.lat != null && hit.lng != null) {
          out.push([directoryRow(hit)]);
          continue;
        }
        const cq = c?.q;
        if (!cq || !String(cq).trim()) { out.push([]); continue; }
        const cLang = (typeof c?.lang === 'string' && c.lang.trim()) ? c.lang.trim() : acceptLang;
        const key = `${normKey(cq)}|${cLang}`;
        if (memo.has(key)) { out.push(memo.get(key)!); continue; }
        const item = await resolveBatchItem(normKey(cq), cLang, prio, { q: cq, limit: lim }, apiKey, deadline);
        if (item.failed) degraded = true; // rate budget spent OR upstream error after retries
        // (#4) Self-heal: a fresh successful resolve of a city the directory did
        // not have → promote it so the next lookup hits the directory. Gated on a
        // name_en + country_code from the caller; fire-and-forget.
        if (!item.failed && item.results.length && c?.name_en && c?.country_code) {
          const best = bestCoords(item.results);
          if (best) {
            supabaseAdmin.rpc('learn_city', {
              p_name_en: c.name_en,
              p_country_code: c.country_code,
              p_lat: best.lat,
              p_lng: best.lng,
            }).then(() => {}, () => {});
          }
        }
        memo.set(key, item.results);
        out.push(item.results);
      }
      if (degraded) {
        await captureEdgeError(new Error('geocode batch had unresolved items'), 'geoLocationiq', { action: 'resolveCities', count: cities.length });
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
    const deadline = Date.now() + TOKEN_WAIT_MS[prio === 'background' ? 'background' : 'interactive'];
    const queryKey = geocodeQueryKey(action, q, lat, lon);
    const outcome = await resolveOne(endpoint, cacheKeyAction, queryKey, acceptLang, prio, { q, lat, lon, limit: lim, tag }, apiKey, deadline);

    if ('degraded' in outcome) {
      // Bucket still empty after the full wait budget (pathological load) →
      // degrade. Surface a 429 + Retry-After rather than a fake empty 200.
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
