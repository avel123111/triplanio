/**
 * Classify a file by extension for the colour-coded type badge (.dl-ftag--<type>).
 * Shared by the documents lens, the reusable DocumentsField and the event read
 * view, so an attachment carries the same badge everywhere (TRIP-275, TRIP-281).
 *
 * Nullish-safe on purpose: the name comes out of a jsonb `documents[]` entry,
 * where nothing forces `file_name` to be present. A default parameter would
 * cover only `undefined` and let an explicit `null` throw — taking down the
 * whole screen over a missing label. Same read as `extensionOf` below.
 */
export function fileType(name) {
  const ext = (String(name ?? '').split('.').pop() || '').toLowerCase();
  if (ext === 'pdf') return 'pdf';
  if (['doc', 'docx'].includes(ext)) return 'doc';
  if (['xls', 'xlsx', 'csv'].includes(ext)) return 'xls';
  if (['jpg', 'jpeg', 'png', 'gif', 'webp', 'heic', 'heif', 'avif'].includes(ext)) return 'img';
  return 'file';
}

const IMAGE_TYPE_BY_EXTENSION = {
  jpg: 'image/jpeg', jpeg: 'image/jpeg', png: 'image/png', gif: 'image/gif',
  webp: 'image/webp', heic: 'image/heic', heif: 'image/heif', avif: 'image/avif',
};

/**
 * Every extension an upload surface accepts, mapped to the MIME type we store it
 * as (TRIP-281). One dictionary, so "may we take this" and "what do we call it"
 * cannot drift apart.
 *
 * The boundary is "a browser must never EXECUTE what we hand back": HTML and
 * SVG are the only stored formats a browser runs, so those are what this list
 * keeps out. Office formats are never executed by a browser (a macro needs
 * desktop Office plus an explicit "enable content" click), so legacy .doc/.xls
 * stay allowed — travellers really do receive them from agencies.
 *
 * The keys mirror the vocabulary of `fileType()` above, so an accepted file
 * always gets a real type badge instead of the generic one. The values must stay
 * within `allowed_mime_types` on the `trips` bucket (migration 20260731172548),
 * which is the enforcing gate — fileType.test.js reads that list back to check.
 */
const UPLOAD_TYPE_BY_EXTENSION = {
  pdf: 'application/pdf',
  doc: 'application/msword',
  docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  xls: 'application/vnd.ms-excel',
  xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  csv: 'text/csv',
  ...IMAGE_TYPE_BY_EXTENSION,
};

export const ALLOWED_IMAGE_EXTENSIONS = Object.keys(IMAGE_TYPE_BY_EXTENSION);

export const ALLOWED_UPLOAD_EXTENSIONS = Object.keys(UPLOAD_TYPE_BY_EXTENSION);

/**
 * Formats the booking parser can read: it only ever OCRs a PDF or a photo, so
 * it takes a narrower set than the document fields (EventAiBlock).
 */
export const ALLOWED_PARSER_EXTENSIONS = ['pdf', ...ALLOWED_IMAGE_EXTENSIONS];

function toAccept(exts) {
  return exts.map((e) => `.${e}`).join(',');
}

/** `accept` for document pickers (everything above). */
export const UPLOAD_ACCEPT = toAccept(ALLOWED_UPLOAD_EXTENSIONS);

/**
 * `accept` for picture-only pickers (avatar, trip cover).
 * Deliberately NOT `image/*`: that wildcard includes SVG, which is the one
 * image format a browser executes as code.
 */
export const IMAGE_ACCEPT = toAccept(ALLOWED_IMAGE_EXTENSIONS);

/** `accept` for the booking-parser picker. */
export const PARSER_ACCEPT = toAccept(ALLOWED_PARSER_EXTENSIONS);

/**
 * Is this file allowed to be uploaded?
 *
 * Checked by EXTENSION, not by `file.type`: the browser leaves `type` empty for
 * formats it doesn't know (HEIC on several desktop browsers), which would
 * reject perfectly good photos. The MIME allow-list on the Storage bucket is
 * the enforcing gate — this one exists to fail fast with a clear message.
 *
 * @param {File} file
 * @param {string[]} [allowed] - defaults to every accepted format; pass a
 *   narrower list (ALLOWED_IMAGE_EXTENSIONS, ALLOWED_PARSER_EXTENSIONS) for
 *   surfaces that take less.
 * @returns {boolean}
 */
export function isAllowedUpload(file, allowed = ALLOWED_UPLOAD_EXTENSIONS) {
  return allowed.includes(extensionOf(file));
}

/** Lowercased extension of a file, or '' when it has none. */
function extensionOf(file) {
  const name = file?.name || '';
  const dot = name.lastIndexOf('.');
  if (dot < 1) return ''; // no extension — we can't tell what it is
  return name.slice(dot + 1).toLowerCase();
}

/**
 * The MIME type an accepted file must be STORED as, or null if we can't tell.
 *
 * We label the file by extension because the browser's own label is unreliable:
 * it comes from the OS MIME table, which differs per machine (a `.csv` arrives
 * as `text/plain` where Excel isn't registered, an unknown format as
 * `application/octet-stream`). The bucket allow-list would then reject a file
 * the extension gate just accepted, and an octet-stream `.pdf` downloads instead
 * of previewing.
 *
 * Not a weakening: the browser derives its own guess from the same extension,
 * and the bucket allow-list still binds anything uploaded outside the app.
 *
 * @param {File} file
 * @returns {string|null}
 */
export function uploadContentType(file) {
  return UPLOAD_TYPE_BY_EXTENSION[extensionOf(file)] || null;
}
