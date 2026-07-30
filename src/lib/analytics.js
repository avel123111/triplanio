// Single entry point for product-analytics events (TRIP-213).
//
// Every custom event capture goes through track() so that adding a second
// destination later (e.g. GA4 / an ad pixel — TRIP-227) is a one-file change
// instead of touching every call-site. Identity (identify/reset) and the
// env-gate / opt-out live in main.jsx (posthog.init) and AuthContext; this
// wrapper is only for events.
//
// Naming convention: object_action, snake_case; variant info goes in props,
// never in the event name. No PII in props (uid only, set via identify).
import posthog from 'posthog-js';
import { CAMPAIGN_KEYS, resolveCampaign } from '@/lib/campaign';

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
 * @param {string} tripId
 * @param {Record<string, unknown>} [props]  group props, e.g. { participant_count }
 */
export function groupTrip(tripId, props) {
  if (!tripId) return;
  // ponytail: sets the ACTIVE group globally (standard PostHog pattern) — events
  // fired afterwards on non-trip screens still carry the last trip until the next
  // groupTrip(). Upgrade path if that pollutes: pass per-event { groups:{trip} }.
  posthog?.group?.('trip', String(tripId), props);
}

/**
 * Record the trip a user arrived through (invite / shared public link) as a
 * persisted super-property so every later event carries it — the basis for
 * referral attribution / K-factor. Safe while anonymous (rides localStorage).
 * @param {string} refTripId
 */
export function setRefTripId(refTripId) {
  if (!refTripId) return;
  posthog?.register?.({ ref_trip_id: String(refTripId) });
}

/**
 * Record the ad campaign the user arrived through as persisted super-properties
 * (TRIP-316) — same pattern as setRefTripId, so every later event carries it.
 * Call once at start-up, BEFORE the first render: `landing_viewed` fires from an
 * effect in App.jsx, and without the mark the ad click itself is unattributed.
 *
 * The mark does not ride the URL, it rides PostHog's own storage — which is why
 * it survives the round trip through Google's OAuth screen back to /trips, where
 * the query string is long gone. Storage is per-host, so campaign links MUST
 * point at the same host the app runs on (www vs apex are different jars).
 */
export function setCampaign() {
  const decision = resolveCampaign(
    window.location.search,
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
