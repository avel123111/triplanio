// Strip the OAuth implicit-flow `#access_token` fragment out of a URL
// (TRIP-407, 328.1 — P0).
//
// After supabase-js parses the session, the access token still sits in the URL
// hash. This module is the SINGLE stripper, so every sink that carries the
// address strips it identically.
//
// Only the FRAGMENT is touched. `search` — campaign marks, the share `?t=` token,
// the PKCE `?code=` — is preserved verbatim; supabase clears `?code=` itself.
//
// USED NOW by only ONE caller: AuthContext calls `stripAuthHash` +
// `replaceState`, but only AFTER the async session parse (earlier would break
// sign-in) — address-bar hygiene (copy-paste / referrer), NOT analytics.
//
// PostHog no longer sees the fragment at all (`disable_capture_url_hashes`,
// TRIP-500); Sentry / Vercel and the share `?t=` token are TRIP-330's, one owner
// over all sinks when it lands — not a per-sink patch here.
//
// Dependency-free on purpose so `npm test` runs it under plain `node --test`.

/**
 * The address without the auth fragment, or null when there is nothing to strip.
 *
 * Returns a fresh `pathname + search` (the whole fragment dropped) ONLY when the
 * hash carries `access_token`; null otherwise, so a caller can cheaply no-op and
 * never rewrite a URL that had no token in it.
 *
 * @param {string} pathname  e.g. window.location.pathname
 * @param {string} search    e.g. window.location.search (leading `?` or empty)
 * @param {string} hash      e.g. window.location.hash (leading `#` or empty)
 * @returns {string | null}
 */
export function stripAuthHash(pathname, search, hash) {
  if (typeof hash !== 'string' || !hash.includes('access_token')) return null;
  return `${pathname || ''}${search || ''}`;
}
