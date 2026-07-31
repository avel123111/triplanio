/**
 * Classify a file by extension for the colour-coded type badge (.dl-ftag--<type>).
 * Shared by the documents lens (DocsLens) and the reusable DocumentsField so the
 * upload field looks identical everywhere (TRIP-275).
 */
export function fileType(name = '') {
  const ext = (name.split('.').pop() || '').toLowerCase();
  if (ext === 'pdf') return 'pdf';
  if (['doc', 'docx'].includes(ext)) return 'doc';
  if (['xls', 'xlsx', 'csv'].includes(ext)) return 'xls';
  if (['jpg', 'jpeg', 'png', 'gif', 'webp', 'heic', 'heif', 'avif'].includes(ext)) return 'img';
  return 'file';
}

/**
 * Extensions accepted by every upload surface (TRIP-281).
 *
 * The boundary is "a browser must never EXECUTE what we hand back": HTML and
 * SVG are the only stored formats a browser runs, so those are what this list
 * keeps out. Office formats are never executed by a browser (a macro needs
 * desktop Office plus an explicit "enable content" click), so legacy .doc/.xls
 * stay allowed — travellers really do receive them from agencies.
 *
 * Mirrors the vocabulary of `fileType()` above, so an accepted file always gets
 * a real type badge instead of the generic one.
 */
export const ALLOWED_IMAGE_EXTENSIONS = [
  'jpg', 'jpeg', 'png', 'gif', 'webp', 'heic', 'heif', 'avif',
];

export const ALLOWED_UPLOAD_EXTENSIONS = [
  'pdf',
  'doc', 'docx', 'xls', 'xlsx', 'csv',
  ...ALLOWED_IMAGE_EXTENSIONS,
];

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
  const name = file?.name || '';
  const dot = name.lastIndexOf('.');
  if (dot < 1) return false; // no extension — we can't tell what it is
  return allowed.includes(name.slice(dot + 1).toLowerCase());
}
