/**
 * The ONE shape of a "public-ish" user profile leaving the backend, shared by
 * resolveProfiles (chat authors, on demand) and getTripDetails (trip members,
 * bundled with the trip content).
 *
 * Two functions now emit profiles, and the rule that matters is a privacy one:
 * a soft-deleted account must never leak its email. Keeping the column list and
 * the mapping here is what stops one caller from drifting into exposing it.
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
