// Single entry point for product-analytics events (TRIP-213).
//
// Every custom event capture goes through track() so that adding a second
// destination later (e.g. GA4 / an ad pixel — TRIP-227) is a one-file change
// instead of touching every call-site. Identity lives here too: identifyUser()
// is the ONE door onto `$identify` (see it for why a second one costs us the
// acquisition channel), and whether PostHog runs at all is decided by consent.js.
//
// Naming convention: object_action, snake_case; variant info goes in props,
// never in the event name. No PII in props (uid only, set via identify).
//
// Everything here is safe to call before consent: PostHog is not initialised and
// an uninitialised client is a no-op (TRIP-311). What the visit produced before
// the banner is answered is held HERE, in the memory of this document, and
// replayed by startAnalytics() — nothing is written to the device either way.
import posthog from 'posthog-js';
import { CAMPAIGN_KEYS, campaignQuery, pickSignupAttribution, readSignupAttribution, resolveCampaign, toInitialPersonProps } from '@/lib/campaign';
import { appendQuery } from '@/lib/viralLink';

// What the visit arrived with, held in memory until consent: writing marks to the
// device before someone agrees is what this ticket forbids, and by the time they
// agree the URL and the page that carried them are gone. startAnalytics() replays
// all three.
const visitSearch = typeof window === 'undefined' ? '' : window.location.search;
let visitRefTripId = '';
let pendingGroup = null;
// First-touch marks waiting for consent. Not a nicety: an account can be created
// BEFORE the banner is answered (confirmation link on a second device, or a
// visitor who signs in with Google without answering), and PostHog is a no-op
// until then. Replayed by applyConsent through identifyUser, riding INSIDE that
// `$identify` as its third argument — the only moment that lands, see there.
let pendingFirstTouch = null;
// Marks the send as done for this device, so a later login does not repost what
// set_once will discard. Mirrors `camp_synced_ts` next door.
const FIRST_TOUCH_SYNCED = 'first_touch_synced';

// Events captured before the banner is answered, waiting for a destination.
// Dropping them instead is what loses the FIRST screen of every first-time
// visitor — `public_trip_viewed`, `landing_viewed`, `login_opened` all fire on
// load, long before anyone can click a button, and no effect re-runs on consent
// (TRIP-335). A returning visitor is counted normally, so the undercount is
// invisible in the reports and hits exactly the newcomer the marked links exist
// for. Memory only, same as the three holds above: nothing reaches the device.
//
// null once the question has been answered — after a refusal or a withdrawal
// there is nothing left to wait for, and holding on would mean replaying what
// someone declined if they changed their mind later in this same document.
let pendingEvents = [];
// A visitor who ignores the banner and keeps navigating must not grow this
// without end. Keeps the FIRST events: the entry screen is the one worth having.
const MAX_PENDING_EVENTS = 50;

// Single source of truth for "analytics is live in this document". Set AFTER
// init, so a failed init cannot leave it lying.
let analyticsOn = false;

/** @returns {boolean} whether posthog.init() has completed in this document */
export function isAnalyticsOn() {
  return analyticsOn;
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
  // Never capture while analytics is off: before consent PostHog does not exist,
  // and after a withdrawal made in ANOTHER tab a capture would re-create the
  // `ph_*` keys the withdrawal just deleted. Held rather than dropped — see
  // `pendingEvents`. The timestamp rides along so a replayed view keeps the
  // minute it happened in instead of the minute the banner was answered.
  if (!analyticsOn) {
    if (pendingEvents && pendingEvents.length < MAX_PENDING_EVENTS) {
      pendingEvents.push({ event, props, timestamp: new Date() });
    }
    return;
  }
  posthog?.capture?.(event, props);
}

/** Stop feeding an already-running PostHog — init() cannot be undone. */
export function stopAnalytics() {
  analyticsOn = false;
  forgetPendingEvents();
}

/**
 * Drop what this document was holding for a destination that will not come.
 * Called on a withdrawal and on a refusal: the answer is "no", and a later
 * change of mind in this same document must not resurrect events captured while
 * it was "no".
 */
