// src/lib/tripEdit.js
// TRIP-126 / Ф3: client wrappers over the Ф1 per-action edit RPCs (migration 0027).
//
// Live-edit model: each structural change is persisted immediately by a single RPC;
// the SERVER recomputes the whole date chain (recompute_trip). The client never
// re-lays dates itself — after a mutation it refetches the authoritative trip state.
// Optimistic UI is applied locally only for the directly-edited value (e.g. the
// nights number, a constant start-date shift, card add/remove/reorder); all derived
// downstream dates come from refetchTrip().

import { supabase } from '@/api/supabaseClient';
import { TRIP_SHELL_KEY, TRIP_CONTENT_KEY } from '@/lib/trip-data';

// Set the nights (span) of one city. 0 -> waypoint, >0 -> transit. Server clamps 0..60.
export async function rpcSetCityNights(cityId, nights) {
  const { error } = await supabase.rpc('set_city_nights', { p_city: cityId, p_nights: nights });
  if (error) throw error;
}

// Re-anchor the whole trip to a new start date (ISO 'YYYY-MM-DD'); server re-lays the chain.
export async function rpcSetTripStartDate(tripId, dateISO) {
  const { error } = await supabase.rpc('set_trip_start_date', { p_trip: tripId, p_date: dateISO });
  if (error) throw error;
}

// Insert a city at `index` (or append when null). Returns the REAL city_visit uuid.
// `city` is a jsonb payload: { city_name, kind?, country?, country_code?, latitude?,
//   longitude?, timezone?, external_city_id? }.
export async function rpcAddCity(tripId, city, index = null) {
  const { data, error } = await supabase.rpc('add_city', { p_trip: tripId, p_city: city, p_index: index });
  if (error) throw error;
  return data; // uuid of the new city_visit
}

// Remove a city. Server cascades its hotels/activities/transfers, then recomputes.
export async function rpcRemoveCity(cityId) {
  const { error } = await supabase.rpc('remove_city', { p_city: cityId });
  if (error) throw error;
}

// Reorder cities by an explicit array of city_visit ids (chain order); server recomputes.
export async function rpcReorderCities(tripId, orderedIds) {
  const { error } = await supabase.rpc('reorder_cities', { p_trip: tripId, p_order: orderedIds });
  if (error) throw error;
}

// Pull the authoritative server state after a mutation (server owns the date layout).
export async function refetchTrip(qc, tripId) {
  await Promise.all([
    qc.refetchQueries({ queryKey: TRIP_SHELL_KEY(tripId) }),
    qc.refetchQueries({ queryKey: TRIP_CONTENT_KEY(tripId) }),
  ]);
}
