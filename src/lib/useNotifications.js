// @ts-check
/**
 * One seam for the in-app notifications inbox (TRIP-282 → TRIP-408).
 *
 * The client no longer touches `notifications` directly — the table is closed.
 * A single edge reader `getInbox` returns `{ list, unreadCount }` in one call,
 * and both consumers (the bell in every AppHeader, the Inbox page) share it:
 *
 *   the LIST         `list`, newest-first, capped, enriched per-row with the
 *                    invite's `member_status` (joined in the RPC — this replaced
 *                    a per-invite `trip_members` waterfall the rows used to run).
 *   the COUNT        `unreadCount`, the real total of unread rows, not "however
 *                    many fit in the list".
 *
 * Both hooks below read the SAME react-query key (`['inbox', userId]`), so one
 * request serves the badge and the list — each hook just `select`s its slice,
 * exactly like getTrips fans one composite into cards + badge (TRIP-403). The
 * badge is needed on every screen, so the reader runs whenever a session exists;
 * the list rides the same cached response.
 *
 * Writes go through the write-seam edge `inbox` (the flag `read` is behind the
 * door now): `inbox/read` marks one row, `inbox/read-all` marks every unread row
 * of the caller by predicate — marking only the loaded page would leave the
 * (now honest) badge non-zero right after "mark all read".
 */
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { invokeFn } from '@/lib/invokeFn';
import { useAuth } from '@/lib/AuthContext';

/** Rows the bell popover renders: the head of that same list. */
export const BELL_ROWS = 30;

const INBOX_KEY = (userId) => ['inbox', userId];

/** Каждая строка `list` несёт `sender` — автора события (`created_by`),
 *  резолвнутого сервером в `{ id, full_name, avatar_url, is_deleted }` или `null`
 *  для системных строк (оплата/подписка — без человека-автора). Из него берутся
 *  живые имя и аватар в попапе и на экране инбокса (PR подготовки редизайна).
 *  @typedef {{ list: any[], unreadCount: number }} Inbox */

/** Empty inbox shape — keeps `select`s total even before the first fetch lands.
 *  @type {Inbox} */
const EMPTY_INBOX = { list: [], unreadCount: 0 };

/**
 * Shared reader. Both hooks call this with the same key, so react-query dedupes
 * to ONE request; each passes a stable `select` for its slice. The badge hook is
 * always enabled and drives the fetch; the list hook can stay lazy (bell closed)
 * and still read the cached response.
 * @param {(inbox: Inbox) => any} select
 * @param {{ enabled?: boolean }} [opts]
 */
function useInboxQuery(select, { enabled = true } = {}) {
  const { user } = useAuth();
  return useQuery({
    queryKey: INBOX_KEY(user?.id),
    queryFn: async () => {
      const { data, error } = await invokeFn('getInbox');
      if (error) throw error;
      return /** @type {Inbox} */ (data ?? EMPTY_INBOX);
    },
    enabled: enabled && !!user?.id,
    select,
    // No polling and no realtime — a tab the user returns to would otherwise sit
    // on stale rows/badge until they navigated (TRIP-208 Ф2-2a override).
    refetchOnWindowFocus: true,
  });
}

// Stable `select` references (module scope) so react-query doesn't re-run them
// every render.
/** @param {Inbox} inbox */
const selectList = (inbox) => inbox.list ?? [];
/** @param {Inbox} inbox */
const selectCount = (inbox) => inbox.unreadCount ?? 0;

/**
 * The notification list, newest first. `enabled: false` keeps a mounted-but-
 * closed consumer (the bell) from driving a fetch itself; the badge hook still
 * populates the shared cache, so the list is there when the popover opens.
 */
export function useNotificationList({ enabled = true } = {}) {
  return useInboxQuery(selectList, { enabled });
}

/** Unread badge count — the real total from the reader, not "however many fit". */
export function useUnreadNotificationCount() {
  const { data = 0 } = useInboxQuery(selectCount);
  return data;
}

/**
 * Writes. `read` / `read-all` go through the write-seam edge `inbox`; the seam
 * scopes both to the caller (`user_id = p_actor`) inside the RPC. `markAllRead`
 * marks by predicate (not the ids on screen) so the honest badge reaches zero.
 */
export function useNotificationActions() {
  const qc = useQueryClient();
  const invalidate = () => qc.invalidateQueries({ queryKey: ['inbox'] });

  const markAllRead = useMutation({
    mutationFn: async () => {
      const { error } = await invokeFn('inbox/read-all');
      if (error) throw error;
    },
    onSuccess: invalidate,
  });

  const markOneRead = useMutation({
    /** @param {string} notifId */
    mutationFn: async (notifId) => {
      const { error } = await invokeFn('inbox/read', { body: { id: notifId } });
      if (error) throw error;
    },
    onSuccess: invalidate,
  });

  const respondInvite = useMutation({
    // Аннотация нужна ВЫЗЫВАЮЩЕМУ, а не этой строке: без неё `useMutation`
    // выводит тип переменных как `void`, и живой `respondInvite.mutate({...})`
    // краснеет под `// @ts-check` на стороне колокольчика.
    /** @param {{ memberId: string, tripId: string, action: string }} vars */
    mutationFn: async ({ memberId, tripId, action }) => {
      // Edge seam trip-member-self/respond: sets user_id on the member (so the
      // accepter is a recognized participant), notifies the inviter, marks read.
      // Скоуп по trip_id (гейт guardRow row-self грузит строку под ним), id — строки.
      const { data, error } = await invokeFn('trip-member-self/respond', {
        body: { id: memberId, trip_id: tripId, action },
      });
      // Re-throw the ORIGINAL error (invokeFn stamped it __seamHandled) so the
      // global MutationCache.onError seam doesn't capture it twice.
      if (error || data?.error) throw error || new Error(data?.error || 'Failed');
    },
    onSuccess: () => {
      // Refetch the inbox — the row's `member_status` (now carried by getInbox)
      // flips accepted/declined; the trips list gains/loses the joined trip.
      invalidate();
      qc.invalidateQueries({ queryKey: ['trips'] });
    },
  });

  return { markAllRead, markOneRead, respondInvite };
}
