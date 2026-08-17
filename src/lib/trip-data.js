// Centralized query-cache helpers for TripView's progressive data loading.
//
// TripView splits its data into two parallel requests:
//   ['trip-shell',   tripId] - trip + cityVisits (renders skeleton/header fast)
//   ['trip-content', tripId] - hotels/activities/transfers/services/members
//
// Any mutation that touches a trip's contents should invalidate BOTH via
// invalidateTripData(qc, tripId) so the user-visible state stays consistent
// across the two queries.

import { reportDataError } from './reportDataError.js';

export const TRIP_SHELL_KEY = (tripId) => ['trip-shell', tripId];
export const TRIP_CONTENT_KEY = (tripId) => ['trip-content', tripId];

// One key = one payload shape. Every caller of a key must request the SAME
// `include`, or the screen that asks for less overwrites the shared cache entry
// with a thinner payload and the other screen silently renders empty data
// (TRIP-277: the route editor fetched ['content'] while the trip fetched
// ['content','budget'], so entering the editor wiped the budget out of the cache
// and the budget widget stayed blank until a reload). Import, never inline.
export const TRIP_SHELL_INCLUDE = ['shell'];
export const TRIP_CONTENT_INCLUDE = ['content', 'budget'];
// DocsLens fetches only the documents group through the read door (TRIP-399, §6:
// getTripDetails already applies the shared/private filter). Own cache key
// (DOCS_KEY), so it does NOT share the trip shell/content entry — but the payload
// shape stays declared here, never a bare `include: [...]` literal at the screen.
export const TRIP_DOCUMENTS_INCLUDE = ['documents'];

/**
 * Single source of truth for "did this write actually land?".
 *
 * A raw `supabase.from(...).insert|update|delete()` call swallows two distinct
 * silent failures:
 *   1. a real `{ error }` the caller forgets to read, and
 *   2. an RLS reject that returns `error: null` and **0 affected rows** —
 *      PostgREST hides rows the `USING` clause excludes (expired session,
 *      member removed from the trip, someone else's private row), so the
 *      update/delete "succeeds" having changed nothing.
 *
 * `writeRows` appends `.select()` so the affected rows come back, throws on a
 * real error, and — when `expectRow` — treats 0 rows as a rejected write. This
 * is the ONLY place that encodes the 0-row-RLS knowledge; every content write
 * goes through it instead of reinventing (or skipping) the check.
 *
 * expectRow:
 *   - `true`  (default) for insert/update — 0 rows = the write did not happen → throw.
 *   - `false`           for delete       — 0 rows is benign ("already gone", e.g.
 *                                          another member deleted the row first) → no throw.
 *
 * Correctness note: the 0-row assertion relies on the SELECT policy returning
 * the just-written row, i.e. `write-policy ⊆ select-policy` (whatever a write
 * lets through, the read must also let through). This holds today: writes are
 * gated by `_can_edit_trip` (TRIP-124) while reads use the looser
 * `is_trip_participant` / `_can_access_trip_document` (TRIP-118), and
 * `_can_edit_trip ⊆ is_trip_participant`. It must stay that way — never make a
 * table's write policy broader than its read policy, else a real write whose row
 * the reader can't see back would look (falsely) rejected.
 *
 * @param {import('@supabase/postgrest-js').PostgrestFilterBuilder} builder
 * @param {{ expectRow?: boolean }} [opts]
 * @returns {Promise<any[]>} affected rows (possibly empty for a benign delete)
 */
export async function writeRows(builder, { expectRow = true } = {}) {
  const { data, error } = await builder.select();
  // Report BEFORE throwing: a write can fail on the optimistic fire-and-forget
  // path (EventEditDialog booking create) that never reaches a React-Query cache
  // onError, so the throw alone would only surface as a toast. reportDataError
  // stamps `__seamHandled`, so when this DOES bubble through a mutation it is not
  // reported a second time by MutationCache.onError.
  if (error) { reportDataError(error, 'write'); throw error; }
  if (expectRow && !data?.length) {
    // 0 rows on insert/update = a silent RLS reject (PostgREST hid the row) —
    // a real, invisible write failure. Report it like any other.
    const rejected = new Error('write_rejected');
    reportDataError(rejected, 'write');
    throw rejected;
  }
  return data ?? [];
}

export function invalidateTripData(qc, tripId) {
  if (!tripId) return;
  qc.invalidateQueries({ queryKey: TRIP_SHELL_KEY(tripId) });
  qc.invalidateQueries({ queryKey: TRIP_CONTENT_KEY(tripId) });
}

/**
 * Optimistically add/update/remove a record in the trip-content cache.
 * kind: 'activities' | 'hotels' | 'transfers' | 'services' | 'cityVisits'
 * op:   'add' | 'update' | 'remove'
 */
