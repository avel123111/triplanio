import { createClientFromRequest } from 'npm:@base44/sdk@0.8.25';

/**
 * Google Places API proxy.
 *
 * Body:
 *   { action: 'autocomplete', input: string, language?: string, sessionToken?: string }
 *   { action: 'details', place_id: string, sessionToken?: string }
 *
 * Returns:
 *   For autocomplete: { predictions: [{ place_id, description, main_text, secondary_text }] }
 *   For details:      { place_id, formatted_address, name, latitude, longitude }
 */
Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me();
    if (!user) return Response.json({ error: 'Unauthorized' }, { status: 401 });

    const apiKey = Deno.env.get('GOOGLE_MAPS_API_KEY');
    if (!apiKey) return Response.json({ error: 'GOOGLE_MAPS_API_KEY not set' }, { status: 500 });

    const body = await req.json().catch(() => ({}));
    const action = body?.action;

    if (action === 'autocomplete') {
      const input = (body?.input || '').toString().trim();
      if (!input) return Response.json({ predictions: [] });
      const language = (body?.language || 'en').toString();
      const sessionToken = body?.sessionToken || undefined;
      const url = new URL('https://maps.googleapis.com/maps/api/place/autocomplete/json');
      url.searchParams.set('input', input);
      url.searchParams.set('language', language);
      url.searchParams.set('key', apiKey);
      if (sessionToken) url.searchParams.set('sessiontoken', sessionToken);
      const resp = await fetch(url.toString());
      const data = await resp.json();
      if (data.status !== 'OK' && data.status !== 'ZERO_RESULTS') {
        return Response.json({ error: data.error_message || data.status }, { status: 502 });
      }
      const predictions = (data.predictions || []).map(p => ({
        place_id: p.place_id,
        description: p.description,
        main_text: p.structured_formatting?.main_text || p.description,
        secondary_text: p.structured_formatting?.secondary_text || '',
      }));
      return Response.json({ predictions });
    }

    if (action === 'details') {
      const placeId = (body?.place_id || '').toString().trim();
      if (!placeId) return Response.json({ error: 'place_id is required' }, { status: 400 });
      const sessionToken = body?.sessionToken || undefined;
      const url = new URL('https://maps.googleapis.com/maps/api/place/details/json');
      url.searchParams.set('place_id', placeId);
      url.searchParams.set('fields', 'formatted_address,name,geometry/location,place_id');
      url.searchParams.set('language', (body?.language || 'en').toString());
      url.searchParams.set('key', apiKey);
      if (sessionToken) url.searchParams.set('sessiontoken', sessionToken);
      const resp = await fetch(url.toString());
      const data = await resp.json();
      if (data.status !== 'OK') {
        return Response.json({ error: data.error_message || data.status }, { status: 502 });
      }
      const r = data.result || {};
      return Response.json({
        place_id: r.place_id,
        formatted_address: r.formatted_address || '',
        name: r.name || '',
        latitude: r.geometry?.location?.lat ?? null,
        longitude: r.geometry?.location?.lng ?? null,
      });
    }

    // Resolve IANA timezone from coordinates via Google TimeZone API.
    // Returns { timeZoneId, timeZoneName } or { error } on failure.
    if (action === 'timezone') {
      const lat = Number(body?.lat);
      const lng = Number(body?.lng);
      if (!Number.isFinite(lat) || !Number.isFinite(lng)) {
        return Response.json({ error: 'lat and lng are required numbers' }, { status: 400 });
      }
      // Use a reference timestamp (current time) — needed by the API; the
      // returned timeZoneId itself doesn't depend on it.
      const timestamp = Math.floor(Date.now() / 1000);
      const url = new URL('https://maps.googleapis.com/maps/api/timezone/json');
      url.searchParams.set('location', `${lat},${lng}`);
      url.searchParams.set('timestamp', String(timestamp));
      url.searchParams.set('key', apiKey);
      const resp = await fetch(url.toString());
      const data = await resp.json();
      if (data.status !== 'OK') {
        return Response.json({ error: data.errorMessage || data.status }, { status: 502 });
      }
      return Response.json({
        timeZoneId: data.timeZoneId || null,
        timeZoneName: data.timeZoneName || null,
      });
    }

    return Response.json({ error: 'Unknown action' }, { status: 400 });
  } catch (error) {
    console.error('placesAutocomplete error', error);
    return Response.json({ error: error.message || String(error) }, { status: 500 });
  }
});