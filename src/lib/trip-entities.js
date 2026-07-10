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

import { supabase } from '@/api/supabaseClient';
import { removeTripFiles } from '@/lib/storageCleanup';
import { writeRows } from '@/lib/trip-data';

/** Source entity kind → its DB table. Single source of truth. */
export const ENTITY_TABLE_BY_KIND = {
  hotel: 'hotel_stays',
  transfer: 'transfers',
  activity: 'activities',
  service: 'trip_services',
};

/**
 * Delete a source entity row and best-effort sweep its orphaned `trips`-bucket
 * files. Files are removed ONLY when the row delete succeeded (never on a failed
 * delete / rollback). `orphanPaths` is supplied by the caller because each
 * surface knows its own set: the edit dialog tracks files staged this session,
 * the panels read them off the entity. The sweep never throws (best-effort).
 *
 * @param {string} kind - hotel | transfer | activity | service
 * @param {string} id - entity row id
 * @param {string[]} orphanPaths - object keys to remove once the row is gone
 * @returns {Promise<{ error: any, deleted: boolean }>} `deleted` is false when
 *   the row still exists after the call — a silent 0-row RLS reject (session
 *   expired / not permitted) or an already-gone row. Callers must NOT treat
 *   `deleted:false` as success (it used to look like one: bare `.delete()`
 *   returned `error:null` and the UI closed as if it worked).
 */
export async function deleteSourceEntity(kind, id, orphanPaths) {
  const table = ENTITY_TABLE_BY_KIND[kind];
  if (!table) return { error: new Error(`unknown entity kind: ${kind}`), deleted: false };
  try {
    // writeRows(expectRow:false): reads the deleted rows so a silent 0-row RLS
    // reject is visible (deleted:false) instead of a phantom success. Files are
    // swept ONLY when a row was actually removed.
    const rows = await writeRows(supabase.from(table).delete().eq('id', id), { expectRow: false });
    const deleted = rows.length > 0;
    if (deleted) removeTripFiles(orphanPaths);
    return { error: null, deleted };
  } catch (error) {
    return { error, deleted: false };
  }
}