export function optimisticContentUpdate(qc, tripId, kind, op, record) {
  qc.setQueryData(TRIP_CONTENT_KEY(tripId), (old) => {
    if (!old) return old;
    const list = old[kind] || [];
    let next;
    if (op === 'add') next = [...list, record];
    else if (op === 'update') next = list.map(r => r.id === record.id ? { ...r, ...record } : r);
    else next = list.filter(r => r.id !== record.id);
    return { ...old, [kind]: next };
  });
  // For cityVisits we also touch the shell cache
  if (kind === 'cityVisits') {
    qc.setQueryData(TRIP_SHELL_KEY(tripId), (old) => {
      if (!old) return old;
      const list = old.cityVisits || [];
      let next;
      if (op === 'add') next = [...list, record];
      else if (op === 'update') next = list.map(r => r.id === record.id ? { ...r, ...record } : r);
      else next = list.filter(r => r.id !== record.id);
      return { ...old, cityVisits: next };
    });
  }
}

// The cache keys a write of `kind` touches. Every entity lives in trip-content;
// cityVisits ALSO lives in the shell (header/skeleton), so a city write must
// cancel/snapshot/patch BOTH — else the shell keeps a stale city list.
function affectedKeys(tripId, kind) {
  return kind === 'cityVisits'
    ? [TRIP_CONTENT_KEY(tripId), TRIP_SHELL_KEY(tripId)]
    : [TRIP_CONTENT_KEY(tripId)];
}

/**
 * Reconcile an optimistic row with the row the write actually returned: replace
 * the tmp row (matched by `tmpId`) with `realRow` in place — same position, real
 * id. This is the happy-path reconciliation that REPLACES a full `getTripDetails`
 * refetch (TRIP-*, optimism epic): `writeRows(...).select()` already returns the
 * committed row, so there is no reason to round-trip the edge read just to learn
 * an id. If the tmp row is gone (a refetch slipped in and clobbered it) the real
 * row is appended so the entity is never lost, and never duplicated if it is
 * already present.
 */
export function swapOptimisticRow(qc, tripId, kind, tmpId, realRow) {
  const apply = (old) => {
    if (!old) return old;
    const list = old[kind] || [];
    let next;
    if (list.some(r => r.id === tmpId)) next = list.map(r => (r.id === tmpId ? realRow : r));
    // tmp row already clobbered by a refetch — append the real row, but never duplicate it.
    else if (list.some(r => r.id === realRow.id)) next = list;
    else next = [...list, realRow];
    return { ...old, [kind]: next };
  };
  for (const key of affectedKeys(tripId, kind)) qc.setQueryData(key, apply);
}

/**
 * A "cache binding" tells {@link withOptimism} HOW to touch one specific cache:
 * which query keys to cancel/snapshot/restore, and how to add/update/remove/swap
 * a row inside it. The lifecycle in `withOptimism` is identical for every screen;
 * only the cache shape differs, and that difference lives here — one binding per
 * cache, so no call site re-implements cache surgery and no second optimism
 * engine is ever written. A binding is `{ qc, keys, add, update, remove, swap }`.
 */

/**
 * Binding for a trip-content collection (hotels / activities / transfers /
 * services / budgetExpenses / budgetCategories / cityVisits). Wraps the existing
 * trip-content patchers, so the object-of-lists shape and the cityVisits→shell
 * mirroring stay defined in ONE place (optimisticContentUpdate / swapOptimisticRow).
 * add appends (trip-content lists are not display-sorted in the cache).
 */
export function tripContentBinding(qc, tripId, kind) {
  return {
    qc,
    keys: affectedKeys(tripId, kind),
    add:    (row) => optimisticContentUpdate(qc, tripId, kind, 'add', row),
    update: (row) => optimisticContentUpdate(qc, tripId, kind, 'update', row),
    remove: (id)  => optimisticContentUpdate(qc, tripId, kind, 'remove', { id }),
    swap:   (tmpId, realRow) => swapOptimisticRow(qc, tripId, kind, tmpId, realRow),
  };
}

/**
 * Binding for a bare-array cache at a single key — a list that is its own query
 * (documents `['trip-docs']`, notifications `['notifications']`, …), not a slice
 * of trip-content. `addTo: 'start'` prepends (a newest-first sorted list like
 * documents); the default appends. Never writes into a not-yet-loaded query
 * (old === undefined): an optimistic row on an unfetched list would flash a
 * one-item list where the screen should still be loading.
 */
