// src/lib/tripEdit.js
// TRIP-126 / Ф3: client wrappers over the per-action route edits.
//
// TRIP-406: transport moved from direct `supabase.rpc(...)` to the single write
// door `invokeFn('trip-route/…')`. The seam gates the `editor` role on the SERVER
// (service_role) + scopes every RPC by `trip_id` (IDOR closed), and injects the
// actor as `p_actor` — the client never sends it. A refusal comes back as a
// generic `code`; we rethrow it via `refusalError` so the caller's onError words
// it through `errorText` (never raw server prose, TRIP-378).
//
// Live-edit model (unchanged): each structural change is persisted immediately;
// the SERVER recomputes the whole date chain (recompute_trip). The client never
// re-lays dates itself — after a mutation it refetches the authoritative trip
// state. Optimistic UI is applied locally only for the directly-edited value (the
// nights number, a constant start-date shift, card add/remove/reorder); all
// derived downstream dates come from refetchTrip(). Only the transport changed.

import { invokeFn } from '@/lib/invokeFn';
import { refusalError } from '@/lib/refusalError';
import { TRIP_SHELL_KEY, TRIP_CONTENT_KEY } from '@/lib/trip-data';

// Set the nights (span) of one city. 0 -> waypoint, >0 -> transit. Server clamps 0..60.
export async function rpcSetCityNights(tripId, cityId, nights) {
  const { error, code } = await invokeFn('trip-route/city/nights', { body: { tripId, cityId, nights } });
  if (error) throw refusalError(code);
}

// Re-anchor the whole trip to a new start date (ISO 'YYYY-MM-DD'); server re-lays the chain.
export async function rpcSetTripStartDate(tripId, dateISO) {
  const { error, code } = await invokeFn('trip-route/start-date', { body: { tripId, date: dateISO } });
  if (error) throw refusalError(code);
}

// Insert a city at `index` (or append when null). Returns the REAL city_visit uuid.
// `city` is the identity payload: { kind?, geonameid?, name_i18n?, city_name_en?,
//   country_code?, latitude?, longitude?, timezone?, external_city_id? } — the seam
// whitelists these columns (CITY_FIELDS) + kind, and drops anything else.
export async function rpcAddCity(tripId, city, index = null) {
  const { data, error, code } = await invokeFn('trip-route/city/add', { body: { tripId, ...city, index } });
  if (error) throw refusalError(code);
  return data; // uuid of the new city_visit
}

// Remove a city. Server cascades its hotels/activities/transfers, then recomputes.
export async function rpcRemoveCity(tripId, cityId) {
  const { error, code } = await invokeFn('trip-route/city/remove', { body: { tripId, cityId } });
  if (error) throw refusalError(code);
}

// Reorder cities by an explicit array of city_visit ids (chain order); server recomputes.
export async function rpcReorderCities(tripId, orderedIds) {
  const { error, code } = await invokeFn('trip-route/city/reorder', { body: { tripId, order: orderedIds } });
  if (error) throw refusalError(code);
}

// Pull the authoritative server state after a mutation (server owns the date layout).
// Defaults to both halves. Pass { content: false } for DATE-ONLY actions (set_city_nights,
// set_trip_start_date, reorder_cities): they re-lay city dates (SHELL = trip + cityVisits)
// but never touch hotels/activities/transfers (CONTENT), so skipping the CONTENT refetch
// avoids needless work and the flicker it can cause. buildDraft still reads transfers from
// the existing CONTENT cache, which stays valid for these actions.
export async function refetchTrip(qc, tripId, { shell = true, content = true } = {}) {
  const jobs = [];
  if (shell) jobs.push(qc.refetchQueries({ queryKey: TRIP_SHELL_KEY(tripId) }));
  if (content) jobs.push(qc.refetchQueries({ queryKey: TRIP_CONTENT_KEY(tripId) }));
  await Promise.all(jobs);
}
