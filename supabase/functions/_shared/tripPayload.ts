/**
 * Shared full-trip payload builder.
 *
 * buildTripData(tripId) returns the trip plus its itinerary collections
 * (cities, hotels, activities, transfers, services, members) as a plain
 * object, or null if the trip is missing. Budget data is intentionally NOT
 * included — this payload feeds the server-to-server (n8n / Telegram bot)
 * endpoints, which must not expose trip finances.
 *
 * fetchTripPayload(tripId) wraps buildTripData in an HTTP Response and is used
 * by getTripById (single-trip contract — unchanged).
 *
 * getTripByTelegramChatId builds its own { trips: [...] } array response on top
 * of buildTripData (a chat may be linked to several trips).
 *
 * Runs with the service-role client (bypasses RLS), so callers MUST
 * authenticate the request (requireN8nSecret) before invoking this — it
 * performs NO access control of its own.
 */

import { supabaseAdmin } from './supabaseAdmin.ts';
import { corsFor } from './cors.ts';

export interface TripData {
  trip: Record<string, unknown>;
  cityVisits: unknown[];
  hotels: unknown[];
  activities: unknown[];
  transfers: unknown[];
  services: unknown[];
  members: unknown[];
}

/** Builds the full trip object for `tripId`, or null when the trip is missing. */
export async function buildTripData(tripId: string): Promise<TripData | null> {
  const { data: trip, error: tripErr } = await supabaseAdmin
    .from('trips')
    .select('*')
    .eq('id', tripId)
    .single();

  if (tripErr || !trip) return null;

  const [
    { data: cityVisits },
    { data: hotels },
    { data: activities },
    { data: transfers },
    { data: services },
    { data: members },
  ] = await Promise.all([
    supabaseAdmin.from('city_visits').select('*').eq('trip_id', tripId),
    supabaseAdmin.from('hotel_stays').select('*').eq('trip_id', tripId),
    supabaseAdmin.from('activities').select('*').eq('trip_id', tripId),
    supabaseAdmin.from('transfers').select('*').eq('trip_id', tripId),
    supabaseAdmin.from('trip_services').select('*').eq('trip_id', tripId),
    supabaseAdmin.from('trip_members').select('*').eq('trip_id', tripId),
  ]);

  // Attach the affiliate-directory row LATE-BOUND by GeoNames identity
  // (visit.geonameid → cities.geonameid, TRIP-146), not the city_id FK embed:
  // `cities` is sparse, so a city added later is picked up with no backfill.
  // Shape unchanged for n8n/bot consumers (visit.cities = the directory row).
  const cv = (cityVisits ?? []) as any[];
  const gids = [...new Set(cv.map((v) => v?.geonameid).filter((g) => g != null))];
  const dir: Record<string, any> = {};
  if (gids.length) {
    const { data: crows } = await supabaseAdmin
      .from('cities').select('*').in('geonameid', gids as number[]);
    for (const r of (crows ?? []) as any[]) dir[String(r.geonameid)] = r;
  }
  const cityVisitsOut = cv.map((v) => ({
    ...v,
    // city_name (the DB column) is dropped in TRIP-146; keep the field present
    // for existing n8n/bot consumers (contract unchanged) as the English snapshot.
    // name_i18n travels alongside for locale-aware rendering.
    city_name: v?.name_i18n?.en ?? v?.city_name_en ?? null,
    cities: v?.geonameid != null ? dir[String(v.geonameid)] ?? null : null,
  }));

  return {
    trip,
    cityVisits: cityVisitsOut,
    hotels: hotels ?? [],
    activities: activities ?? [],
    transfers: transfers ?? [],
    services: services ?? [],
    members: members ?? [],
  };
}

/** Single-trip HTTP wrapper used by getTripById (contract unchanged). */
export async function fetchTripPayload(tripId: string): Promise<Response> {
  const data = await buildTripData(tripId);
  if (!data) {
    return Response.json({ error: 'Trip not found' }, { status: 404, headers: corsFor() });
  }
  return Response.json(data, { headers: corsFor() });
}
