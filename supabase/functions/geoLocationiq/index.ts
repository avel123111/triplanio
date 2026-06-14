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
import { getRequestUser } from '../_shared/supabaseAdmin.ts';

const LIQ_BASE = 'https://us1.locationiq.com/v1';
const DEFAULT_LIMIT = 12;

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
        limit: lim,
        'accept-language': acceptLang,
      });
      if (tag) params.set('tag', String(tag)); // e.g. 'place:city' to bias city results
      url = `${LIQ_BASE}/autocomplete?${params}`;
    } else {
      return Response.json({ error: `Unknown action: ${action}` }, { status: 400, headers: corsHeaders });
    }

    const res = await fetch(url, { headers: { accept: 'application/json' } });

    // LocationIQ returns 404 { error: "Unable to geocode" } when nothing matches.
    // Treat that as an empty result set (matches the old Nominatim `return []`).
    if (res.status === 404) {
      return Response.json({ results: [] }, { headers: corsHeaders });
    }
    if (!res.ok) {
      const text = await res.text().catch(() => '');
      console.error('[geoLocationiq] upstream error', action, res.status, text.slice(0, 300));
      return Response.json(
        { error: 'locationiq_upstream_error', status: res.status },
        { status: 502, headers: corsHeaders },
      );
    }

    const data = await res.json();
    const results = Array.isArray(data) ? data : (data?.error ? [] : (data ? [data] : []));
    return Response.json({ results }, { headers: corsHeaders });
  } catch (e) {
    console.error('geoLocationiq error:', e);
    return Response.json({ error: (e as Error).message }, { status: 500, headers: corsHeaders });
  }
});
