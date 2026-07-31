// Booking-link helpers. There is NO hard-coded platform directory anymore: the
// favicon is fetched from whatever domain the user's booking URL points at, so
// any site works and the host name itself serves as the label.

/**
 * Ensure a URL has an http(s) scheme. Returns null for empty/invalid input.
 * Prevents relative-path navigation (e.g. "your.booking.com" being
 * resolved against the current page).
 *
 * SECURITY, do not "improve" this: anything that is not already http(s) gets the
 * scheme PREPENDED, so a stored `javascript:…` comes back as the dead-but-inert
 * `https://javascript:…`. Every `href` built from a DB-stored URL relies on that
 * (document links in DocsLens / DocumentsField / EventViewBody, TRIP-281) —
 * React 18 does NOT block javascript: URLs, its check is a dev-only warning.
 * Teaching this function to pass through "URLs that already have a scheme" would
 * silently re-open stored XSS.
 */
export function normalizeExternalUrl(url) {
  if (!url || typeof url !== 'string') return null;
  const trimmed = url.trim();
  if (!trimmed) return null;
  if (/^https?:\/\//i.test(trimmed)) return trimmed;
  return `https://${trimmed}`;
}

/** Clean hostname (without a leading www.) from a full URL or a bare domain. */
export function hostnameFromUrl(url) {
  if (!url || typeof url !== 'string') return null;
  try {
    const t = url.trim();
    const u = new URL(t.startsWith('http') ? t : `https://${t}`);
    return u.hostname.replace(/^www\./i, '') || null;
  } catch {
    return null;
  }
}

/**
 * Favicon URL (via Google's favicon service) for a domain or full URL — the
 * SINGLE owner of "favicon URL for a host" (PartnerLogo composes this too).
 * Returns null unless the host looks like a real public domain (has a dot and a
 * 2+ letter TLD). A half-typed host ("n", "book") yields no URL, so we never
 * fire the request that redirected to `t1.gstatic.com/faviconV2?url=http://n`
 * → 404 on every keystroke. (TRIP-202)
 */
export function faviconUrl(urlOrDomain) {
  const host = hostnameFromUrl(urlOrDomain);
  if (!host || !/\.[a-z]{2,}$/i.test(host)) return null;
  return `https://www.google.com/s2/favicons?domain=${host}&sz=64`;
}
