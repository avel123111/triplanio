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

/** The caller's ACTIVE trip_members row, or null when there is none.
 *  Returns the row (not the bare role) because `role` is nullable: an active row
 *  with a NULL role is still a participant, and collapsing both into `null`
 *  would make this stricter than SQL `is_trip_participant`, which reads only
 *  `status`. See the note on `stepFromFacts`.
 *  Throws TripAccessError on a query error. */
async function fetchActiveMembership(
  tripId: string,
  userId: string,
): Promise<{ role: string | null } | null> {
  const { data, error } = await supabaseAdmin
    .from('trip_members')
    .select('role')
    .eq('trip_id', tripId)
    .eq('user_id', userId)
    .eq('status', 'active')
    .limit(1);

  if (error) throw new TripAccessError(error);
  const row = data?.[0];
  return row ? { role: (row.role as string | null) ?? null } : null;
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

/**
 * Step `owner`: true if `userId` is the trip CREATOR (`trips.created_by`). The
 * top rung of the ladder — deleting the trip, billing. It reads nothing but
 * `trips.created_by`, so it does NOT touch `trip_members` and needs no role
 * lookup: ownership is a column, not a membership row.
 *
 * Historically this lived inline in `deleteTrip` as "the third step has no
 * helper" (see the ladder note at the top of this file). It gets one now because
 * the write seam (`mutate.ts#checkRequirement`) needs a uniform `owner` gate,
 * exactly as `editor`/`participant` are gated — one predicate, no per-function
 * copy. A genuinely absent trip returns false (→ 403 at the seam, same as
 * editor/participant on a missing trip); an infra failure throws TripAccessError
 * (→ 5xx), never a false "not owner".
 */
export async function isCallerOwner(tripId: string, userId: string): Promise<boolean> {
  return (await fetchTripCreator(tripId)) === userId;
}

/** I/O-половина: достаёт факты и отдаёт их правилу. Решение — в `stepFromFacts`. */
async function resolveStep(tripId: string, userId: string): Promise<TripStep> {
  return callerStep(tripId, userId, await fetchTripCreator(tripId));
}

/**
 * Ступень вызывающего, когда `trips.created_by` УЖЕ известен.
 *
 * Для горячих путей, которые и так держат строку трипа в руках
 * (`getTripDetails` — каждое открытие трипа, `callTriplanioAi`): звать
 * `isCallerParticipant` там значило бы прочитать `trips` второй раз за запрос.
 * Правило при этом остаётся ОДНО — то же `stepFromFacts`, что и у всех.
 *
 * `creatorId` = null означает «трипа нет» (вызывающий уже ответил 404).
 * Бросает TripAccessError, если запрос роли сорвался (→ 5xx, не ложный 403).
 */
export async function callerStep(
  tripId: string,
  userId: string,
  creatorId: string | null,
): Promise<TripStep> {
  if (creatorId === null) return null;
  // Создатель проходит без строки членства — роль не читаем вовсе.
  if (creatorId === userId) return stepFromFacts(creatorId, userId, null);

  return stepFromFacts(creatorId, userId, await fetchActiveMembership(tripId, userId));
}
