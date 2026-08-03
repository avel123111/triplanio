// What an analytics destination is allowed to see of a page address (TRIP-330).
//
// In this app an address can BE a credential: `/public/trip/:id?t=<share_token>`
// is a working, never-expiring key to someone else's trip — route, bookings,
// participants, no login. Every analytics destination gets the page address by
// construction, so without a cut the key sits in their store in clear text for
// anyone with access to that project, today us and tomorrow an ad contractor.
//
// `npm test` runs this under plain `node --test`, so the module stays
// dependency-free (same rule as campaign.js / viralLink.js). That is not
// cosmetic: this file is the whole of a security control, and a control nobody
// can test is a control nobody can trust. All THREE destinations import it —
// posthog (consent.js), Vercel Analytics (App.jsx) and Sentry (sentry.js) — so
// there is one cut with one test rather than three copies drifting apart.

const ABSOLUTE_URL = /^https?:\/\//;

/**
 * An address with its query string removed, or the value untouched when it is
 * not an address at all.
 *
 * The WHOLE query goes rather than a list of dangerous parameter names: such a
 * list is a race the next parameter always wins, and the parameter that would
 * have won it here is already in production.
 *
 * Campaign marks do NOT ride here and are unaffected: PostHog reads `utm_*` /
 * `gclid` off `document.URL` in a pass of its own and stores them as separate
 * properties, and the `camp_*` layer reads `location.search` directly.
 *
 * The fragment is deliberately NOT touched here — an OAuth return carries
 * `#access_token=…&refresh_token=…` and no `?` at all, so a cut on `?` never
 * sees it. That leak is real and is TRIP-328's; it needs the SDK's own
 * `disable_capture_url_hashes`, because the event leaves before the app has a
 * chance to clear the address bar.
 *
 * @param {unknown} value
 * @returns {unknown} the same value, query-free when it was an absolute URL
 */
export function stripQueryFromUrl(value) {
  return typeof value === 'string' && ABSOLUTE_URL.test(value) ? value.split('?')[0] : value;
}

/**
 * Take the query string off every address PostHog attached to an event, in place.
 *
 * PostHog fills several properties from `location.href` / `document.referrer` by
 * itself and any of them can carry a whole query: `$current_url` and
 * `$session_entry_url` both held live share tokens on production, `$referrer`
 * structurally can, and `$set_once` carries the `$initial_*` twins of all three.
 * Naming the properties would leave the next one the SDK adds uncovered, so
 * every value that IS an address is swept instead. `$pathname` / `$host` /
 * `$referring_domain` are query-free by construction.
 *
 * The BAGS are named rather than walked: a capture result has a fixed, small set
 * of them, and `$set` / `$set_once` appear at BOTH levels (`identify` puts them
 * beside `properties`, `setPersonProperties` one level inside it). Naming beats
 * recursion because the SDK's `_runBeforeSend` does not catch — a throw on some
 * future cyclic value would take capture down entirely, which is worse than the
 * leak. `$unset` holds key NAMES; `uuid` / `event` / `timestamp` are not
 * addresses.
 *
 * Blast radius, deliberately: this sweeps ANY value that looks like an address,
 * not only the SDK's own. No `track()` call passes a URL property today; the day
 * one does, its query will silently drop out of the event.
 *
 * @template {{properties?: Record<string, unknown>, $set?: Record<string, unknown>, $set_once?: Record<string, unknown>}} E
 * @param {E} event
 * @returns {E} the same event, edited in place (never dropped)
 */
export function scrubUrlProperties(event) {
  const properties = event?.properties;
  scrubUrls(properties);
  scrubUrls(properties?.$set);
  scrubUrls(properties?.$set_once);
  scrubUrls(event?.$set);
  scrubUrls(event?.$set_once);
  return event;
}

function scrubUrls(bag) {
  if (!bag || typeof bag !== 'object') return;
  for (const [key, value] of Object.entries(bag)) bag[key] = stripQueryFromUrl(value);
}