export function forgetPendingEvents() {
  pendingEvents = null;
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
  // Events LAST, so the replayed ones carry the campaign, the referring trip and
  // the group that the three lines above just registered. They go out on the
  // anonymous id and are attached to the person by the `$identify` that follows
  // — the same path `login_opened` already takes on a normal visit.
  pendingEvents?.forEach(({ event, props, timestamp }) => posthog?.capture?.(event, props, { timestamp }));
  forgetPendingEvents();
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
 * Runs after EVERY identify(), not only for brand-new accounts: an existing user
 * who clicks a retargeting ad and logs back in is exactly the case that ends in
 * a purchase, and their new campaign would otherwise never leave the browser.
 * Before identify there is nothing to write to (`person_profiles:
 * 'identified_only'`), and setPersonProperties would create a profile for an
 * anonymous visitor — which is why this is called BY `identifyUser` rather than
 * being a second thing every call-site has to remember.
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
function syncCampaignToPerson() {
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

/**
 * Tell PostHog who this is — and, in the SAME call, where the account came from.
 *
 * THE ONLY place the app identifies anyone. Not tidiness: `$identify` is the
 * event that CREATES the person, and PostHog attaches its own `$initial_*` block
 * to it — including an explicit `$initial_utm_source: null`, because it reads
 * them off the address of the first event it sees, which by then is post-OAuth
 * `/trips` or a confirmation link with a bare URL. `$initial_*` is set-once, and
 * a null IS a written value, so whoever identifies FIRST decides the answer
 * forever. A second, bare `identify(uid)` anywhere in the app would therefore
 * cost us the acquisition channel of every account it touched, silently and
 * unrepairably.
 *
 * That is what killed the previous shape (TRIP-329), a `setPersonProperties`
 * next to `identify`: measured on prod, it lost from BOTH sides. Sent after
 * `$identify`, the key was already taken by the null; sent before it, the person
 * did not exist yet (`person_profiles: 'identified_only'`) and the update had
 * nothing to land on. Handed to `identify` as `$set_once`, it rides inside that
 * same event, where the SDK spreads it OVER its own block — so it wins, and it
 * stays honest first-touch: no later click can move it.
 *
 * The value comes from the `users` COLUMN, not from the moment of signup, which
 * is what makes it survive everything the visit does not: a confirmation link
 * opened on another device, consent given after the account exists, a reload
 * between the two. `pendingFirstTouch` only covers the one gap the column
 * cannot — the profile loaded while analytics was still off, in THIS document.
 *
 * Silent for anyone who declines: PostHog does not exist for them and
 * `users.signup_utm_*` stays their only record.
 *
 * @param {string} uid  the Supabase user id — no PII ever goes to analytics
 * @param {Record<string, string> | null} [marks]  the `users` row, or the signup
 *   columns alone; omit when the caller has no profile in hand (consent.js)
 */
export function identifyUser(uid, marks) {
  if (!uid) return;

  const props = toInitialPersonProps(marks);
  if (props) pendingFirstTouch = props;
  // Nothing to identify to yet. The value is held above; applyConsent calls this
  // again the moment there is a PostHog to say it to.
  if (!analyticsOn) return;

  // One send per device: without the marker every page load would post a `$set`
  // that set_once discards anyway. Cleared by resetIdentity() on logout, so the
  // next person on this device gets their own source. Same self-guard as
  // syncCampaignToPerson.
  const firstTouch = posthog?.get_property?.(FIRST_TOUCH_SYNCED) ? null : pendingFirstTouch;
  // Identify by uid ONLY — no PII (email/name) in analytics (TRIP-213). Personal
  // data stays in Supabase; resolve uid → user there when needed. Third argument
  // is `$set_once`, second would be `$set` and would overwrite.
  posthog?.identify?.(uid, undefined, firstTouch || undefined);
  if (firstTouch) {
    posthog?.register?.({ [FIRST_TOUCH_SYNCED]: true });
    pendingFirstTouch = null;
  }
  syncCampaignToPerson();
}

/**
 * Forget who this was. On logout, so the next person on this device is a new
 * person: `reset()` drops the distinct id, the campaign mark and the first-touch
 * marker together, and the held value goes with them.
 */
export function resetIdentity() {
  pendingFirstTouch = null;
  posthog?.reset?.();
}
