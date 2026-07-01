/**
 * Best-effort cleanup of orphaned objects in the `trips` Storage bucket.
 *
 * Background (TRIP-117): full trip deletion already purges the whole `<tripId>/`
 * prefix (deleteTrip → purgeBucketByPrefix), and leaving a member / deleting an
 * account purges private docs (_shared/personalDocsTeardown). What was missing
 * is cleanup for PARTIAL operations during a live trip: deleting one document,
 * detaching a file from an entity, dropping a staged upload before save, failed
 * AI parses, and cover replacement. Those left objects orphaned forever.
 *
 * Safety principle: only ever remove an object once its single DB reference is
 * gone. Each upload uses a uuid-unique key (tripStoragePath) and copyTrip is
 * born WITHOUT documents, so a `storage_path` is referenced by at most one row —
 * removing it after the reference is dropped can never orphan another row.
 *
 * Every removal is best-effort: a Storage failure must never block the primary
 * operation (the file will be swept by the trip-level purge as a fallback). The
 * source of truth is always the DB row, not the file.
 */

import { supabase } from '@/api/supabaseClient';
import { TRIP_BUCKET, parseStorageObjectUrl } from '@/lib/storage';

/**
 * Collect the `trips`-bucket object keys referenced by a `documents[]` array
 * (each `{ file_url, file_name, storage_path }`) plus an optional top-level
 * legacy `file_url`. Prefers the explicit `storage_path`; falls back to parsing
 * the object key out of a Storage URL. Non-`trips` / external URLs are skipped.
 *
 * @param {Array<{ storage_path?: string, file_url?: string }>} [documents]
 * @param {string} [fileUrl] - optional legacy top-level URL (e.g. trip_documents.file_url)
 * @returns {string[]} deduped object keys
 */
export function collectDocPaths(documents, fileUrl) {
  const out = [];
  const push = (path) => { if (typeof path === 'string' && path) out.push(path); };
  const fromUrl = (url) => {
    const parsed = parseStorageObjectUrl(url);
    if (parsed && parsed.bucket === TRIP_BUCKET) push(parsed.path);
  };

  const docs = Array.isArray(documents) ? documents : [];
  for (const d of docs) {
    if (!d) continue;
    if (typeof d.storage_path === 'string' && d.storage_path) push(d.storage_path);
    else fromUrl(d.file_url);
  }
  fromUrl(fileUrl);

  return [...new Set(out)];
}

/**
 * Best-effort removal of object keys from the `trips` bucket (chunked, never
 * throws). Returns silently on empty input or on error (logged).
 *
 * @param {string[]} paths
 */
export async function removeTripFiles(paths) {
  const unique = [...new Set((Array.isArray(paths) ? paths : []).filter(Boolean))];
  if (!unique.length) return;
  for (let i = 0; i < unique.length; i += 100) {
    const chunk = unique.slice(i, i + 100);
    try {
      const { error } = await supabase.storage.from(TRIP_BUCKET).remove(chunk);
      if (error) console.error('removeTripFiles: remove failed', error);
    } catch (e) {
      console.error('removeTripFiles: remove threw', e);
    }
  }
}
