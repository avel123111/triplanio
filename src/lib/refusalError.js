// @ts-check
// Seam refusal → an Error carrying the generic `.code`, so a mutation's onError
// words it via `errorText` (never raw server prose, TRIP-378). One helper for
// every client shim over the write seam (`invokeFn`): tripEdit, EventEditDialog…
// The seam answers a refusal as a generic `code` (FORBIDDEN / NOT_FOUND /
// TRIP_LIMIT_REACHED / …); callers rethrow it so the surrounding mutation words
// it through `errorText(t, e.code)` — the server `message` is never shown.

/**
 * @param {string|null|undefined} code  machine `code` from `invokeFn` (not `data.code`)
 * @returns {Error & { code?: string|null }}
 */
export function refusalError(code) {
  const e = /** @type {Error & { code?: string|null }} */ (new Error(code || 'write_rejected'));
  e.code = code;
  return e;
}
