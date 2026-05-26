// Centralized query-cache helpers for TripView's progressive data loading.
//
// TripView splits its data into two parallel requests:
//   ['trip-shell',   tripId] — trip + cityVisits (renders skeleton/header fast)
//   ['trip-content', tripId] — hotels/activities/transfers/services/members
//
// Any mutation that touches a trip's contents should invalidate BOTH via
// invalidateTripData(qc, tripId) so the user-visible state stays consistent
// across the two queries.

export const TRIP_SHELL_KEY = (tripId) => ['trip-shell', tripId];
export const TRIP_CONTENT_KEY = (tripId) => ['trip-content', tripId];

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