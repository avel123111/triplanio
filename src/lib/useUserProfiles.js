// Fetches public-ish user profile data (full_name + avatar_url) for a list of
// user ids - via a server-side resolver that enforces "same-trip" authorization.
// Used so participant avatars across the app reflect the same uploaded picture
// / display name that each user set in their Settings page, without leaking
// arbitrary User records.
//
// All ids are de-duplicated; results are cached by trip+ids key so
// multiple components requesting the same set don't re-fetch.

import { useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { invokeFn } from '@/lib/invokeFn';
import { useT } from '@/lib/i18n/I18nContext';

// Stable identity so an unresolved query doesn't hand useProfileMap a fresh
// array on every render (which would rebuild the map and re-render consumers).
const NO_PROFILES = [];

async function fetchProfiles(tripId, userIds) {
  if (!tripId || !userIds || userIds.length === 0) return NO_PROFILES;
  try {
    const res = await invokeFn('resolveProfiles', { body: { tripId, userIds } });
    return res?.data?.profiles || NO_PROFILES;
  } catch {
    return NO_PROFILES;
  }
}

/**
 * Indexes the wire shape (a Profile[] — see _shared/profiles.ts) by id, for
 * profiles obtained ANY way: fetched below, or shipped with the trip content by
 * getTripDetails (TRIP-230). Both paths must render an anonymized account
 * identically, so that rule lives here rather than at each consumer.
 *
 * Anonymized (soft-deleted) accounts: surface a localized "deleted account"
 * label so the scrubbed empty name doesn't fall through to a cached value or
 * render blank. A single shared name also yields one uniform avatar gradient
 * for all deleted users.
 *
 * @param {object[]} profiles - list of profiles ({ id, full_name, … })
 */
export function useProfileMap(profiles) {
  const t = useT();
  return useMemo(() => {
    const out = {};
    for (const p of profiles || []) {
      if (!p?.id) continue;
      out[p.id] = p.is_deleted ? { ...p, full_name: t('common.deleted_user') } : p;
    }
    return out;
  }, [profiles, t]);
}

/**
 * @param {string[]} userIds - list of member user ids (may include duplicates / falsy)
 * @param {string}   tripId  - trip context, REQUIRED for authorization
 */
export function useUserProfiles(userIds, tripId) {
  const unique = Array.from(
    new Set(
      (userIds || [])
        .filter(Boolean)
        .map((e) => String(e).trim())
    )
  ).sort();
  const key = unique.join('|');
  const { data = NO_PROFILES } = useQuery({
    queryKey: ['user-profiles', tripId, key],
    queryFn: () => fetchProfiles(tripId, unique),
    enabled: !!tripId && unique.length > 0,
    staleTime: 60_000,
  });
  return useProfileMap(data);
}
