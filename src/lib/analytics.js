// Single entry point for product-analytics events (TRIP-213).
//
// Every custom event capture goes through track() so that adding a second
// destination later (e.g. GA4 / an ad pixel — TRIP-227) is a one-file change
// instead of touching every call-site. Identity (identify/reset) lives in
// AuthContext, and whether PostHog runs at all is decided by consent.js.
//
// Naming convention: object_action, snake_case; variant info goes in props,
// never in the event name. No PII in props (uid only, set via identify).
//
// Everything here is safe to call before consent: PostHog is not initialised, an
// uninitialised client is a no-op, and nothing is queued (TRIP-311).
import posthog from 'posthog-js';
import { CAMPAIGN_KEYS, campaignQuery, pickSignupAttribution, readSignupAttribution, resolveCampaign } from '@/lib/campaign';
import { appendQuery } from '@/lib/viralLink';

// What the visit arrived with, held in memory until consent: writing marks to the
// device before someone agrees is what this ticket forbids, and by the time they
// agree the URL and the page that carried them are gone. startAnalytics() replays
// all three.
const visitSearch = typeof window === 'undefined' ? '' : window.location.search;
let visitRefTripId = '';
let pendingGroup = null;

// Single source of truth for "analytics is live in this document". Set AFTER
// init, so a failed init cannot leave it lying.
let analyticsOn = false;

/** @returns {boolean} whether posthog.init() has completed in this document */
export function isAnalyticsOn() {
  return analyticsOn;
}

const ABSOLUTE_URL = /^https?:\/\//;

/**
 * An address with its query string removed, or the value untouched when it is
 * not one. Every analytics destination gets the page address, and in this app an
 * address can BE a credential: `/public/trip/:id?t=<share_token>` is a working,
 * never-expiring key to someone else's trip, so it would sit in the analytics
 * store in clear text for anyone with access to that project (TRIP-330).
 *
 * The whole query goes rather than a list of dangerous parameter names: such a
 * list is a race the next parameter always wins. Same cut, for the same reason,
 * as `sentry.js` makes on `event.request.url` — the third destination that gets
 * the address.
 *
 * Campaign marks do NOT ride here and are unaffected: PostHog reads `utm_*` /
 * `gclid` off `document.URL` in a pass of its own and stores them as separate
 * properties, and the `camp_*` layer above reads `location.search` directly.
 *
 * @param {unknown} value
 * @returns {unknown} the same value, query-free when it was an absolute URL
 */
export function stripQueryFromUrl(value) {
  return typeof value === 'string' && ABSOLUTE_URL.test(value) ? value.split('?')[0] : value;
}

// Survives the OAuth round trip, which the in-memory snapshot cannot: the
// provider replaces the whole document. Same category as `postLoginRedirect`,
// which already rides sessionStorage next to it.
const REDIRECT_KEY = 'tp-signup-attribution';

/**
 * Capture a product-analytics event.
 * @param {string} event  snake_case event name (e.g. 'trip_deleted')
 * @param {Record<string, unknown>} [props]  event properties (no PII)
 */
export function track(event, props) {
  // Only matters after a withdrawal made in ANOTHER tab: capturing there would
  // re-create the `ph_*` keys the withdrawal just deleted.
  if (!analyticsOn) return;
  posthog?.capture?.(event, props);
}

/** Stop feeding an already-running PostHog — init() cannot be undone. */
export function stopAnalytics() {
  analyticsOn = false;
}

/**
 * Drop the OAuth stash unused: the sign-in belonged to an existing account, so
 * there was no signup to attribute, and leaving the marks would credit them to
 * whoever registers next in this tab.
 */
export function forgetStashedAttribution() {
  try {
    sessionStorage.removeItem(REDIRECT_KEY);
  } catch { /* nothing stored, nothing to forget */ }
}

/**
 * Associate the current user + subsequent events with a trip GROUP so the North
 * Star ("active trips with ≥2 participants") is a group-level metric rather than
 * a per-person one. Call on entering a trip; `props` become group properties.
 *
 * Gated unlike track(): `group` and `setPersonProperties` are the only calls with
 * no `__loaded` check of their own, and before init they leave PostHog's
 * feature-flag loader stuck on `_requestInFlight` for good.
 * @param {string} tripId
 * @param {Record<string, unknown>} [props]  group props, e.g. { participant_count }
 */
export function groupTrip(tripId, props) {
  if (!tripId) return;
  if (!analyticsOn) { pendingGroup = { tripId, props }; return; }
  // ponytail: sets the ACTIVE group globally (standard PostHog pattern) — events
  // fired afterwards on non-trip screens still carry the last trip until the next
  // groupTrip(). Upgrade path if that pollutes: pass per-event { groups:{trip} }.
  posthog?.group?.('trip', String(tripId), props);
}

/**
 * Record the trip a user arrived through (invite / shared public link) as a
 * persisted super-property so every later event carries it — the basis for
 * referral attribution / K-factor.
 * @param {string} refTripId
 */
export function setRefTripId(refTripId) {
  if (!refTripId) return;
  visitRefTripId = String(refTripId);
  posthog?.register?.({ ref_trip_id: visitRefTripId });
}

/** Hand PostHog what this visit accumulated. Called by consent.js after init(). */
export function startAnalytics() {
  analyticsOn = true;
  setCampaign();
  if (visitRefTripId) posthog?.register?.({ ref_trip_id: visitRefTripId });
  if (pendingGroup) {
    groupTrip(pendingGroup.tripId, pendingGroup.props);
    pendingGroup = null;
  }
}

