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
  if (['jpg', 'jpeg', 'png', 'gif', 'webp', 'heic', 'avif'].includes(ext)) return 'img';
  return 'file';
}
