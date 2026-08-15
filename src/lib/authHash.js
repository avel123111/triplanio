// Strip the OAuth implicit-flow `#access_token` fragment out of the address and
// out of the first analytics event (TRIP-407, 328.1 — P0).
//
// After supabase-js parses the session, the access token still sits in the URL
// hash: in the address bar (copy-paste / referrer leak) and, because PostHog
// freezes `$session_entry_url` / `$current_url` off the first event it sees, in
// analytics too. This module is the SINGLE decider, shared by two callers on two
// different clocks:
//   - AuthContext calls `stripAuthHash` and `replaceState`, but only AFTER the
//     async session parse (earlier would break sign-in);
//   - `posthog.init`'s `before_send` (in consent.js today, destinations/posthog.js
//     in PR3) calls `stripAuthHashFromEvent` synchronously on the very first
//     event — which is frozen BEFORE that async replaceState can run.
// Both must strip identically, hence one helper.
//
// Only the FRAGMENT is touched. `search` — campaign marks, the share `?t=` token,
// the PKCE `?code=` — is preserved verbatim; supabase clears `?code=` itself.
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

/**
 * The same strip on an absolute URL string — the shape PostHog stores in
 * `$current_url` / `$session_entry_url`.
 *
 * Reuses `stripAuthHash` on the parsed parts and rebuilds `origin + rest`.
 * Returns the input unchanged when there is no token to strip, or when it does
 * not parse as a URL (never throw inside `before_send`).
 *
 * @param {string} url
 * @returns {string}
 */
export function stripAuthHashFromUrl(url) {
  if (typeof url !== 'string') return url;
  let parsed;
  try {
    parsed = new URL(url);
  } catch {
    return url;
  }
  const rest = stripAuthHash(parsed.pathname, parsed.search, parsed.hash);
  return rest === null ? url : `${parsed.origin}${rest}`;
}

/**
 * PostHog `before_send` transform: strip the auth fragment out of the two URL
 * properties PostHog freezes on the first event of a session. Mutates in place
 * and returns the event (the shape `before_send` expects). Exported pure so it is
 * unit-tested without a live client.
 *
 * @template T
 * @param {T} event  a PostHog CaptureResult (or null)
 * @returns {T}
 */
export function stripAuthHashFromEvent(event) {
  const props = event?.properties;
  if (props) {
    if (typeof props.$current_url === 'string') {
      props.$current_url = stripAuthHashFromUrl(props.$current_url);
    }
    if (typeof props.$session_entry_url === 'string') {
      props.$session_entry_url = stripAuthHashFromUrl(props.$session_entry_url);
    }
  }
  return event;
}
