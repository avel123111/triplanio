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
// Analytics/telemetry sinks (PostHog `$session_entry_url`/`$current_url`, Sentry,
// Vercel) still carry the token, and the share `?t=` token leaks the same way.
// Both cuts belong to ONE owner over ALL sinks — the deferred `analyticsUrl.js`
// (TRIP-330 / Часть 5), NOT a per-sink patch here. `stripAuthHashFromUrl` /
// `stripAuthHashFromEvent` below are groundwork FOR that owner and are not wired
// into any init yet; their tests stay so the shape is pinned when it lands.
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
 * The same strip on an absolute URL string — the shape a telemetry sink stores
 * (PostHog `$current_url` / `$session_entry_url`, Sentry, Vercel).
 *
 * Groundwork consumed by `analyticsUrl.js` (TRIP-330 / Часть 5) — not wired in
 * yet. Reuses `stripAuthHash` on the parsed parts and rebuilds `origin + rest`.
 * Returns the input unchanged when there is no token to strip, or when it does
 * not parse as a URL (a URL sanitiser must never throw).
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
 * Groundwork consumed by `analyticsUrl.js` (TRIP-330 / Часть 5) — not wired into
 * `posthog.init` yet: the epic's core PRs do NO URL transformation, one owner
 * does every sink at once.
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
