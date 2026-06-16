/**
 * geoLocationiq
 *
 * Thin proxy to the LocationIQ APIs (managed Nominatim/OSM), used to replace the
 * public Nominatim demo server (city/address search + reverse) and Google Places
 * autocomplete. LocationIQ data is OpenStreetMap (ODbL) and may be stored
 * permanently; on the Free plan a "Search by LocationIQ" backlink + OSM
 * attribution are required in the UI.
 *
 * Why a proxy: the LocationIQ key is a billable secret and the Free plan has no
 * HTTP-referrer key restriction, so the key must never reach the browser. The
 * client calls this function and we attach `LOCATIONIQ_API_KEY` server-side
 * (same pattern as stay22Accommodations + placesAutocomplete).
 *
 * POST body (one of):
 *   { action: 'search',       q, lang?, limit? }       → forward geocode
 *   { action: 'reverse',      lat, lon, lang? }         → reverse geocode
 *   { action: 'autocomplete', q, lang?, limit?, tag? }  → address/city autocomplete
 *
 * `lang` maps to LocationIQ `accept-language` (app locale for display names, or
 * 'en' to resolve the canonical English city name for Stay22 address search).
 *
 * Response: { results: <LocationIQ JSON array, pass-through> }.
 * Normalization into the app's city shape stays client-side in src/lib/geo.js
 * (LocationIQ mirrors the Nominatim response: place_id, lat, lon, display_name,
 * address{}, type, class, importance — so the existing mapping is reused).
 * Nothing is persisted here.
 */

import { corsHeaders } from '../_shared/cors.ts';
import { getRequestUser, supabaseAdmin } from '../_shared/supabaseAdmin.ts';

const LIQ_BASE = 'https://us1.locationiq.com/v1';
const DEFAULT_LIMIT = 12;

