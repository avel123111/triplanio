/**
 * Frontend helper to invalidate budget-related queries after a mutation that
 * affects the source entities (hotel/transfer/activity/service). The backend
 * automations handle the actual sync; the UI just needs to re-fetch.
 */

export function invalidateBudgetQueries(qc, tripId) {
  if (!tripId) return;
  qc.invalidateQueries({ queryKey: ['budget-categories', tripId] });
  qc.invalidateQueries({ queryKey: ['budget-expenses', tripId] });
  qc.invalidateQueries({ queryKey: ['trip-budget', tripId] });
}