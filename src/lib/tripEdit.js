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
// Live-edit model: each structural change is persisted immediately; the SERVER
// recomputes the whole date chain (recompute_trip). Since TRIP-435 every route RPC
// RETURNS the recomputed `city_visits` chain (jsonb array in `position` order, the
// new row's real id included) — so the caller reconciles the authoritative state
// FROM THE RESPONSE in one round-trip (reconcileCityChain), instead of a second
// confirm-refetch. Optimistic UI is applied locally only for the directly-edited
// value (the nights number, a constant start-date shift, card add/remove/reorder);
// the returned chain is the authoritative reconciliation for all derived dates + ids.

import { invokeFn } from '@/lib/invokeFn';
import { refusalError } from '@/lib/refusalError';
import { TRIP_SHELL_KEY, TRIP_CONTENT_KEY } from '@/lib/trip-data';

// Each wrapper returns the recomputed city_visits chain (jsonb array in `position`
// order) the RPC now hands back — the caller reconciles it via reconcileCityChain.

// Set the nights (span) of one city. 0 -> waypoint, >0 -> transit. Server clamps 0..60.
export async function rpcSetCityNights(tripId, cityId, nights) {
  const { data, error, code } = await invokeFn('trip-route/city/nights', { body: { tripId, cityId, nights } });
  if (error) throw refusalError(code);
  return data;
}

// Re-anchor the whole trip to a new start date (ISO 'YYYY-MM-DD'); server re-lays the chain.
export async function rpcSetTripStartDate(tripId, dateISO) {
  const { data, error, code } = await invokeFn('trip-route/start-date', { body: { tripId, date: dateISO } });
  if (error) throw refusalError(code);
  return data;
}

// Insert a city at `index` (or append when null). Returns the recomputed chain,
// which includes the new city_visit with its REAL id.
// `city` is the identity payload: { kind?, geonameid?, name_i18n?, city_name_en?,
//   country_code?, latitude?, longitude?, timezone?, external_city_id? } — the seam
// whitelists these columns (CITY_FIELDS) + kind, and drops anything else.
export async function rpcAddCity(tripId, city, index = null) {
  const { data, error, code } = await invokeFn('trip-route/city/add', { body: { tripId, ...city, index } });
  if (error) throw refusalError(code);
  return data;
}

// Remove a city. Server cascades its hotels/activities/transfers, then recomputes.
export async function rpcRemoveCity(tripId, cityId) {
  const { data, error, code } = await invokeFn('trip-route/city/remove', { body: { tripId, cityId } });
  if (error) throw refusalError(code);
  return data;
}

// Reorder cities by an explicit array of city_visit ids (chain order); server recomputes.
export async function rpcReorderCities(tripId, orderedIds) {
  const { data, error, code } = await invokeFn('trip-route/city/reorder', { body: { tripId, order: orderedIds } });
  if (error) throw refusalError(code);
  return data;
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
