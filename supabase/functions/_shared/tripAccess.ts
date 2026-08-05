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
// Само ПРАВИЛО живёт в import-free ./tripStep.ts. Здесь только I/O: этот модуль
// тянет supabaseAdmin, который читает env на загрузке, поэтому из теста его не
// подгрузить — `deno test` идёт без --allow-env.
import { clearsStep, stepFromFacts, type TripStep } from './tripStep.ts';

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
