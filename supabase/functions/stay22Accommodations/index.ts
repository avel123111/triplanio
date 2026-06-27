/**
 * stay22Accommodations
 *
 * Thin proxy to the Stay22 Accommodations API (v2 beta), used by the trip
 * editor's hotel "fork" side-panel to show real bookable stays for a city.
 *
 * Why a proxy: Stay22 v2 authenticates with an `X-API-KEY` header. The key must
 * never reach the browser, so the client calls this function and we attach the
 * secret server-side (same pattern as placesAutocomplete + GOOGLE_MAPS_API_KEY).
 *
 * POST body:
 *   { lat, lng, radius?, checkin?, checkout?, currency?, lang?, page?,
 *     adults?, children? }
 *
 * Search is by coordinates (lat/lng). We pin provider=booking, aid=triplanio,
 * campaign=fork_api_sidepanel, pageSize=10, cluster=false. `rooms` is not sent.
 *
 * Returns the Stay22 payload pass-through: { meta, _links, results }.
 * Nothing is persisted — the side-panel fetches on open and renders client-side.
 */

import { corsFor } from '../_shared/cors.ts';
import { getRequestUser } from '../_shared/supabaseAdmin.ts';

const STAY22_BASE = 'https://api.stay22.com/v2/accommodations';
const AID = 'triplanio';
const CAMPAIGN = 'fork_api_sidepanel';
const PAGE_SIZE = 10;

Deno.serve(async (req) => {
  const corsHeaders = corsFor(req);
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });

  try {
    const user = await getRequestUser(req);
    if (!user) return Response.json({ error: 'Unauthorized' }, { status: 401, headers: corsHeaders });

    const apiKey = Deno.env.get('STAY22_API_KEY');
    if (!apiKey) return Response.json({ error: 'STAY22_API_KEY not configured' }, { status: 500, headers: corsHeaders });

    const body = await req.json();
    const { lat, lng, address, radius, checkin, checkout, currency, lang, page, adults, children, rooms, min, max } = body;

    const hasCoords = lat !== undefined && lat !== null && lng !== undefined && lng !== null;
    if (!hasCoords && !address) {
      return Response.json({ error: 'lat/lng or address is required' }, { status: 400, headers: corsHeaders });
    }

    const params = new URLSearchParams({
      provider: 'booking',
      pageSize: String(PAGE_SIZE),
      page: String(page && page > 0 ? page : 1),
      aid: AID,
      campaign: CAMPAIGN,
      cluster: 'false',
      adults: String(adults ?? 2),
      children: String(children ?? 0),
    });
    // Geo method: prefer address search when available (more reliable than
    // lat/lng for some cities — see TRIP-85). Fall back to coordinates.
    if (address) {
      params.set('address', String(address));
    } else {
      params.set('lat', String(lat));
      params.set('lng', String(lng));
    }
    if (radius) params.set('radius', String(radius));
    if (checkin) params.set('checkin', String(checkin));
    if (checkout) params.set('checkout', String(checkout));
    if (currency) params.set('currency', String(currency));
    if (lang) params.set('lang', String(lang));
    // Optional filters (only sent when the user applies them in the panel).
    // rooms: omitted by default; min/max: per-night price in USD per Stay22 docs.
    if (rooms) params.set('rooms', String(rooms));
    if (min != null && min !== '') params.set('min', String(min));
    if (max != null && max !== '') params.set('max', String(max));

    const res = await fetch(`${STAY22_BASE}?${params}`, {
      headers: { 'X-API-KEY': apiKey, accept: 'application/json' },
    });

    if (!res.ok) {
      const text = await res.text().catch(() => '');
      console.error('[stay22Accommodations] upstream error', res.status, text.slice(0, 500));
      return Response.json(
        { error: 'stay22_upstream_error', status: res.status },
        { status: 502, headers: corsHeaders },
      );
    }

    const data = await res.json();
    return Response.json(
      { meta: data.meta ?? null, _links: data._links ?? null, results: data.results ?? [] },
      { headers: corsHeaders },
    );
  } catch (e) {
    console.error('stay22Accommodations error:', e);
    return Response.json({ error: (e as Error).message }, { status: 500, headers: corsHeaders });
  }
});
