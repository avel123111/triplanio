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
// Every function here is safe to call before consent, but for two different
// reasons (TRIP-311). Most are no-ops because PostHog is not initialised yet and
// an uninitialised client does nothing — nothing is queued either, so events
// fired before someone agrees are dropped, which is the point. The rest
// (`groupTrip`, `setRefTripId`, `rememberAttributionForRedirect`) deliberately
// hold what the visit carried, so consenting later does not start from nothing.
import posthog from 'posthog-js';
import { CAMPAIGN_KEYS, pickSignupAttribution, readSignupAttribution, resolveCampaign } from '@/lib/campaign';

// The query this visit STARTED with, snapshotted at import — before the router
// can strip it, and long before consent may arrive. Memory only: writing marks
// to the device before someone agrees is exactly what this ticket forbids.
const visitSearch = typeof window === 'undefined' ? '' : window.location.search;

// Same idea for the invite / public link someone arrived through. PostHog's own
// storage cannot hold it yet, and by the time it can, the page that carried it
// is gone — so K-factor attribution would silently vanish for everyone who says
// yes, i.e. for the only people it is measurable on.
let visitRefTripId = '';

// Likewise the trip someone is looking at. TripView sets the group from an effect
// keyed on the trip, so consenting later does not re-run it — without replaying,
// every event of that session would miss the group the North Star counts on.
let pendingGroup = null;

// Flipped once consent.js has finished posthog.init(). The single source of
// truth for "analytics is live in this document": the two calls that create or
// mutate a PROFILE gate on it (see groupTrip), the banner asks it to decide
// whether withdrawing needs a reload, and consent.js checks it to never init
// twice. Set AFTER init, so a failed init cannot leave it lying.
let analyticsOn = false;

/** @returns {boolean} whether posthog.init() has completed in this document */
export function isAnalyticsOn() {
  return analyticsOn;
}

// Survives the OAuth round trip, which the in-memory snapshot cannot: the
// provider replaces the whole document, so the page we come back to is a fresh
// load whose URL is `/trips?code=…`, with the campaign long gone. Written only
// when someone actually starts a signup (see rememberAttributionForRedirect),
// and it is signup data rather than tracking — the same category as
// `postLoginRedirect`, which already rides sessionStorage next to it.
const REDIRECT_KEY = 'tp-signup-attribution';

/**
 * Capture a product-analytics event.
 * @param {string} event  snake_case event name (e.g. 'trip_deleted')
 * @param {Record<string, unknown>} [props]  event properties (no PII)
 */
export function track(event, props) {
  // posthog is a no-op until init runs; optional-chaining keeps call-sites safe
  // even if analytics is disabled (dev/preview without VITE_POSTHOG_ENABLE_DEV).
  posthog?.capture?.(event, props);
}

/**
 * Associate the current user + subsequent events with a trip GROUP so the North
 * Star ("active trips with ≥2 participants") is a group-level metric rather than
 * a per-person one. Call on entering a trip; `props` become group properties.
 *
 * Gated on `analyticsOn` unlike track(): `group` and `setPersonProperties` are
 * the only two calls with no `__loaded` check of their own, and calling them before
 * init leaves PostHog's feature-flag loader stuck on `_requestInFlight = true`
 * FOREVER — it survives the later init and can block flags from loading. No data
 * leaves either way; this just keeps the client sane.
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
 *
 * Kept in memory as well, because this fires on landing — before the banner has
 * been answered — while PostHog only exists afterwards. startAnalytics() replays
 * it; without that, the invite and public-link entries (the whole viral funnel)
 * would lose their source for every visitor who accepts.
 * @param {string} refTripId
 */
export function setRefTripId(refTripId) {
  if (!refTripId) return;
  visitRefTripId = String(refTripId);
  posthog?.register?.({ ref_trip_id: visitRefTripId });
}

/**
 * Hand PostHog everything this visit accumulated while it did not exist. Called
 * by consent.js immediately after init(), and only from there.
 */
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
 * Keep this visit's marks for the trip through an OAuth provider. Call right
 * before handing the page over — the snapshot above lives in the document, and
 * the provider replaces it.
 *
 * Deliberately NOT done at start-up: at that point nobody has asked for anything,
 * and writing marketing marks to the device is what this ticket removed. Here the
 * visitor has just pressed "continue with Google", so keeping what is needed to
 * finish that signup is part of the thing they asked for.
 */
export function rememberAttributionForRedirect() {
  // Straight from the snapshot, not getSignupAttribution(): that one consumes
  // the stash, so a second attempt after a failed sign-in would eat its own marks.
  const marks = readSignupAttribution(visitSearch);
  if (!marks) return;
  try {
    sessionStorage.setItem(REDIRECT_KEY, JSON.stringify(marks));
  } catch { /* private mode — attribution is lost, the signup still works */ }
}

/**
 * The signup-attribution columns for the account being created, or null.
 * Written once, at profile creation, for EVERY visitor — refusers included.
 * These columns are why "which campaign brought this signup" has an answer that
 * does not depend on consent.
 *
 * Falls back to what was stashed before an OAuth redirect. Read-and-forget: the
 * marks belong to ONE signup, and leaving them behind would credit the campaign
 * again for whoever signs up next in the same tab.
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
 * Called from startAnalytics(), i.e. the moment PostHog comes into existence.
 *
 * Reads the snapshot, never `location.search`: consent can arrive many clicks
 * after landing, and by then the query is gone. Once stored, the mark rides
 * PostHog's own storage — which is how it survives the round trip through
 * Google's OAuth screen back to /trips. Storage is per-host, so campaign links
 * MUST point at the same host the app runs on (www vs apex are different jars).
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
