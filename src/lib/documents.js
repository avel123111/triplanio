/**
 * Helpers for working with documents on entities that have both
 * the legacy `voucher_file_url`/`voucher_file_name` fields and the new
 * `documents: [{ file_url, file_name }]` array.
 */

/**
 * Combine legacy voucher + documents array into a single list for UI display.
 * Returns [] if neither is set.
 */
export function getEntityDocuments(entity) {
  if (!entity) return [];
  const docs = Array.isArray(entity.documents) ? entity.documents : [];
  const legacy = entity.voucher_file_url
    ? [{ file_url: entity.voucher_file_url, file_name: entity.voucher_file_name || '' }]
    : [];
  // De-dupe by url in case the legacy file was also copied into documents.
  const seen = new Set();
  const all = [...legacy, ...docs];
  return all.filter(d => {
    if (!d?.file_url) return false;
    if (seen.has(d.file_url)) return false;
    seen.add(d.file_url);
    return true;
  });
}

/**
 * Same as getEntityDocuments but for items stored inside details (e.g. TripService).
 */
export function getDetailsDocuments(details) {
  if (!details) return [];
  const docs = Array.isArray(details.documents) ? details.documents : [];
  const legacy = details.voucher_file_url
    ? [{ file_url: details.voucher_file_url, file_name: details.voucher_file_name || '' }]
    : [];
  const seen = new Set();
  const all = [...legacy, ...docs];
  return all.filter(d => {
    if (!d?.file_url) return false;
    if (seen.has(d.file_url)) return false;
    seen.add(d.file_url);
    return true;
  });
}