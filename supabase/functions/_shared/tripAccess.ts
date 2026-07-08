/**
 * Shared trip access-control helpers.
 *
 * Repeated in every member-management function — centralised here so
 * a single change covers all callers.
 *
 * Error contract (TRIP-208): these helpers distinguish a genuine "no" (the trip
 * does not exist / the caller is not an active member → returns false) from an
 * INFRASTRUCTURE failure (the downstream query itself errored, e.g. a transient
 * DB/PostgREST blip → throws TripAccessError). Callers must NOT translate an
 * infra failure into a 403/404: every caller already has a terminal catch that
 * returns 500, so a thrown TripAccessError surfaces as a 5xx ("retry"), never a
 * false "no access". Fail-closed stays fail-closed on a real empty result.
 */

import { supabaseAdmin } from './supabaseAdmin.ts';

/** Thrown when an access check can't be completed because a downstream query
 *  failed (transient/infra), as opposed to a definitive allow/deny answer. */
export class TripAccessError extends Error {
  readonly downstream: unknown;
  constructor(downstream: unknown) {
    super('trip access check failed: downstream query error');
    this.name = 'TripAccessError';
    this.downstream = downstream;
  }
}

// PostgREST returns this code from .single() when zero rows match — that is a
// genuine "not found", NOT an infrastructure failure.
const NO_ROWS = 'PGRST116';

/** Trip creator id, or null when the trip genuinely does not exist.
 *  Throws TripAccessError on any non-"no rows" query error. */
async function fetchTripCreator(tripId: string): Promise<string | null> {
  const { data, error } = await supabaseAdmin
    .from('trips')
    .select('created_by')
    .eq('id', tripId)
    .single();

  if (error) {
    if ((error as { code?: string }).code === NO_ROWS) return null; // real: no such trip
    throw new TripAccessError(error);                                // infra: fail LOUD → 5xx
  }
  return (data?.created_by as string | null) ?? null;
}

/** Active-membership role for the caller, or null when not an active member.
 *  Throws TripAccessError on a query error. */
async function fetchActiveMemberRole(tripId: string, userId: string): Promise<string | null> {
  const { data, error } = await supabaseAdmin
    .from('trip_members')
    .select('role')
    .eq('trip_id', tripId)
    .eq('user_id', userId)
    .eq('status', 'active')
    .limit(1);

  if (error) throw new TripAccessError(error);
  return (data?.[0]?.role as string | null) ?? null;
}

/**
 * Returns true if `userId` is the trip creator or an active admin/owner member.
 * Used to gate write operations (invite, remove, role change, resend).
 * Throws TripAccessError if a downstream query fails (→ caller returns 5xx).
 */
export async function isCallerAdmin(tripId: string, userId: string): Promise<boolean> {
  const creator = await fetchTripCreator(tripId);
  if (creator === null) return false;
  if (creator === userId) return true;

  const role = await fetchActiveMemberRole(tripId, userId);
  return role === 'admin' || role === 'owner';
}

/**
 * Returns true if `userId` is an active participant of the trip
 * (creator OR active TripMember of any role).
 * Throws TripAccessError if a downstream query fails (→ caller returns 5xx).
 */
export async function isCallerParticipant(tripId: string, userId: string): Promise<boolean> {
  const creator = await fetchTripCreator(tripId);
  if (creator === null) return false;
  if (creator === userId) return true;

  const role = await fetchActiveMemberRole(tripId, userId);
  return role !== null;
}
