/**
 * Data-access layer for document writes (TRIP-66, TRIP-399).
 *
 * The ONE place the front talks to Supabase for documents. Two rails:
 *   • the `trip_documents` CARD (title/link/notes/files/visibility) is written
 *     through the single write door — edge function `trip-document` + seam
 *     `_shared/mutate.ts` (TRIP-399): право (editor), построчное право удаления
 *     (private ⇒ author), скоуп строки и форматы держит СЕРВЕР, не RLS + фронт.
 *   • an entity's `documents` array is written through the booking write door
 *     (`trip-booking/<kind>`, TRIP-405); the two-step Storage upload of the bytes
 *     stays direct front → Supabase (a declared boundary, handoff §G).
 */
import { supabase } from '@/api/supabaseClient';
import { invokeFn } from '@/lib/invokeFn';
import { ENTITY_TABLE_BY_KIND } from '@/lib/trip-entities';
import { TRIP_BUCKET, SIGNED_URL_TTL, tripStoragePath } from '@/lib/storage';
import { removeTripFiles } from '@/lib/storageCleanup';
import { isAllowedUpload, uploadContentType } from '@/lib/fileType';

/** React-query key for a trip's documents list. */
export const DOCS_KEY = (tripId) => ['trip-docs', tripId];

/**
 * Ceiling for a document upload, in MB. Matches `file_size_limit` on the `trips`
 * bucket (migration 20260731172548) — the server rejects anything larger, so a
 * bigger number here would only turn a clear message into a raw storage error.
 * Surfaces that promise the limit in their UI read it from here, so the promise
 * and the check can never drift apart.
 */
export const MAX_UPLOAD_MB = 10;

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
 * The format and size gates live HERE rather than in each screen (TRIP-281):
 * `accept` on the input only filters the picker dialog, drag-and-drop walks
 * straight past it, and every document surface funnels through this function — so
 * one check covers all of them, a future caller cannot forget it, and a bad file
 * only costs itself (the rest of the batch still uploads). The enforcing gates
 * stay on the bucket (MIME allow-list + `file_size_limit`); these fail fast, by name.
 *
 * @param {string} tripId
 * @param {Iterable<File>} files
 * @returns {Promise<{ uploaded: Array<{file_url,file_name,storage_path}>, errors: Array<{file:File, reason:'format'|'size'|'upload'|'no_url', message?:string}> }>}
 */
export async function uploadTripFiles(tripId, files) {
  const uploaded = [];
  const errors = [];
  for (const file of Array.from(files || [])) {
    if (!isAllowedUpload(file)) { errors.push({ file, reason: 'format' }); continue; }
    if (file.size > MAX_UPLOAD_MB * 1024 * 1024) { errors.push({ file, reason: 'size' }); continue; }
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
  const name = error.file.name;
  if (error.reason === 'format') return t('doc.bad_format', { name });
  if (error.reason === 'size') return t('doc.file_too_big', { name, mb: MAX_UPLOAD_MB });
  // Storage's own wording beats a generic line when we have it.
  if (error.reason === 'upload' && error.message) return error.message;
  return t('doc.upload_failed', { name });
}

/**
 * Create a `trip_documents` row through the write door (TRIP-399).
 *
 * `created_by` is stamped by the server from the JWT — the caller must NOT send
 * it. `invokeFn` never throws on a non-2xx (functions-js returns {data:null,
 * error}); a refusal comes back as `error`. We surface it as the `write_rejected`
 * sentinel (never the raw server text — invariant TRIP-378) so the screen maps
 * it to its own localized line.
 *
 * @param {object} body  { tripId, title, notes, link_url, documents, visibility, created_by_name }
 * @returns the created row (or null).
 */
export async function insertTripDocument(body) {
  const { data, error } = await invokeFn('trip-document/doc', { body });
  if (error) throw new Error('write_rejected');
  return data ?? null; // the seam answers the row payload flat
}

/**
 * Delete a `trip_documents` row through the write door (TRIP-399).
 *
 * @param {string} tripId  scopes the row and gates the right (server-side)
 * @param {string} id
 * @returns {Promise<boolean>} true if a row was deleted; false if it was already
 *   gone (seam answers 404 NOT_FOUND — another member deleted it). Callers must
 *   NOT treat false as success. Throws (write_rejected) on any other refusal
 *   (403 not-editor / private-not-owner, 401 expired) so the screen shows the
 *   generic failure — never the raw server text (TRIP-378).
 */
export async function deleteTripDocument(tripId, id) {
  const { error, code } = await invokeFn('trip-document/doc/delete', { body: { tripId, id } });
  if (error) {
    if (code === 'NOT_FOUND') return false;
    throw new Error('write_rejected');
  }
  return true;
}

/**
 * Persist an entity's `documents` array through the single write door (TRIP-405):
 * `trip-booking/<kind>` UPDATE by {id, trip_id} under service_role. Hotel/transfer/
 * activity keep documents top-level; a service keeps them under `details`. Throws
 * on refusal (so the caller can roll back its optimistic UI) — never the raw
 * server text (TRIP-378), only the generic sentinel.
 */
export async function persistEntityDocuments(kind, entity, documents) {
  if (!ENTITY_TABLE_BY_KIND[kind] || !entity?.id || !entity?.trip_id) return;
  const payload = kind === 'service'
    ? { details: { ...(entity.details || {}), documents } }
    : { documents };
  const { error, code } = await invokeFn(`trip-booking/${kind}`, {
    body: { tripId: entity.trip_id, id: entity.id, ...payload },
  });
  if (error) throw new Error(code || 'write_rejected');
}
