/**
 * Storage key helpers for Supabase Storage.
 *
 * Supabase Storage rejects object keys containing non-ASCII characters
 * (Cyrillic, etc.), most punctuation, and whitespace with an "Invalid key"
 * error. Upload paths must therefore be sanitised before use. The original,
 * human-readable filename is kept separately (stored as `file_name`) for
 * display - only the storage key is sanitised.
 *
 * Uniqueness is always provided by the caller's prefix (a uuid or timestamp),
 * so collapsing characters here is safe: it never causes key collisions.
 */

/**
 * Sanitise a single filename into an ASCII-safe storage-key segment, keeping a
 * recognisable extension. Diacritics are stripped (é → e); everything outside
 * [A-Za-z0-9._-] becomes "_".
 *
 * @param {string} name - original filename (may contain Cyrillic, spaces, …)
 * @returns {string} a key-safe filename, never empty
 */
export function safeStorageName(name = 'file') {
  const raw = String(name || 'file');
  const dot = raw.lastIndexOf('.');
  const hasExt = dot > 0 && dot < raw.length - 1;

  const clean = (s) =>
    s
      .normalize('NFKD')                      // split base char + diacritic
      .replace(/[̀-ͯ]/g, '')        // drop the diacritic marks
      .replace(/[^a-zA-Z0-9._-]+/g, '_')      // collapse anything else
      .replace(/_+/g, '_')               // squash runs of underscores
      .replace(/^[._-]+|[._-]+$/g, '');  // trim leading/trailing separators

  const ext = hasExt ? clean(raw.slice(dot + 1)).slice(0, 12) : '';
  const base = (clean(hasExt ? raw.slice(0, dot) : raw).slice(0, 100)) || 'file';

  return ext ? `${base}.${ext}` : base;
}

/**
 * The single private bucket that holds every trip-scoped file (trip docs,
 * event/service attachments, AI uploads, covers). Served via long-lived signed
 * URLs. Replaces the legacy split `documents` (private) + `trip-covers`
 * (public) buckets.
 */
export const TRIP_BUCKET = 'trips';

/** Long-lived signed URL TTL (10 years) — the app convention for stored files. */
export const SIGNED_URL_TTL = 315360000;

/**
 * Prefix for cover images uploaded before a trip exists (create form / AI
 * wizard). Moved under `<tripId>/` once the trip is saved. Swept by age, never
 * by deleteTrip (a real trip prefix is always a UUID, never `_drafts`).
 */
export const DRAFT_PREFIX = '_drafts';

/**
 * Build a flat, collision-proof storage key for a trip file:
 *   `<prefix>/<uid>-<safeName>`
 * Every file of a trip lives directly under `<tripId>/` (no per-entity
 * subfolders) so the whole trip is reachable as one prefix. `uid` guarantees
 * uniqueness. Pass `prefix = tripId` normally, or `DRAFT_PREFIX` for files
 * uploaded before the trip exists.
 *
 * @param {string} prefix - tripId (or DRAFT_PREFIX)
 * @param {string} fileName - original filename (sanitised internally)
 * @returns {string} storage object key
 */
export function tripStoragePath(prefix, fileName) {
  const uid = (typeof crypto !== 'undefined' && crypto.randomUUID)
    ? crypto.randomUUID()
    : `${Date.now()}-${Math.random().toString(36).slice(2)}`;
  return `${prefix}/${uid}-${safeStorageName(fileName)}`;
}

/**
 * Parse a Supabase Storage object URL (signed / public / authenticated) into
 * `{ bucket, path }`, or null when it isn't a storage URL. Used to recover the
 * object key from a stored `cover_image_url` / `file_url` (e.g. to move a draft
 * cover under its trip prefix once the trip exists).
 *
 * @param {string} url
 * @returns {{ bucket: string, path: string } | null}
 */
export function parseStorageObjectUrl(url) {
  if (typeof url !== 'string' || !url) return null;
  const m = url.match(/\/object\/(?:sign|public|authenticated)\/([^/]+)\/([^?]+)/);
  if (!m) return null;
  let path = m[2];
  try { path = decodeURIComponent(path); } catch { /* keep raw */ }
  return { bucket: m[1], path };
}
