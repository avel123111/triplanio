// Centralized query-cache helpers for TripView's progressive data loading.
//
// TripView splits its data into two parallel requests:
//   ['trip-shell',   tripId] - trip + cityVisits (renders skeleton/header fast)
//   ['trip-content', tripId] - hotels/activities/transfers/services/members
//
// Any mutation that touches a trip's contents should invalidate BOTH via
// invalidateTripData(qc, tripId) so the user-visible state stays consistent
// across the two queries.

export const TRIP_SHELL_KEY = (tripId) => ['trip-shell', tripId];
export const TRIP_CONTENT_KEY = (tripId) => ['trip-content', tripId];

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
  if (error) throw error;
  if (expectRow && !data?.length) throw new Error('write_rejected');
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