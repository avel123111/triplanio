// @ts-check
/**
 * One seam for the in-app notifications inbox (TRIP-282).
 *
 * Three screens read the same table — the bell in every AppHeader, the Inbox
 * page and the account screen. Two queries serve all three:
 *
 *   the LIST   one query, one row budget, shared by everyone who needs rows.
 *   the COUNT  one number, `head`-only, for the badge.
 *
 * Both halves are deliberate. Before this seam all three screens hand-rolled a
 * useQuery under the SAME key `['notifications', email]` but with different
 * limits (30/100/30); React Query coalesces on the key, so one request served
 * all three and whoever mounted first decided how many rows the others saw.
 * Putting the limit IN the key fixes the lying, but splits one request into
 * two — so instead there is one limit for everybody and the bell renders the
 * head of the same list. Same data by construction, not by convention.
 *
 * The count is not derived from the list: a badge computed off `limit N` tops
 * out at N, so the account screen's "99+" branch could never render.
 *
 * The bell does NOT fetch rows until its popover opens (`enabled`). It is
 * mounted in the AppHeader of every screen, so a list it fetches "just in case"
 * is a `SELECT *` on every page the user visits, for a panel most of them never
 * open. Closed bell = one number.
 *
 * `read IS NOT TRUE` (not `= false`) mirrors the JS predicate `!n.read` the
 * screens used: the column is nullable, so an explicit `= false` would skip a
 * NULL row that the UI counts as unread.
 *
 * Invalidation stays prefix-based on `['notifications']`, so one invalidate
 * still refreshes the list AND the count.
 */
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/api/supabaseClient';
import { invokeFn } from '@/lib/invokeFn';
import { useAuth } from '@/lib/AuthContext';

/** One row budget for every consumer — the deepest page (the Inbox) sets it. */
const LIST_LIMIT = 100;

/** Rows the bell popover renders: the head of that same list. */
export const BELL_ROWS = 30;

/**
 * The notification list, newest first. Rows are scoped to the caller by RLS
 * (`user_id = auth.uid()`). `enabled: false` keeps a mounted-but-closed
 * consumer off the wire without unsharing the cache entry.
 */
export function useNotificationList({ enabled = true } = {}) {
  const { user } = useAuth();
  return useQuery({
    queryKey: ['notifications', user?.email, 'list'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('notifications')
        .select('*')
        .order('created_at', { ascending: false })
        .limit(LIST_LIMIT);
      if (error) throw error;
      return data || [];
    },
    enabled: enabled && !!user?.email,
    // Override the global refetchOnWindowFocus:false (TRIP-208 Ф2-2a): there is
    // no polling and no realtime, so a tab the user returns to would otherwise
    // sit on stale rows until they navigated.
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
  const { user } = useAuth();
  const invalidate = () => qc.invalidateQueries({ queryKey: ['notifications'] });

  // Both writes state `user_id` even though RLS already scopes them to
  // auth.uid(). A write whose blast radius rests entirely on a policy staying
  // correct is how TRIP-124 happened; the predicate costs nothing and says out
  // loud what the row set is.
  const markAllRead = useMutation({
    mutationFn: async () => {
      if (!user?.id) return; // no session: nothing to mark, and .eq(undefined) would 400
      const { error } = await supabase
        .from('notifications')
        .update({ read: true })
        .eq('user_id', user.id)
        .not('read', 'is', true);
      if (error) throw error;
    },
    onSuccess: invalidate,
  });

  const markOneRead = useMutation({
    mutationFn: async (notifId) => {
      if (!user?.id) return;
      const { error } = await supabase
        .from('notifications')
        .update({ read: true })
        .eq('user_id', user.id)
        .eq('id', notifId);
      if (error) throw error;
    },
    onSuccess: invalidate,
  });

  const respondInvite = useMutation({
    // Аннотация нужна ВЫЗЫВАЮЩЕМУ, а не этой строке: без неё `useMutation`
    // выводит тип переменных как `void`, и живой `respondInvite.mutate({...})`
    // краснеет под `// @ts-check` на стороне колокольчика.
    /** @param {{ memberId: string, action: string }} vars */
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
