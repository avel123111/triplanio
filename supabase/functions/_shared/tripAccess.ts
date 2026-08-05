/**
 * Shared trip access-control helpers — the ONLY place an edge function decides
 * "who may do this in this trip". Nothing outside this module should read
 * `trip_members` to answer that question (TRIP-274).
 *
 * Two ladder steps, strictly nested, mirroring the SQL predicates that gate the
 * same actions on the DB side:
 *
 *   participant  ← isCallerParticipant  ≡ SQL is_trip_participant
 *                  see the trip, write to chat, share the public link, copy it
 *   editor       ← isCallerEditor       ≡ SQL _can_edit_trip
 *                  events, services, cities, budget, documents and bytes,
 *                  settings, members
 *
 * `editor` is a STEP, not the `admin` role — the trip creator clears it with no
 * `trip_members` row at all, and `owner` members clear it too. Name it for the
 * step, never for a role: a helper called "isCallerAdmin" reads as
 * `role === 'admin'`, and callers who wanted "an editor" wrote their own copy
 * rather than reuse it. Three of them did exactly that.
 *
 * The third step (`owner` — delete the trip, billing) has no helper: it is a
 * plain `trips.created_by === caller` and lives in `deleteTrip`.
 *
 * Orthogonal to the ladder is the "own row" axis — leaving a trip, answering an
 * invite, unlinking a Telegram binding one created. It is not a step and does
 * not compose here; each call site checks ownership itself and ORs it with a
 * step (see removeTripMember, telegramDisconnect).
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
import { isNotFound } from './classifyDbError.ts';

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

/**
 * The ladder step a caller stands on, or null for "not on the trip at all".
 * Strictly nested: owner ⊃ editor ⊃ participant.
 */
export type TripStep = 'owner' | 'editor' | 'participant' | null;

/** Roles that clear `editor`. WHITELIST on purpose: an unknown or NULL role
 *  must fail closed, which is what SQL `_can_edit_trip` does since TRIP-120. */
export const EDITOR_ROLES = ['owner', 'admin'];

const LADDER: Record<Exclude<TripStep, null>, number> = { participant: 1, editor: 2, owner: 3 };

/**
 * THE RULE, as a pure function of already-fetched facts — this is the half that
 * tests pin (tripAccess_test.ts). Keeping it separate from the queries is the
 * same split `_shared/profiles.ts` uses for the profile-scope rule (TRIP-334):
 * a rule that only exists inside an async DB call cannot be tested, and this one
 * is the single definition of "who may change a trip".
 *
 * `activeRole` = role of the caller's ACTIVE trip_members row, or null when
 * there is none. `creatorId` = trips.created_by, or null when there is no trip.
 */
export function stepFromFacts(
  creatorId: string | null,
  userId: string | null,
  activeRole: string | null,
): TripStep {
  if (!creatorId || !userId) return null;
  // Ownership is trips.created_by and ONLY that. A stray trip_members row with
  // role 'owner' is not ownership — it maps to `editor` below (TRIP-143).
  if (creatorId === userId) return 'owner';
  if (activeRole === null) return null;
  return EDITOR_ROLES.includes(activeRole) ? 'editor' : 'participant';
}

/** Does `step` clear the bar `required`? Null clears nothing. */
export function clearsStep(step: TripStep, required: Exclude<TripStep, null>): boolean {
  return step !== null && LADDER[step] >= LADDER[required];
}

/** Trip creator id, or null when the trip genuinely does not exist.
 *  Throws TripAccessError on a transient/infra query error. */
async function fetchTripCreator(tripId: string): Promise<string | null> {
  const { data, error } = await supabaseAdmin
    .from('trips')
    .select('created_by')
    .eq('id', tripId)
    .single();

  if (error) {
    // not_found = zero rows OR an unusable id (bad uuid) → genuine "no such trip".
    // Anything else (timeout/deadlock/connection) → fail LOUD → 5xx. TRIP-208.
    if (isNotFound(error)) return null;
    throw new TripAccessError(error);
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
 * Step `editor`: true if `userId` is the trip creator or an active admin/owner
 * member — the TS mirror of SQL `_can_edit_trip(trip, uid)`, kept identical to
 * it on purpose (whitelist of explicit roles + strict `status = 'active'`, so an
 * unknown or NULL role fails closed — TRIP-120).
 *
 * Gates every change to the trip PLAN: members (invite, remove, role change,
 * resend, offline member), settings, invite links, the Telegram binding.
 * Throws TripAccessError if a downstream query fails (→ caller returns 5xx).
 */
export async function isCallerEditor(tripId: string, userId: string): Promise<boolean> {
  return clearsStep(await resolveStep(tripId, userId), 'editor');
}

/**
 * Step `participant`: true if `userId` is an active participant of the trip
 * (creator OR active TripMember of ANY role, viewer included) — the TS mirror of
 * SQL `is_trip_participant(trip)`.
 *
 * Use it only where a viewer is MEANT to pass. It must never gate a change to
 * the trip plan: that is `isCallerEditor`.
 * Throws TripAccessError if a downstream query fails (→ caller returns 5xx).
 */
export async function isCallerParticipant(tripId: string, userId: string): Promise<boolean> {
  return clearsStep(await resolveStep(tripId, userId), 'participant');
}

/** I/O-половина: достаёт факты и отдаёт их правилу. Решение — в `stepFromFacts`. */
async function resolveStep(tripId: string, userId: string): Promise<TripStep> {
  const creator = await fetchTripCreator(tripId);
  // Трипа нет — дальше спрашивать нечего, и лишний запрос не нужен.
  if (creator === null) return null;
  // Создатель проходит без строки членства, поэтому роль тут не читаем вовсе.
  if (creator === userId) return stepFromFacts(creator, userId, null);

  return stepFromFacts(creator, userId, await fetchActiveMemberRole(tripId, userId));
}
