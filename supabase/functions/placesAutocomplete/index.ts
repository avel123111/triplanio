/**
 * placesAutocomplete
 *
 * POST body: { action, ...params }
 *
 * Actions:
 *   - "autocomplete": { input, sessionToken? } → Google Places Autocomplete predictions
 *   - "details":      { placeId, sessionToken? } → Place details (name, address, geometry)
 *   - "timezone":     { lat, lng, timestamp? } → Google Time Zone API
 *
 * Proxies to Google Maps APIs using GOOGLE_MAPS_API_KEY.
 */

import { corsHeaders } from '../_shared/cors.ts';
import { getRequestUser } from '../_shared/supabaseAdmin.ts';

const BASE_MAPS = 'https://maps.googleapis.com/maps/api';

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });

  try {
    const user = await getRequestUser(req);
    if (!user) return Response.json({ error: 'Unauthorized' }, { status: 401, headers: corsHeaders });

    const apiKey = Deno.env.get('GOOGLE_MAPS_API_KEY');
    if (!apiKey) return Response.json({ error: 'GOOGLE_MAPS_API_KEY not configured' }, { status: 500, headers: corsHeaders });

    const body = await req.json();
    const { action } = body;

    if (action === 'autocomplete') {
      const { input, sessionToken, types, language } = body;
      if (!input) return Response.json({ error: 'input is required' }, { status: 400, headers: corsHeaders });

      const params = new URLSearchParams({
        input,
        key: apiKey,
        language: language || 'en',
      });
      // Only restrict result types when the caller asks (e.g. types:'(cities)'
      // for a city picker). Address fields send nothing → full street/POI results.
      if (types) params.set('types', types);
      if (sessionToken) params.set('sessiontoken', sessionToken);

      const res = await fetch(`${BASE_MAPS}/place/autocomplete/json?${params}`);
      const data = await res.json();

      return Response.json({ predictions: data.predictions || [] }, { headers: corsHeaders });
    }

    if (action === 'details') {
      const { placeId, sessionToken, language } = body;
      if (!placeId) return Response.json({ error: 'placeId is required' }, { status: 400, headers: corsHeaders });

      // NB: `utc_offset_minutes` is a Places API (NEW) field name. The legacy
      // place/details/json endpoint rejects it and fails the WHOLE request with
      // INVALID_REQUEST (result:null → no coords). Keep only legacy field names.
      // language is taken from the caller (was hardcoded 'en' → address always
      // came back English regardless of the user's locale).
      const params = new URLSearchParams({
        place_id: placeId,
        key: apiKey,
        fields: 'name,formatted_address,geometry,address_components',
        language: language || 'en',
      });
      if (sessionToken) params.set('sessiontoken', sessionToken);

      const res = await fetch(`${BASE_MAPS}/place/details/json?${params}`);
      const data = await res.json();
      if (!data.result) {
        console.error('[placesAutocomplete details] no result', JSON.stringify({ status: data.status, error_message: data.error_message }));
      }

      return Response.json(
        { result: data.result || null, status: data.status ?? null, error_message: data.error_message ?? null },
        { headers: corsHeaders },
      );
    }

    if (action === 'timezone') {
      const { lat, lng, timestamp } = body;
      if (lat === undefined || lng === undefined) {
        return Response.json({ error: 'lat and lng are required' }, { status: 400, headers: corsHeaders });
      }

      const ts = timestamp ?? Math.floor(Date.now() / 1000);
      const params = new URLSearchParams({
        location: `${lat},${lng}`,
        timestamp: String(ts),
        key: apiKey,
      });

      const res = await fetch(`${BASE_MAPS}/timezone/json?${params}`);
      const data = await res.json();

      return Response.json(data, { headers: corsHeaders });
    }

    return Response.json({ error: `Unknown action: ${action}` }, { status: 400, headers: corsHeaders });

  } catch (e) {
    console.error('placesAutocomplete error:', e);
    return Response.json(
      { error: (e as Error).message },
      { status: 500, headers: corsHeaders },
    );
  }
});
