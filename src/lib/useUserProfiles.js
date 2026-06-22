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
import { supabase } from '@/api/supabaseClient';
import { useT } from '@/lib/i18n/I18nContext';

async function fetchProfiles(tripId, userIds) {
  if (!tripId || !userIds || userIds.length === 0) return {};
  try {
    const res = await supabase.functions.invoke('resolveProfiles', { body: { tripId, userIds } });
    const list = res?.data?.profiles || [];
    const map = {};
    for (const p of list) {
      if (p?.id) map[p.id] = {
        full_name: p.full_name || '',
        avatar_url: p.avatar_url || '',
        email: p.email || '',
        is_deleted: !!p.is_deleted,
      };
    }
    return map;
  } catch {
    return {};
  }
}

/**
 * @param {string[]} userIds - list of member user ids (may include duplicates / falsy)
 * @param {string}   tripId  - trip context, REQUIRED for authorization
 */
export function useUserProfiles(userIds, tripId) {
  const t = useT();
  const unique = Array.from(
    new Set(
      (userIds || [])
        .filter(Boolean)
        .map((e) => String(e).trim())
    )
  ).sort();
  const key = unique.join('|');
  const { data = {} } = useQuery({
    queryKey: ['user-profiles', tripId, key],
    queryFn: () => fetchProfiles(tripId, unique),
    enabled: !!tripId && unique.length > 0,
    staleTime: 60_000,
  });
  // Anonymized (soft-deleted) accounts: surface a localized "deleted account"
  // label so the scrubbed empty name doesn't fall through to a cached value or
  // render blank. A single shared name also yields one uniform avatar gradient
  // for all deleted users.
  return useMemo(() => {
    const out = {};
    for (const id of Object.keys(data)) {
      const p = data[id];
      out[id] = p?.is_deleted ? { ...p, full_name: t('common.deleted_user') } : p;
    }
    return out;
  }, [data, t]);
}
