// Fetches public-ish user profile data (full_name + avatar_url) for a list of
// emails — via a server-side resolver that enforces "same-trip" authorization.
// Used so participant avatars across the app reflect the same uploaded picture
// / display name that each user set in their Settings page, without leaking
// arbitrary User records.
//
// All emails are de-duplicated; results are cached by trip+emails key so
// multiple components requesting the same set don't re-fetch.

import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/api/supabaseClient';

async function fetchProfiles(tripId, emails) {
  if (!tripId || !emails || emails.length === 0) return {};
  try {
    const res = await supabase.functions.invoke('resolveProfiles', { body: { tripId, emails } });
    const list = res?.data?.profiles || [];
    const map = {};
    for (const p of list) {
      if (p?.email) map[p.email] = { full_name: p.full_name || '', avatar_url: p.avatar_url || '' };
    }
    return map;
  } catch {
    return {};
  }
}

/**
 * @param {string[]} emails  - list of member emails (may include duplicates / falsy)
 * @param {string}   tripId  - trip context, REQUIRED for authorization
 */
export function useUserProfiles(emails, tripId) {
  const unique = Array.from(
    new Set(
      (emails || [])
        .filter(Boolean)
        .map((e) => String(e).trim().toLowerCase())
        .filter((e) => e && !e.startsWith('offline:'))
    )
  ).sort();
  const key = unique.join('|');
  const { data = {} } = useQuery({
    queryKey: ['user-profiles', tripId, key],
    queryFn: () => fetchProfiles(tripId, unique),
    enabled: !!tripId && unique.length > 0,
    staleTime: 60_000,
  });
  return data;
}