// getPublicTrip — public read-only trip endpoint (no auth; tripId + share_token).
// Returns trip (ownership stripped) + visits/hotels/transfers/activities/carRentals.
import { createClient } from 'npm:@supabase/supabase-js@2';
import { captureEdgeError } from '../_shared/sentry.ts';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

const admin = createClient(
  Deno.env.get('SUPABASE_URL')!,
  Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
  { auth: { persistSession: false } },
);

function sanitizeTrip(t: Record<string, unknown>) {
  const { created_by: _c, share_token: _s, ...rest } = t;
  return rest;
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });
  try {
    const { tripId, token } = await req.json().catch(() => ({}));
    if (!tripId || !token) {
      return Response.json({ error: 'tripId and token required' }, { status: 400, headers: corsHeaders });
    }

    const { data: trip } = await admin.from('trips').select('*').eq('id', tripId).single();
    if (!trip || !trip.share_token || trip.share_token !== token) {
      return Response.json({ error: 'Not found' }, { status: 404, headers: corsHeaders });
    }

    const [visits, hotels, transfers, activities, services] = await Promise.all([
      admin.from('city_visits').select('*').eq('trip_id', tripId),
      admin.from('hotel_stays').select('*').eq('trip_id', tripId),
      admin.from('transfers').select('*').eq('trip_id', tripId),
      admin.from('activities').select('*').eq('trip_id', tripId),
      admin.from('trip_services').select('*').eq('trip_id', tripId),
    ]);

    const carRentals = (services.data ?? []).filter((s: { kind?: string }) => s.kind === 'car_rental');

    return Response.json({
      trip: sanitizeTrip(trip),
      visits: visits.data ?? [],
      hotels: hotels.data ?? [],
      transfers: transfers.data ?? [],
      activities: activities.data ?? [],
      carRentals,
    }, { headers: corsHeaders });
  } catch (err) {
    await captureEdgeError(err, 'getPublicTrip');
    console.error('getPublicTrip error:', err);
    return Response.json({ error: String((err as Error)?.message || err) }, { status: 500, headers: corsHeaders });
  }
});