export function listBinding(qc, key, { addTo = 'end' } = {}) {
  const patch = (fn) => qc.setQueryData(key, (old) => (old === undefined ? old : fn(old)));
  const put = (list, row) => (addTo === 'start' ? [row, ...list] : [...list, row]);
  return {
    qc,
    keys: [key],
    add:    (row) => patch((list) => put(list, row)),
    update: (row) => patch((list) => list.map(r => (r.id === row.id ? { ...r, ...row } : r))),
    remove: (id)  => patch((list) => list.filter(r => r.id !== id)),
    swap:   (tmpId, realRow) => patch((list) => {
      if (list.some(r => r.id === tmpId)) return list.map(r => (r.id === tmpId ? realRow : r));
      // tmp already clobbered by a refetch — re-insert, but never duplicate.
      return list.some(r => r.id === realRow.id) ? list : put(list, realRow);
    }),
  };
}

// ── Shared lifecycle steps for withOptimism (cancel/snapshot/patch/reconcile/
//    rollback), factored out so the phases stay named and testable in isolation ──

// Cancel in-flight refetches BEFORE patching, then snapshot every touched key.
// Cancelling first is the load-bearing step: without it a getTripDetails refetch
// can resolve after the optimistic patch and clobber it — the flicker.
async function cancelAndSnapshot({ qc, keys }) {
  await Promise.all(keys.map((queryKey) => qc.cancelQueries({ queryKey })));
  return keys.map((queryKey) => [queryKey, qc.getQueryData(queryKey)]);
}
function applyOptimistic(binding, op, vars) {
  if (op === 'remove') binding.remove(vars.id);
  else if (op === 'update') binding.update(vars.row);
  else binding.add(vars.row);
}
function reconcileFromRow(binding, op, data, vars) {
  if (op === 'remove') return;
  // writeRows returns an array of affected rows; rpc/invoke may return one flat.
  const realRow = Array.isArray(data) ? data[0] : data;
  if (!realRow) return;
  if (op === 'add') binding.swap(vars.row.id, realRow);
  else binding.update(realRow);
}
function restoreSnapshot({ qc }, snapshot) {
  for (const [queryKey, prev] of snapshot ?? []) qc.setQueryData(queryKey, prev);
}

/**
 * The canonical optimistic-mutation lifecycle, spread into `useMutation`. It
 * bakes in the exact sequence every booking/doc/member CRUD used to hand-roll —
 * and got subtly wrong six different ways (see the optimism audit):
 *
 *   onMutate:  cancelQueries → snapshot → apply the optimistic patch
 *   onSuccess: reconcile the optimistic row with the row the write RETURNED
 *              (swap tmp→real on add; authoritative merge on update) — NO refetch;
 *              then hand (data, vars) to the caller's success toast
 *   onError:   restore the snapshot, then hand (err, vars) to the caller's toast
 *
 * The call site keeps ONLY its `mutationFn` (the real write, whose return value
 * is the reconcile source) and its own toasts; it re-implements none of the
 * cache choreography. It picks the cache with a `binding` (tripContentBinding /
 * listBinding). Variables passed to `.mutate()` carry the row:
 *   add    → mutate({ row })   row.id is a tmp id (e.g. 'tmp-abc')
 *   update → mutate({ row })   row.id is the real id; row may be a partial patch
 *   remove → mutate({ id })
 *
 * WHY cancelQueries is the load-bearing line: `query-client` has no default for
 * it, and nothing in the app called it. Without it, an in-flight `getTripDetails`
 * refetch (staleTime expiry, tab refocus, a sibling invalidate) resolves AFTER
 * the optimistic patch and overwrites it with server data that doesn't yet carry
 * the new row — the "appeared → vanished → (toast) → came back" flicker. Cancel
 * first, and the optimistic state owns the cache until the write reconciles it.
 *
 * onSettled is deliberately absent: the happy path reconciles from the write's
 * own returned row, so there is no background refetch to wait on or flicker
 * through. An entity whose raw row lacks a server-derived field can opt into a
 * narrow backstop invalidate at its call site — it is NOT the default, so one
 * edit never re-pulls (and re-renders) the whole trip.
 *
 * @param {{ qc: any, keys: any[], add: Function, update: Function, remove: Function, swap: Function }} binding
 * @param {{ op: 'add'|'update'|'remove', reconcile?: boolean,
 *           onSuccess?: (data:any, vars:any)=>void, onError?: (err:any, vars:any)=>void }} [opts]
 */
export function withOptimism(binding, { op, reconcile = true, onSuccess, onError } = {}) {
  return {
    onMutate: async (vars) => {
      const snapshot = await cancelAndSnapshot(binding);
      applyOptimistic(binding, op, vars);
      return { snapshot };
    },
    onSuccess: (data, vars) => {
      if (reconcile) reconcileFromRow(binding, op, data, vars);
      onSuccess?.(data, vars);
    },
    onError: (err, vars, ctx) => {
      restoreSnapshot(binding, ctx?.snapshot);
      onError?.(err, vars);
    },
  };
}

