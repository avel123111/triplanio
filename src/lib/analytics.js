// Single entry point for product-analytics events (TRIP-213).
//
// Every custom event goes through track() so adding a second destination (GA4 /
// an ad pixel — TRIP-227) is a one-file change instead of touching every call
// site. Identity lives here too: identifyUser() is the ONE door onto `$identify`
// (see it for why a second one would cost us the acquisition channel), and the
// client itself is created and gated by the PostHog destination adapter.
//
// The client is booted at load (main.jsx, before React mounts), so a call here is
// live from the first screen. Consent is the SDK's own business — it boots opted
// out and `opt_in_capturing()` turns it on (see `destinations/posthog.js`), so a
// call made before the answer is dropped BY THE SDK. That is why there is no
// pre-consent queue of ours (the old `pendingEvents` hold, TRIP-335) and no
// consent check here: `isReady()` is the whole gate.
//
// Naming convention: object_action, snake_case; variant info goes in props, never
// in the event name. No PII in props (uid only, set via identify).
// Точка входа — slim-сборка пакета; почему именно она и что она не умеет,
// см. докблок в `destinations/posthog.js` (TRIP-475). Обе двери обязаны
// импортировать ОДИН вход, иначе в бандл приедут ДВЕ копии SDK.
import posthog from 'posthog-js/dist/module.slim.js';
import { CAMPAIGN_KEYS, campaignQuery, resolveCampaign } from '@/lib/campaign';
import { appendQuery } from '@/lib/viralLink';
import { entrySearch } from '@/lib/analyticsEnv';
import { getActiveMarks } from '@/lib/attribution';
import { isReady } from '@/lib/destinations/posthog';

/**
 * Capture a product-analytics event.
 *
 * Gated on `isReady()` only: on hosts where analytics is disabled there is no
 * client. Boot runs before React mounts, so a real screen event is never dropped.
 *
 * @param {string} event  snake_case event name (e.g. 'trip_deleted')
 * @param {Record<string, unknown>} [props]  event properties (no PII)
 */
export function track(event, props) {
  if (!isReady()) return;
  posthog?.capture?.(event, props);
}

/**
 * Associate the current user + subsequent events with a trip GROUP so the North
 * Star ("active trips with ≥2 participants") is a group-level metric rather than a
 * per-person one. Call on entering a trip; `props` become group properties.
 *
 * Gated unlike a plain capture: `group` is one of the calls with no `__loaded`
 * check of its own, and before init it leaves PostHog's feature-flag loader stuck
 * on `_requestInFlight` for good.
 *
 * @param {string} tripId
 * @param {Record<string, unknown>} [props]  group props, e.g. { participant_count }
 */
export function groupTrip(tripId, props) {
  if (!tripId || !isReady()) return;
  // ponytail: sets the ACTIVE group globally (standard PostHog pattern) — events
  // fired afterwards on non-trip screens still carry the last trip until the next
  // groupTrip(). Upgrade path if that pollutes: pass per-event { groups:{trip} }.
  posthog?.group?.('trip', String(tripId), props);
}

/**
 * Record the trip a user arrived through (invite / shared public link) as a
 * persisted super-property so every later event carries it — the basis for
 * referral attribution / K-factor. Called from trip screens, i.e. after boot, so
 * the register lands on a live client.
 *
 * @param {string} refTripId
 */
export function setRefTripId(refTripId) {
  if (!refTripId || !isReady()) return;
  posthog?.register?.({ ref_trip_id: String(refTripId) });
}

/**
 * Put this visit's campaign marks on an outgoing address. For links that REPLACE
 * the document: the in-memory snapshot dies with the document, so a full load
 * starts fresh with an empty one, and `getSignupMarks()` then finds nothing — a
 * stranger who arrived on a marked invite or share link and pressed the very
 * button the link exists for would register unattributed.
 *
 * The address carries the marks rather than the device storing them: it is the
 * ONE carrier across every document replacement (CTA, `/login`, the OAuth
 * `redirectTo`), and it survives a browser that refuses storage. The whitelist
 * inside `campaignQuery` is what keeps our own `?t=<share_token>` from riding along.
 *
 * Pass a bare address — a fragment, if any, is appended by the caller after this
 * (`navBase` + `#anchor` in SiteChrome), which lands it in the right order.
 *
 * @param {string} url
 * @returns {string}
 */
export function withVisitCampaign(url) {
  return appendQuery(url, campaignQuery(entrySearch));
}

/**
 * Record the ad campaign the user arrived through as persisted super-properties
 * (TRIP-316) — every later event carries it. Reads the marks the browser currently
 * holds via `attribution.getActiveMarks()` (the entry-URL snapshot, or what the
 * signup path recovered across a redirect / confirmation email), so the visitor who
 * arrived marked, ignored the banner and signed in with Google is still covered
 * (TRIP-335).
 *
 * Triggered from exactly two points: `applyConsent` on every start and answer
 * (the no-login case) and `identifyUser` (the recovered-marks case, right after
 * AuthContext stores them). Storage is per-host, so campaign links MUST point at
 * the same host the app runs on (www vs apex are different jars).
 */
