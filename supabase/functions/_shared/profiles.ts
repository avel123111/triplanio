/**
 * The ONE shape AND the ONE scope of a "public-ish" user profile leaving the
 * backend. Profiles ride bundled with the trip content out of getTripDetails
 * (trip members + owner); the front-end no longer fetches them separately
 * (TRIP-409 folded the old resolveProfiles hop into this one bundle).
 *
 * Two rules must not drift:
 *   • privacy — a soft-deleted account must never leak its email (toProfile);
 *   • scope   — whose profile a trip's payload may carry (tripProfileScope).
 * They used to live in two callers with a copy each, and that is exactly how
 * TRIP-334 happened: see tripProfileScope below.
 */

export const PROFILE_COLUMNS = 'id, full_name, avatar_url, email, deleted_at';

export interface UserRow {
  id: string;
  full_name: string | null;
  avatar_url: string | null;
  email: string | null;
  deleted_at: string | null;
}

export interface Profile {
  id: string;
  full_name: string;
  avatar_url: string;
  email: string;
  is_deleted: boolean;
}

/**
 * `live = false` returns the IDENTITY STATE only — no name, avatar or address.
 *
 * That is everything a client needs to render a row it must not see the live
 * account of: an anonymized account still gets its "deleted account" label,
 * while a not-yet-accepted (or declined) invitee is rendered from the invite
 * snapshot already on the trip_members row, exactly as before. Sending the full
 * shape for those rows would hand every trip participant the invitee's avatar
 * and current account e-mail, neither of which the invite itself contains.
 */
export function toProfile(u: UserRow, live = true): Profile {
  return {
    id: u.id,
    full_name: live ? (u.full_name || '') : '',
    avatar_url: live ? (u.avatar_url || '') : '',
    // Never expose a deleted user's email (it's a scrubbed placeholder anyway).
    email: live && !u.deleted_at ? (u.email || '') : '',
    is_deleted: !!u.deleted_at,
  };
}

/**
 * The ONE "whose profile may this trip's payload carry?" rule.
 *
 * The invariant it exists to hold: **a response ships a profile for every row
 * it ships**. Both callers used to scope profiles to `status = 'active'` while
 * getTripDetails ships trip_members rows of EVERY status — so a pending or
 * declined row was unresolvable on the client. Harmless while the row carried
 * its own `user_full_name`/`invite_email` snapshot, fatal once it did not:
 * anonymize_my_account scrubs those columns, so an invited member who then
 * deleted their account rendered as a bare "-" instead of "Удалённый аккаунт"
 * (TRIP-334). Scope therefore follows MEMBERSHIP, not acceptance.
 *
 * Being IN scope is not permission to see the live account — that is a separate
 * question, answered by liveIdentityIds() below. Widening the scope alone would
 * have leaked every invitee's avatar and current e-mail to the whole trip.
 *
 * `extraIds` covers ids legitimately outside the membership set — the AI bot
 * authors chat messages without ever joining a trip.
 */
export function tripProfileScope(
  // Callers hand over whole trip_members rows; `user_id` is the only field the
  // rule reads — deliberately NOT `status`, which is the whole point.
  members: ({ user_id?: string | null } & Record<string, unknown>)[] | null | undefined,
  ownerId?: string | null,
  extraIds: (string | null | undefined)[] = [],
): string[] {
  const scope = new Set<string>();
  if (ownerId) scope.add(ownerId);
  for (const m of members ?? []) if (m?.user_id) scope.add(m.user_id);
  for (const id of extraIds) if (id) scope.add(id);
  return [...scope];
}

/**
 * Whose LIVE account fields (name, avatar, e-mail) the trip may reveal: the
 * owner, members who actually accepted, and the extras. A pending or declined
 * invitee is deliberately absent — they are in scope (so their row resolves)
 * but the trip only ever knew the invite snapshot about them.
 */
export function liveIdentityIds(
  members: ({ user_id?: string | null; status?: string | null } & Record<string, unknown>)[] | null | undefined,
  ownerId?: string | null,
  extraIds: (string | null | undefined)[] = [],
): Set<string> {
  const live = new Set<string>();
  if (ownerId) live.add(ownerId);
  for (const m of members ?? []) if (m?.user_id && m.status === 'active') live.add(m.user_id);
  for (const id of extraIds) if (id) live.add(id);
  return live;
}

/**
 * The single entry point: loads the trip's profiles in ONE query and applies
 * both rules (scope, then live-vs-identity-only) in one place, so a caller can
 * never hold one of them and not the other.
 */
export async function fetchTripProfiles(
  db: { from: (table: string) => any },
  { members, ownerId, extraIds = [] }: {
    members: ({ user_id?: string | null; status?: string | null } & Record<string, unknown>)[] | null | undefined;
    ownerId?: string | null;
    extraIds?: (string | null | undefined)[];
  },
): Promise<Profile[]> {
  const ids = tripProfileScope(members, ownerId, extraIds);
  if (ids.length === 0) return [];

  const { data } = await db.from('users').select(PROFILE_COLUMNS).in('id', ids);
  const live = liveIdentityIds(members, ownerId, extraIds);
  return ((data ?? []) as UserRow[]).map((u) => toProfile(u, live.has(u.id)));
}