/**
 * Fold the row a PESSIMISTIC write returned into the cache — the reconcile-from-row
 * step of the form path (create upserts it, edit merges it), shared so no dialog
 * hand-writes `binding.swap`/`binding.update` per screen. Unlike the optimistic
 * {@link reconcileFromRow} there is no tmp row to match, so `add` upserts by the
 * row's OWN id (swap dedups if a background refetch already brought it).
 *
 * @returns {boolean} true if a single row was folded; false when the write returned
 *   no single row (a layover chain / recompute reshapes many rows — the caller then
 *   does a targeted refetch instead).
 */
export function reconcileWriteRow(binding, op, data) {
  const row = Array.isArray(data) ? data[0] : data;
  if (!row || row.id == null) return false;
  if (op === 'add') binding.swap(row.id, row);
  else binding.update(row);
  return true;
}

/**
 * The canonical PESSIMISTIC form-write lifecycle — the mirror of {@link withOptimism}
 * for a create/edit dialog that STAYS MOUNTED while it writes. There is no optimistic
 * patch: the Save button carries the in-flight state (its `isPending`), and then
 *   onSuccess → `reconcile(data, vars)` folds the RETURNED row into the cache
 *               (reconcile-from-row via {@link reconcileWriteRow}, never a full
 *               refetch), then `onDone` closes the dialog;
 *   onError   → `onFail(err, vars)` surfaces the failure and the dialog STAYS OPEN
 *               — it NEVER closes on error, so the user never loses what they typed.
 * Spread into `useMutation` next to its `mutationFn`. This is the ONE place the
 * "close-on-success / keep-open-on-error / reconcile-not-refetch" contract lives, so
 * documents, bookings and budget forms share it instead of re-hand-rolling it.
 *
 * @param {{ reconcile?: (data:any, vars:any)=>void,
 *           onDone?: (data:any, vars:any)=>void,
 *           onFail?: (err:any, vars:any)=>void }} [opts]
 */
export function formWrite({ reconcile, onDone, onFail } = {}) {
  return {
    onSuccess: (data, vars) => {
      reconcile?.(data, vars);
      onDone?.(data, vars);
    },
    onError: (err, vars) => {
      onFail?.(err, vars);
    },
  };
}

/**
 * The sequence-guarded SERVER-RECOMPUTE lifecycle (the E pattern) — the third seam
 * member, for a write whose SERVER reshapes many rows (recompute_trip: the date chain
 * cascades, waypoint cities appear). Two things make it neither {@link withOptimism}
 * nor {@link formWrite}: the optimistic state is a whole-view client re-derivation the
 * CALLER owns (a "draft"), and reconciliation is a TARGETED REFETCH, not a returned
 * row. A monotonic `seq` drops stale reconciles when actions fire faster than the
 * server answers (nights stepper, DnD reorder), so the UI never snaps back to an
 * intermediate state.
 *
 * The caller keeps its draft (the optimistic patch is applied BEFORE calling) and
 * supplies the phases; this owns ONLY the ordering + the seq barriers:
 *   run       the RPC (its result flows to reconcile); omit for a bare resync
 *   reconcile on success, BEFORE the refetch, only if still latest — a best-effort
 *             side effect (tmp→real id fixup, file cleanup); a throw here is swallowed
 *             so it can't abort the commit
 *   refetch   pull fresh server state (targeted)
 *   commit    adopt server truth (e.g. clear the draft) + success toast, only if still latest
 *   rollback  drop the optimistic patch (only if still latest), on RPC failure
 *   onError   surface the refusal (always, even if superseded)
 *
 * Offline note: a failed refetch is swallowed and the commit still runs — the draft
 * is dropped and the view rebuilds from cache until a later action reconciles, exactly
 * as the hand-rolled editor did.
 *
 * @param {{ current: number }} seqRef  shared monotonic counter (one per editor instance)
 * @param {{ run?: ()=>Promise<any>, reconcile?: (result:any)=>void, refetch?: ()=>Promise<any>,
 *           commit?: ()=>void, rollback?: ()=>void, onError?: (err:any)=>void }} [phases]
 */
export async function withRecompute(seqRef, { run, reconcile, refetch, commit, rollback, onError } = {}) {
  const mySeq = ++seqRef.current;
  let result;
  try {
    result = await run?.();
  } catch (err) {
    if (mySeq === seqRef.current) rollback?.(); // a newer action owns the state → leave it
    onError?.(err);
    return;
  }
  if (mySeq !== seqRef.current) return;          // superseded before reconcile → keep optimistic
  if (reconcile) { try { reconcile(result); } catch { /* best-effort side effect */ } }
  try { await refetch?.(); } catch { /* offline: commit from cache, as before */ }
  if (mySeq !== seqRef.current) return;          // a newer action started during the refetch
  commit?.();
}