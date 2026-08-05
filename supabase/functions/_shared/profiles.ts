/**
 * The ONE shape AND the ONE scope of a "public-ish" user profile leaving the
 * backend, shared by resolveProfiles (chat authors, on demand) and
 * getTripDetails (trip members, bundled with the trip content).
 *
 * Two functions emit profiles, and two rules must not drift between them:
 *   • privacy — a soft-deleted account must never leak its email (toProfile);
 *   • scope   — whose profile a trip's payload may carry (tripProfileScope).
 * Both callers had their own copy of the scope rule, and that is exactly how
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

export function toProfile(u: UserRow): Profile {
  return {
    id: u.id,
    full_name: u.full_name || '',
    avatar_url: u.avatar_url || '',
    // Never expose a deleted user's email (it's a scrubbed placeholder anyway).
    email: u.deleted_at ? '' : (u.email || ''),
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
 * No new disclosure: the same payload already ships those rows whole, and
 * inviteTripMember copies the invitee's name into the row at invite time.
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

/** Batch-loads the profile rows for already-scoped ids. One query, no N+1. */
export async function fetchProfiles(
  db: { from: (table: string) => any },
  ids: string[],
): Promise<Profile[]> {
  if (ids.length === 0) return [];
  const { data } = await db.from('users').select(PROFILE_COLUMNS).in('id', ids);
  return ((data ?? []) as UserRow[]).map(toProfile);
}
