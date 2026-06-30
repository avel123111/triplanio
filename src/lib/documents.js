/**
 * Helpers for working with documents on entities that carry a
 * `documents: [{ file_url, file_name, storage_path? }]` array.
 */

/** De-dupe a documents array by file_url, dropping entries without a url. */
function dedupeByUrl(docs) {
  const seen = new Set();
  return docs.filter(d => {
    if (!d?.file_url) return false;
    if (seen.has(d.file_url)) return false;
    seen.add(d.file_url);
    return true;
  });
}

/**
 * Documents attached to an entity (hotel_stay / activity / transfer).
 * Returns [] when none are set.
 */
export function getEntityDocuments(entity) {
  if (!entity) return [];
  const docs = Array.isArray(entity.documents) ? entity.documents : [];
  return dedupeByUrl(docs);
}

/**
 * Same as getEntityDocuments but for items stored inside details (e.g. TripService).
 */
export function getDetailsDocuments(details) {
  if (!details) return [];
  const docs = Array.isArray(details.documents) ? details.documents : [];
  return dedupeByUrl(docs);
}

/**
 * Documents for any source entity, regardless of where they live: hotel /
 * activity / transfer keep them top-level, a service keeps them under
 * `details`. Mirrors the per-kind branching in EventEditDialog so callers that
 * need an entity's files (e.g. Storage cleanup on delete) stay in one place.
 */
export function getSourceDocuments(kind, entity) {
  if (!entity) return [];
  return kind === 'service'
    ? getDetailsDocuments(entity.details)
    : getEntityDocuments(entity);
}