/**
 * Keep this visit's marks through an OAuth provider. Called on the button, not at
 * start-up: pressing "continue with Google" is the request that makes storing
 * them part of the service, before that nobody asked for anything.
 */
export function rememberAttributionForRedirect() {
  // Not getSignupAttribution(): that one consumes the stash, so a retry after a
  // failed sign-in would eat its own marks.
  const marks = readSignupAttribution(visitSearch);
  if (!marks) return;
  try {
    sessionStorage.setItem(REDIRECT_KEY, JSON.stringify(marks));
  } catch { /* private mode — attribution is lost, the signup still works */ }
}

/**
 * Put this visit's campaign marks on an outgoing address. For links that REPLACE
 * the document: the snapshot above lives in memory only, so a full load starts a
 * new document with an empty one, and `getSignupAttribution()` then finds nothing
 * — a stranger who arrived on a marked invite or share link and pressed the very
 * button the link exists for would register unattributed.
 *
 * The address carries the marks rather than the device storing them: nothing is
 * written before consent, so the question TRIP-311 answers does not even arise,
 * and unlike the OAuth stash next to it this survives a host change. The
 * whitelist inside `campaignQuery` is what keeps our own `?t=<share_token>` from
 * riding along.
 *
 * Pass a bare address — a fragment, if any, is appended by the caller after this
 * (`navBase` + `#anchor` in SiteChrome), which lands it in the right order.
 *
 * @param {string} url
 * @returns {string}
 */
export function withVisitCampaign(url) {
  return appendQuery(url, campaignQuery(visitSearch));
}

/**
 * The signup-attribution columns for the account being created, or null. Written
 * for EVERY visitor, refusers included — this is why "which campaign brought
 * this signup" has an answer that does not depend on consent.
 *
 * Read-and-forget: the marks belong to ONE signup.
 */
export function getSignupAttribution() {
  const fromUrl = readSignupAttribution(visitSearch);
  if (fromUrl) return fromUrl;

  try {
    const stashed = sessionStorage.getItem(REDIRECT_KEY);
    if (!stashed) return null;
    sessionStorage.removeItem(REDIRECT_KEY);
    return pickSignupAttribution(JSON.parse(stashed));
  } catch {
    return null;
  }
}

/**
 * Record the ad campaign the user arrived through as persisted super-properties
 * (TRIP-316) — same pattern as setRefTripId, so every later event carries it.
 *
 * Reads the snapshot, never `location.search`: consent arrives long after
 * landing. Once stored, the mark rides PostHog's own storage, which is how it
 * survives Google's OAuth screen. Storage is per-host, so campaign links MUST
 * point at the same host the app runs on (www vs apex are different jars).
 */
function setCampaign() {
  const decision = resolveCampaign(
    visitSearch,
    posthog?.get_property?.('camp_ts') || null,
    Date.now(),
  );
  if (!decision) return;
  // Both outcomes start by dropping what is stored: a new campaign must not
  // blend with leftovers of the old one, an expired one must stop riding events
  // at all. Only a fresh campaign writes anything back.
  CAMPAIGN_KEYS.forEach((key) => posthog?.unregister?.(key));
  if (decision.set) posthog?.register?.(decision.set);
}

/**
 * Bring the PERSON in line with the mark this browser currently holds — set it,
 * or clear it once the 30-day window has passed. Super-properties only ride
 * events born in this browser; person properties are what makes SERVER events
 * (the Stripe webhook, where the purchase actually completes) attributable,
 * because person-on-events is enabled for this project.
 *
 * Call after EVERY identify(), not only for brand-new accounts: an existing user
 * who clicks a retargeting ad and logs back in is exactly the case that ends in
 * a purchase, and their new campaign would otherwise never leave the browser.
 * Before identify there is nothing to write to (`person_profiles:
 * 'identified_only'`), and setPersonProperties would create a profile for an
 * anonymous visitor.
 *
 * `camp_synced_ts` records what we last pushed, so a repeat login — identify()
 * runs on every page load — costs nothing instead of a $set event each time. It
 * also makes the clear durable: the mark itself is already gone from storage by
 * then, and only the leftover marker says the person still has to be cleaned.
 *
 * The marker MUST live in PostHog's own storage, not in localStorage next to
 * the other app keys: posthog.reset() on logout wipes the mark and the marker
 * together, so both sides come back empty and the person is left alone. A
 * marker that outlived reset() would read "mark gone" on the next login and
 * erase a campaign that had not expired at all — logging out would silently
 * cost us the attribution. The flip side is the one case we cannot clean: a
 * mark that expires AFTER a logout stays on the person, which is why `camp_ts`
 * rides along on the person too — a report can window on it.
 */
export function syncCampaignToPerson() {
  if (!analyticsOn) return;
  const ts = posthog?.get_property?.('camp_ts') || '';
  if ((posthog?.get_property?.('camp_synced_ts') || '') === ts) return;

  if (ts) {
    const props = {};
    CAMPAIGN_KEYS.forEach((key) => {
      const value = posthog?.get_property?.(key);
      if (value) props[key] = value;
    });
    posthog?.setPersonProperties?.(props);
    posthog?.register?.({ camp_synced_ts: ts });
  } else {
    // Expired: without this the person keeps the old campaign for good, and a
    // server-side purchase a year later still credits it. The marker goes away
    // rather than turning into an empty string that would ride every event.
    posthog?.unsetPersonProperties?.(CAMPAIGN_KEYS);
    posthog?.unregister?.('camp_synced_ts');
  }
}
