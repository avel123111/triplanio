// @ts-check
// Free-tier active-trip cap — the single client-side source of the threshold.
//
// The VALUE is mirrored server-side in the authoritative predicate
// public.can_create_trip(uuid) (`is_user_pro(uid) OR count_active_owned_trips(uid) <
// FREE_ACTIVE_TRIP_LIMIT`), which every write path calls (enforce_trip_limit trigger,
// mutate.ts trip_quota, create_trip_with_route, copy_trip). JS and SQL can't share a
// literal across the language boundary, so if this number ever changes it must be
// updated in BOTH places; src/lib/limits.test.js is the drift guard that reds out
// until they match. The client copy only drives the upsell UX (list banner /
// TripLimitDialog / planner blocker); it never grants access on its own.
//
// ponytail: 1000 is a TEMPORARY ceiling that effectively lifts the Free active-trip
// cap without deleting any gating logic — every gate derives from this one predicate,
// so raising the number switches them all off by construction (TRIP-503). It is NOT a
// real business limit; to REINSTATE the cap, lower this to the desired N here AND in
// public.can_create_trip (new migration), and restore the "unlimited" copy on /pro +
// ProUpsellModal per the TRIP-503 checklist. See that issue for the full revert steps.
export const FREE_ACTIVE_TRIP_LIMIT = 1000;

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
