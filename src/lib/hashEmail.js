// SHA-256 of an email address, for Google Ads enhanced conversions (TRIP-407 PR6).
//
// THE INVARIANT: the raw email never leaves this function — the caller passes an
// address in and gets a hex digest out, and only the digest is handed to gtag.
// Google matches on the SHA-256 of the NORMALISED address (trimmed + lowercased),
// so we normalise the same way before hashing, or the match silently misses.
//
// Uses the Web Crypto API (`crypto.subtle`), present in the browser and in Node's
// global scope — so this stays a dependency-free, node-testable pure function.

/**
 * The lowercase hex SHA-256 of an email, normalised (trim + lowercase) the way
 * Google expects for enhanced-conversion matching.
 *
 * @param {string} email
 * @returns {Promise<string>}  64-char lowercase hex digest
 */
export async function hashEmail(email) {
  const normalised = String(email).trim().toLowerCase();
  const bytes = new TextEncoder().encode(normalised);
  const digest = await crypto.subtle.digest('SHA-256', bytes);
  return Array.from(new Uint8Array(digest))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}
