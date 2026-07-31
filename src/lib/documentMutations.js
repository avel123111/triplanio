/**
 * Data-access layer for document writes (TRIP-66).
 *
 * Every write to `trip_documents` or to an entity's `documents` array, plus the
 * two-step Storage upload, goes through here — the ONE place that talks to
 * Supabase for documents. Components never call `supabase.from(...).mutate()`
 * for documents directly; they call these functions (which read the write
 * result via `writeRows`, so a failure — real error OR silent 0-row RLS reject —
 * can never masquerade as success). The eslint guard (Slice 5) enforces that.
 *
 * Access model unchanged: direct front → Supabase + RLS (no edge functions);
 * this only makes the front read the result of its own write.
 */
import { supabase } from '@/api/supabaseClient';
import { writeRows } from '@/lib/trip-data';
import { ENTITY_TABLE_BY_KIND } from '@/lib/trip-entities';
import { TRIP_BUCKET, SIGNED_URL_TTL, tripStoragePath } from '@/lib/storage';
import { removeTripFiles } from '@/lib/storageCleanup';
import { isAllowedUpload, uploadContentType } from '@/lib/fileType';

/** React-query key for a trip's documents list. */
export const DOCS_KEY = (tripId) => ['trip-docs', tripId];

/**
 * Upload files to the trip bucket and mint signed URLs.
 *
 * Guarantees a returned doc ALWAYS has a real `file_url` — the previous
 * `file_url: urlData?.signedUrl || ''` masked a missing URL and pushed a
 * dead-link document into the array. Here a missing signed URL is treated as a
 * failed upload: the orphaned object is swept and the file goes to `errors`.
 *
 * Never throws; returns both the successful docs and per-file failures so the
 * caller can surface them (toast / inline) without losing the good ones.
 *
 * The format gate lives HERE rather than in each screen (TRIP-281): `accept` on
 * the input only filters the picker dialog, drag-and-drop walks straight past it,
 * and every document surface funnels through this function — so one check covers
 * all of them and a future caller cannot forget it. The enforcing gate is still
 * the bucket's MIME allow-list; this one fails fast with a nameable file.
 *
 * @returns {Promise<{ uploaded: Array<{file_url,file_name,storage_path}>, errors: Array<{file:File, reason:'format'|'upload'|'no_url', message?:string}> }>}
 */
export async function uploadTripFiles(tripId, files) {
  const uploaded = [];
  const errors = [];
  for (const file of Array.from(files || [])) {
    if (!isAllowedUpload(file)) { errors.push({ file, reason: 'format' }); continue; }
    const path = tripStoragePath(tripId, file.name);
    // Re-wrapping is the only way to stamp the canonical type (see
    // uploadContentType): storage-js sends a File as multipart, where the
    // browser owns the part's Content-Type and `contentType` is ignored.
    const body = new File([file], file.name, { type: uploadContentType(file) });
    const { error: upErr } = await supabase.storage.from(TRIP_BUCKET).upload(path, body);
    if (upErr) { errors.push({ file, reason: 'upload', message: upErr.message }); continue; }
    const { data: urlData } = await supabase.storage.from(TRIP_BUCKET).createSignedUrl(path, SIGNED_URL_TTL);
    if (!urlData?.signedUrl) {
      // Object landed but no URL → it would render as a broken link. Treat as a
      // failed upload and sweep the orphan we just created.
      await removeTripFiles([path]);
      errors.push({ file, reason: 'no_url' });
      continue;
    }
    uploaded.push({ file_url: urlData.signedUrl, file_name: file.name, storage_path: path });
  }
  return { uploaded, errors };
}

/**
 * User-facing text for one entry of {@link uploadTripFiles}' `errors`.
 *
 * Lives with the error contract so every document surface words the same failure
 * the same way — the reason codes are defined here, and nothing outside this
 * module has to know them.
 *
 * @param {{file: File, reason: string, message?: string}} error
 * @param {(key: string, vars?: object) => string} t
 * @returns {string}
 */
export function uploadErrorText(error, t) {
  if (error.reason === 'format') return t('doc.bad_format', { name: error.file.name });
  // Storage's own wording beats a generic line when we have it.
  if (error.reason === 'upload' && error.message) return error.message;
  return t('doc.upload_failed', { name: error.file.name });
}

/**
 * Insert a `trip_documents` row. Throws on error or 0-row RLS reject.
 * @returns the created row.
 */
export async function insertTripDocument(row) {
  const [created] = await writeRows(supabase.from('trip_documents').insert(row));
  return created;
}

/**
 * Delete a `trip_documents` row.
 * @returns {Promise<boolean>} true if a row was actually deleted; false if
 *   nothing matched — either already gone (benign, another member deleted it)
 *   or RLS hid it (session expired / removed from trip). Callers must NOT treat
 *   false as success. Throws only on a real error.
 */
export async function deleteTripDocument(id) {
  const rows = await writeRows(
    supabase.from('trip_documents').delete().eq('id', id),
    { expectRow: false },
  );
  return rows.length > 0;
}

/**
 * Persist an entity's `documents` array. Hotel/transfer/activity keep it
 * top-level; a service keeps it under `details`. Throws on error or 0-row RLS
 * reject (so the caller can roll back its optimistic UI).
 */
export async function persistEntityDocuments(kind, entity, documents) {
  const table = ENTITY_TABLE_BY_KIND[kind];
  if (!table || !entity?.id) return;
  const payload = kind === 'service'
    ? { details: { ...(entity.details || {}), documents } }
    : { documents };
  await writeRows(supabase.from(table).update(payload).eq('id', entity.id));
}
