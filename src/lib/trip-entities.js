// @ts-check
/**
 * Single delete primitive for trip source entities (hotel / transfer / activity
 * / service) and the canonical kind→table map.
 *
 * Why this exists (TRIP-117): "delete an event" was implemented three times —
 * EventSourcePanel (editor left-panel, optimistic), SourceViewLoader (timeline /
 * budget modal) and EventEditDialog (edit dialog, react-query). Each duplicated
 * the same core — delete the row, then clean up the entity's orphaned Storage
 * files — wrapped in its own UX flow. The cleanup was wired into one copy and
 * forgotten in the other two, leaking files. Collapsing the core here means the
 * row delete + file sweep can never again be wired in one place and missed; the
 * call sites keep only their own wrapper (optimistic cache / toast / mutation).
 */

import { invokeFn } from '@/lib/invokeFn';
import { removeTripFiles } from '@/lib/storageCleanup';

/** Source entity kind → its DB table. Single source of truth. */
export const ENTITY_TABLE_BY_KIND = {
  hotel: 'hotel_stays',
  transfer: 'transfers',
  activity: 'activities',
  service: 'trip_services',
};

/**
 * Delete a source entity row through the single write door (TRIP-405) and
 * best-effort sweep its orphaned `trips`-bucket files. The row delete now goes
 * through the seam (`trip-booking/<kind>/delete`): the editor gate + trip scope
 * live on the SERVER (service_role), not RLS + a bare client `.delete()`. Files
 * are still swept from the CLIENT (direct Storage bytes are a declared boundary,
 * handoff §G) and ONLY once the row is actually gone (never on a failed delete /
 * rollback). `orphanPaths` is supplied by the caller because each surface knows
 * its own set. The sweep never throws (best-effort).
 *
 * @param {string} kind - hotel | transfer | activity | service
 * @param {string} id - entity row id
 * @param {string} tripId - scopes the row and gates the right (server-side)
 * @param {string[]} orphanPaths - object keys to remove once the row is gone
 * @returns {Promise<{ error: any, deleted: boolean, code?: string, data?: any }>}
 *   `deleted` is false when the row no longer exists (seam answers 404 NOT_FOUND —
 *   another member removed it): callers must NOT treat it as success. `error`
 *   carries a generic `code` for a real refusal (403 not-editor / 401 expired /
 *   500) so the caller words it via `errorText` — never raw server prose (TRIP-378).
 *   `data` is the seam's success payload: for a TRANSFER delete it is
 *   `{ row: null, cities }` (returnChain) so the caller can reconcile the recomputed
 *   city dates; for leaf kinds (hotel/activity/service) it is null.
 */
export async function deleteSourceEntity(kind, id, tripId, orphanPaths) {
  if (!ENTITY_TABLE_BY_KIND[kind]) {
    return { error: new Error(`unknown entity kind: ${kind}`), deleted: false };
  }
  const { data, error, code } = await invokeFn(`trip-booking/${kind}/delete`, { body: { tripId, id } });
  if (error) {
    // 404 = row already gone: not a failure, but not a delete WE did → deleted:false
    // so the caller reconciles (undo optimistic removal) without a scary toast.
    if (code === 'NOT_FOUND') return { error: null, deleted: false };
    return { error: new Error(code || 'write_rejected'), deleted: false, code };
  }
  removeTripFiles(orphanPaths); // best-effort; the row is gone
  return { error: null, deleted: true, data: data ?? null };
}
