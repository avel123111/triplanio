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
import { useT } from '@/lib/i18n/I18nContext';
import { successToast } from '@/lib/successToast';

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

// ── Pure inbox-cache surgery (the {list, unreadCount} shape isn't a row-list, so
//    it gets its own patchers — one place, shared by the three writes). The honest
//    unread total drops by one per row that flips unread→read; mark-all zeroes it. ──

/** @param {Inbox} inbox @param {string} id */
function markReadInList(inbox, id) {
  let dec = 0;
  const list = inbox.list.map((n) => {
    if (n.id !== id || n.read) return n;
    dec = 1;
    return { ...n, read: true };
  });
  return { ...inbox, list, unreadCount: Math.max(0, (inbox.unreadCount ?? 0) - dec) };
}

/** @param {Inbox} inbox */
function markAllReadInList(inbox) {
  return { ...inbox, list: inbox.list.map((n) => ({ ...n, read: true })), unreadCount: 0 };
}

/** @param {Inbox} inbox @param {string} memberId @param {string} status */
function respondInList(inbox, memberId, status) {
  let dec = 0;
  const list = inbox.list.map((n) => {
    if (n.trip_member_id !== memberId) return n;
    if (!n.read) dec = 1;
    return { ...n, read: true, member_status: status };
  });
  return { ...inbox, list, unreadCount: Math.max(0, (inbox.unreadCount ?? 0) - dec) };
}

/**
 * Writes. `read` / `read-all` / invite `respond` go through their write-seam edges;
 * each is OPTIMISTIC on the shared inbox cache — the row's read flag (and the honest
 * badge) flip at once, no refetch — with a snapshot rollback on refusal, mirroring
 * `withOptimism` for the inbox's own `{list, unreadCount}` shape.
 */
export function useNotificationActions() {
  const qc = useQueryClient();
  const t = useT();
  const { user } = useAuth();
  const key = INBOX_KEY(user?.id);

  // cancel→snapshot→patch (onMutate) and restore-on-error, shared by all three.
  const begin = async (/** @type {(inbox: Inbox) => Inbox} */ apply) => {
    await qc.cancelQueries({ queryKey: key });
    const prev = qc.getQueryData(key);
    qc.setQueryData(key, (/** @type {any} */ old) => (old ? apply(old) : old));
    return { prev };
  };
  const rollback = (/** @type {any} */ ctx) => { if (ctx?.prev !== undefined) qc.setQueryData(key, ctx.prev); };

  const markAllRead = useMutation({
    mutationFn: async () => {
      const { error } = await invokeFn('inbox/read-all');
      if (error) throw error;
    },
    onMutate: () => begin(markAllReadInList),
    onError: (_e, _v, ctx) => rollback(ctx),
  });

  const markOneRead = useMutation({
    /** @param {string} notifId */
    mutationFn: async (notifId) => {
      const { error } = await invokeFn('inbox/read', { body: { id: notifId } });
      if (error) throw error;
    },
    onMutate: (notifId) => begin((inbox) => markReadInList(inbox, notifId)),
    onError: (_e, _v, ctx) => rollback(ctx),
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
    // PESSIMISTIC (not optimistic): responding to an invite is a real server state
    // change (member.user_id set, inviter notified, row marked read), so the UI confirms
    // only on the server response — the button carries the in-flight state
    // (respondInvite.isPending → <Btn loading>). On success we flip the row
    // (accept→active/accepted badge, decline→declined), mark it read, and fire the toast
    // together. No onMutate patch → onError needs no local rollback; the refusal surfaces
    // through the global MutationCache.onError seam.
    onSuccess: (_d, { memberId, action }) => {
      qc.setQueryData(key, (/** @type {any} */ old) => (old ? respondInList(old, memberId, action === 'accept' ? 'active' : 'declined') : old));
      successToast(t, action === 'accept' ? 'invite_accepted' : 'invite_declined');
      // Accepting joins the trip → the trips list gains it (a different cache).
      if (action === 'accept') qc.invalidateQueries({ queryKey: ['trips'] });
    },
  });

  return { markAllRead, markOneRead, respondInvite };
}
