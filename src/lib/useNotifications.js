/**
 * One seam for the in-app notifications inbox (TRIP-282).
 *
 * Three screens read the same table — the bell in every AppHeader, the Inbox
 * page and the account screen. They go through this module rather than each
 * hand-rolling a useQuery, because same key must mean same data: three queries
 * sharing `['notifications', email]` while asking for different row counts
 * coalesce into one cache entry and whichever mounts first wins (the Inbox
 * would show 30 rows or the bell 100, depending on the entry point). Hence the
 * row budget is part of the key.
 *
 * The unread COUNT is deliberately not derived from that capped list: a badge
 * computed from `limit 30` silently tops out at 30, so the account screen's
 * "99+" branch could never render. It gets its own `head`-only count query —
 * one number over the wire instead of 30 full rows.
 *
 * `read IS NOT TRUE` (not `= false`) mirrors the JS predicate `!n.read` the
 * screens used: the column is nullable, so an explicit `= false` would skip a
 * NULL row that the UI counts as unread.
 *
 * Invalidation stays prefix-based on `['notifications']`, so one invalidate
 * still refreshes every list AND the count.
 */
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/api/supabaseClient';
import { invokeFn } from '@/lib/invokeFn';
import { useAuth } from '@/lib/AuthContext';

/** Rows the bell popover needs vs. the rows the Inbox page needs. */
export const NOTIF_LIMIT = { BELL: 30, INBOX: 100 };

/**
 * The notification list, newest first. Rows are scoped to the caller by RLS
 * (`user_id = auth.uid()`).
 */
export function useNotificationList(limit = NOTIF_LIMIT.BELL) {
  const { user } = useAuth();
  return useQuery({
    queryKey: ['notifications', user?.email, 'list', limit],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('notifications')
        .select('*')
        .order('created_at', { ascending: false })
        .limit(limit);
      if (error) throw error;
      return data || [];
    },
    enabled: !!user?.email,
    // Override the global refetchOnWindowFocus:false (TRIP-208 Ф2-2a): there is
    // no polling and no realtime, so a tab the user returns to would otherwise
    // sit on a stale bell until they navigated.
    refetchOnWindowFocus: true,
  });
}

/** Unread badge count — the real total, not "however many fit in the list". */
export function useUnreadNotificationCount() {
  const { user } = useAuth();
  const { data = 0 } = useQuery({
    queryKey: ['notifications', user?.email, 'unread-count'],
    queryFn: async () => {
      const { count, error } = await supabase
        .from('notifications')
        .select('id', { count: 'exact', head: true })
        .not('read', 'is', true);
      if (error) throw error;
      return count || 0;
    },
    enabled: !!user?.email,
    refetchOnWindowFocus: true,
  });
  return data;
}

/**
 * Writes. `markAllRead` updates by predicate rather than by the ids currently
 * on screen — marking only the loaded page would leave the (now honest) badge
 * non-zero right after the user pressed "mark all read".
 */
export function useNotificationActions() {
  const qc = useQueryClient();
  const invalidate = () => qc.invalidateQueries({ queryKey: ['notifications'] });

  const markAllRead = useMutation({
    mutationFn: async () => {
      const { error } = await supabase
        .from('notifications')
        .update({ read: true })
        .not('read', 'is', true);
      if (error) throw error;
    },
    onSuccess: invalidate,
  });

  const markOneRead = useMutation({
    mutationFn: async (notifId) => {
      const { error } = await supabase.from('notifications').update({ read: true }).eq('id', notifId);
      if (error) throw error;
    },
    onSuccess: invalidate,
  });

  const respondInvite = useMutation({
    mutationFn: async ({ memberId, action }) => {
      // Edge function: sets user_id on the member (so the accepter is a
      // recognized participant under RLS), notifies the inviter, and marks the
      // invite read — none of which a raw update does.
      const { data, error } = await invokeFn('respondTripInvite', {
        body: { member_id: memberId, action },
      });
      // Re-throw the ORIGINAL error (invokeFn stamped it __seamHandled) so the
      // global MutationCache.onError seam doesn't capture it twice — the edge/
      // invoke seam already reported it. new Error(...) would drop the stamp.
      if (error || data?.error) throw error || new Error(data?.error || 'Failed');
    },
    onSuccess: (_data, vars) => {
      invalidate();
      qc.invalidateQueries({ queryKey: ['trips'] });
      // ['trip-member', id] — the per-row member query both inboxes render.
      // (The bell also invalidated a plural ['trip-members']; no query in the
      // app registers that key, so it was a no-op.)
      qc.invalidateQueries({ queryKey: ['trip-member', vars?.memberId] });
    },
  });

  return { markAllRead, markOneRead, respondInvite };
}