// Normalized Postgres cache key (TRIP-145). Cities are immutable, so the key is
// stable forever. search/autocomplete fold their text query to lowercase with
// collapsed whitespace; autocomplete also folds its `tag` bias in (it changes the
// result set). reverse rounds lat/lon to 5 decimals (~1 m). `lang` is keyed
// separately by the caller because display names come back localized.
function geocodeQueryKey(action: string, q: unknown, lat: unknown, lon: unknown, tag: unknown): string {
  if (action === 'reverse') {
    return `${Number(lat).toFixed(5)},${Number(lon).toFixed(5)}`;
  }
  let key = String(q).trim().toLowerCase().replace(/\s+/g, ' ');
  if (action === 'autocomplete' && tag) key += `|tag:${String(tag).trim().toLowerCase()}`;
  return key;
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });

  try {
    const user = await getRequestUser(req);
    if (!user) return Response.json({ error: 'Unauthorized' }, { status: 401, headers: corsHeaders });

    const apiKey = Deno.env.get('LOCATIONIQ_API_KEY');
    if (!apiKey) return Response.json({ error: 'LOCATIONIQ_API_KEY not configured' }, { status: 500, headers: corsHeaders });

    const body = await req.json();
    const { action, q, lat, lon, lang, limit, tag } = body;

    const acceptLang = (typeof lang === 'string' && lang.trim()) ? lang.trim() : 'en';
    const lim = String(limit && limit > 0 ? limit : DEFAULT_LIMIT);

    let url: string;
    if (action === 'search') {
      if (!q || !String(q).trim()) {
        return Response.json({ error: 'q is required' }, { status: 400, headers: corsHeaders });
      }
      const params = new URLSearchParams({
        key: apiKey,
        q: String(q),
        format: 'json',
        addressdetails: '1',
        namedetails: '1', // returns name:en / int_name / name → canonical English city name
        limit: lim,
        'accept-language': acceptLang,
      });
      url = `${LIQ_BASE}/search?${params}`;
    } else if (action === 'reverse') {
      if (lat === undefined || lat === null || lon === undefined || lon === null) {
        return Response.json({ error: 'lat and lon are required' }, { status: 400, headers: corsHeaders });
      }
      const params = new URLSearchParams({
        key: apiKey,
        lat: String(lat),
        lon: String(lon),
        format: 'json',
        addressdetails: '1',
        'accept-language': acceptLang,
      });
      url = `${LIQ_BASE}/reverse?${params}`;
    } else if (action === 'autocomplete') {
      if (!q || !String(q).trim()) {
        return Response.json({ error: 'q is required' }, { status: 400, headers: corsHeaders });
      }
      const params = new URLSearchParams({
        key: apiKey,
        q: String(q),
        namedetails: '1', // returns name:en / int_name / name → canonical English city name
        limit: lim,
        'accept-language': acceptLang,
      });
      if (tag) params.set('tag', String(tag)); // e.g. 'place:city' to bias city results
      url = `${LIQ_BASE}/autocomplete?${params}`;
    } else {
      return Response.json({ error: `Unknown action: ${action}` }, { status: 400, headers: corsHeaders });
    }

    // --- Cache read (TRIP-145) -------------------------------------------------
    // Cities are immutable → a hit is served straight from Postgres and never
    // touches LocationIQ, removing ~90% of upstream traffic and the shared
    // rate-limit pressure that turns into 502 → unresolved (red) cities.
    const queryKey = geocodeQueryKey(action, q, lat, lon, tag);
    const { data: cached } = await supabaseAdmin
      .from('geocode_cache')
      .select('id, results, hit_count')
      .eq('action', action)
      .eq('query_key', queryKey)
      .eq('lang', acceptLang)
      .maybeSingle();
    if (cached) {
      // Best-effort usage bump (single indexed update, far cheaper than the
      // upstream call it replaces). Awaited for reliability; analytics only.
      await supabaseAdmin
        .from('geocode_cache')
        .update({ hit_count: (cached.hit_count ?? 0) + 1, last_used_at: new Date().toISOString() })
        .eq('id', cached.id);
      return Response.json({ results: cached.results }, { headers: corsHeaders });
    }

    const res = await fetch(url, { headers: { accept: 'application/json' } });

    // Upstream errors (429 rate-limit → ... , 5xx) are NEVER cached, so a
    // transient rate-limit blip can't poison the cache. Only genuine 200
    // responses (data OR a real 404 "no match") are written.
    let results: unknown[];
    if (res.status === 404) {
      // LocationIQ returns 404 { error: "Unable to geocode" } when nothing
      // matches. Treat as an empty result set (matches the old Nominatim
      // `return []`) and cache it — a real no-match is stable, and the 429
      // rate-limit path is a 502 below, never reaching here.
      results = [];
    } else if (!res.ok) {
      const text = await res.text().catch(() => '');
      console.error('[geoLocationiq] upstream error', action, res.status, text.slice(0, 300));
      return Response.json(
        { error: 'locationiq_upstream_error', status: res.status },
        { status: 502, headers: corsHeaders },
      );
    } else {
      const data = await res.json();
      results = Array.isArray(data) ? data : (data?.error ? [] : (data ? [data] : []));
    }

    // Cache write (TRIP-145). Upsert so a concurrent miss for the same key just
    // overwrites with identical data (no lock needed). Failures here are
    // non-fatal — we still return the fresh results.
    const { error: cacheErr } = await supabaseAdmin
      .from('geocode_cache')
      .upsert(
        { action, query_key: queryKey, lang: acceptLang, results, last_used_at: new Date().toISOString() },
        { onConflict: 'action,query_key,lang' },
      );
    if (cacheErr) console.error('[geoLocationiq] cache write failed', action, cacheErr.message);

    return Response.json({ results }, { headers: corsHeaders });
  } catch (e) {
    console.error('geoLocationiq error:', e);
    return Response.json({ error: (e as Error).message }, { status: 500, headers: corsHeaders });
  }
});
