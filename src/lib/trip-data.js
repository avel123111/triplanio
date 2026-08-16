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
 * The canonical optimistic-mutation lifecycle, spread into `useMutation`. It
 * bakes in the exact sequence every booking/doc/member CRUD used to hand-roll —
 * and got subtly wrong six different ways (see the optimism audit):
 *
 *   onMutate:  cancelQueries → snapshot → apply the optimistic patch
 *   onSuccess: reconcile the optimistic row with the row the write RETURNED
 *              (swap tmp→real on add; authoritative merge on update) — NO refetch
 *   onError:   restore the snapshot, then hand the error to the caller's toast
 *
 * The call site keeps ONLY its `mutationFn` (the real write, whose return value
 * is the reconcile source) and its own error toast; it re-implements none of the
 * cache choreography. Variables passed to `.mutate()` carry the row:
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
 * @param {import('@tanstack/react-query').QueryClient} qc
 * @param {{ tripId: string, kind: string, op: 'add'|'update'|'remove',
 *           reconcile?: boolean, onError?: (err:any)=>void }} opts
 */
export function withOptimism(qc, { tripId, kind, op, reconcile = true, onError } = {}) {
  const keys = affectedKeys(tripId, kind);
  return {
    onMutate: async (vars) => {
      // Stop in-flight refetches BEFORE patching, so none can resolve later and
      // clobber the optimistic row. This is the fix for the flicker (see above).
      await Promise.all(keys.map((queryKey) => qc.cancelQueries({ queryKey })));
      const snapshot = keys.map((queryKey) => [queryKey, qc.getQueryData(queryKey)]);
      if (op === 'remove') optimisticContentUpdate(qc, tripId, kind, 'remove', { id: vars.id });
      else optimisticContentUpdate(qc, tripId, kind, op, vars.row);
      return { snapshot };
    },
    onSuccess: (data, vars) => {
      if (!reconcile || op === 'remove') return;
      // writeRows returns an array of affected rows; rpc/invoke may return one.
      const realRow = Array.isArray(data) ? data[0] : data;
      if (!realRow) return;
      if (op === 'add') swapOptimisticRow(qc, tripId, kind, vars.row.id, realRow);
      else optimisticContentUpdate(qc, tripId, kind, 'update', realRow);
    },
    onError: (err, _vars, ctx) => {
      for (const [queryKey, prev] of ctx?.snapshot ?? []) qc.setQueryData(queryKey, prev);
      onError?.(err);
    },
  };
}