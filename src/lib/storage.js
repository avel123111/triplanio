/**
 * Storage key helpers for Supabase Storage.
 *
 * Supabase Storage rejects object keys containing non-ASCII characters
 * (Cyrillic, etc.), most punctuation, and whitespace with an "Invalid key"
 * error. Upload paths must therefore be sanitised before use. The original,
 * human-readable filename is kept separately (stored as `file_name`) for
 * display — only the storage key is sanitised.
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
