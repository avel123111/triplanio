// Free-tier active-trip cap — the single client-side source of the threshold.
//
// The VALUE (1) is mirrored server-side in the create_trip RPC
// (supabase/migrations/0045_active_trips_single_source.sql:
//  `count_active_owned_trips(uid) >= 1` -> raise TRIP_LIMIT_REACHED), which is the
// AUTHORITATIVE enforcement. JS and SQL can't share a literal across the language
// boundary, so if this number ever changes it must be updated in BOTH places.
// The client copy only drives the upsell UX (list banner / TripLimitDialog /
// planner blocker); it never grants access on its own.
//
// NOTE: user-facing copy ("1 активное путешествие" / "1 viaje activo") is hardcoded
// in the i18n locale strings and is NOT derived from this constant — update those
// too if the limit ever changes.
export const FREE_ACTIVE_TRIP_LIMIT = 1;

/**
 * The single predicate for "free user is at the active-trip cap".
 * Pro users are never capped. Mirrors the server rule in create_trip.
 *
 * @param {boolean} isPro
 * @param {number} activeCount - active owned trips (from getActiveTrips / active_owned_trips()).
 * @returns {boolean}
 */
export function isActiveTripCapReached(isPro, activeCount) {
  return !isPro && (activeCount ?? 0) >= FREE_ACTIVE_TRIP_LIMIT;
}