export function setCampaign() {
  if (!isReady()) return;
  // The WHOLE stored set, not only its timestamp: `resolveCampaign` needs the
  // stored marks to tell the same click coming round again from a new one.
  const stored = Object.fromEntries(
    CAMPAIGN_KEYS.map((key) => [key, posthog?.get_property?.(key) ?? null]),
  );
  const decision = resolveCampaign(getActiveMarks(), stored, Date.now());
  if (!decision) return;
  // Both outcomes start by dropping what is stored: a new campaign must not blend
  // with leftovers of the old one, an expired one must stop riding events at all.
  // Only a fresh campaign writes anything back.
  CAMPAIGN_KEYS.forEach((key) => posthog?.unregister?.(key));
  if (decision.set) posthog?.register?.(decision.set);
}

/**
 * Bring the PERSON in line with the mark this browser currently holds — set it, or
 * clear it once the 30-day window has passed. Super-properties only ride events
 * born in this browser; person properties are what makes SERVER events (the Stripe
 * webhook, where the purchase completes) attributable, because person-on-events is
 * enabled for this project.
 *
 * Runs after EVERY identify(), not only for brand-new accounts: an existing user
 * who clicks a retargeting ad and logs back in is exactly the case that ends in a
 * purchase, and their new campaign would otherwise never leave the browser. Before
 * identify there is nothing to write to (`person_profiles: 'identified_only'`), so
 * this is called BY `identifyUser`.
 *
 * `camp_synced_ts` records what we last pushed, so a repeat login costs nothing
 * instead of a `$set` each time. It also makes the clear durable: the mark itself
 * is already gone from storage by then, and only the leftover marker says the
 * person still has to be cleaned. The marker MUST live in PostHog's own storage,
 * not localStorage: posthog.reset() on logout wipes the mark and the marker
 * together, so both sides come back empty and the person is left alone. A marker
 * that outlived reset() would read "mark gone" on the next login and erase a
 * campaign that had not expired — logging out would silently cost us the
 * attribution. The flip side is the one case we cannot clean: a mark that expires
 * AFTER a logout stays on the person, which is why `camp_ts` rides along on the
 * person too — a report can window on it.
 */
function syncCampaignToPerson() {
  if (!isReady()) return;
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

/**
 * Tell PostHog who this is, and sync the last-touch campaign onto the person in
 * the same breath.
 *
 * THE ONLY place the app identifies anyone (CI guard 2j). First-touch
 * (`$initial_utm_*`) is now left to PostHog's own native block — we no longer feed
 * it (TRIP-407, decision 2): the authoritative "source of signup" is the
 * `users.signup_utm_*` column written server-side. So this is a bare identify plus
 * the last-touch person sync — no `$set_once` payload.
 *
 * NOT gated on the banner (TRIP-502). A signed-in person is identified whatever
 * they answered: the account id is a pseudonymous key we already hold under the
 * contract, the banner decides device STORAGE, and the SDK keeps that promise on
 * its own — before a grant the client is opted out by config, so this call
 * neither sends `$identify` nor writes anything to the device. Gating identity
 * on the banner is what left one visit as two people and broke the signup funnel
 * (TRIP-407 → TRIP-502).
 *
 * Identify by uid ONLY — no PII (email / name) ever reaches analytics (TRIP-213);
 * personal data stays in Supabase, resolve uid → user there. A bare identify is
 * all this needs: the client never changes storage mode here, so there is nothing
 * to sequence around — consent is applied once, by `consent.applyConsent`, through
 * the SDK's own opt-in/opt-out.
 *
 * The last-touch trigger is collected here in one place: identify, then
 * `setCampaign()` (picks up whatever marks AuthContext just recovered for a fresh
 * signup, via attribution.getActiveMarks()), then `syncCampaignToPerson()` pushes
 * the resulting `camp_*` onto the person.
 *
 * @param {string} uid  the Supabase user id — no PII ever goes to analytics
 */
export function identifyUser(uid) {
  if (!uid || !isReady()) return;
  posthog?.identify?.(uid);
  setCampaign();
  syncCampaignToPerson();
}

/**
 * Forget who this was. On logout, so the next person on this device is a new
 * person: `reset()` drops the distinct id, the campaign mark and the first-touch
 * marker together — and the SDK's own copy of the consent answer, which is why
 * every logout ends in a full document load (`/login`): boot re-applies OUR
 * record (`applyConsent` in main.jsx), and the client is back in the state the
 * visitor chose. Until that load the client is back on its config default —
 * opted out, so it neither sends nor stores anything.
 */
export function resetIdentity() {
  posthog?.reset?.();
}
