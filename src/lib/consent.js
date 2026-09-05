// Cookie consent — the single owner of "what did the visitor answer" (TRIP-311).
//
// This module records the answer and hands it to the destinations; each
// destination keeps its own promise with its own native switch (TRIP-502):
// PostHog's `opt_in_capturing` / `opt_out_capturing` (silent by config until a
// grant), Google's Consent Mode (`gtag('consent','update')`), OpenAI's
// `oaiq('consent', …)`. Nothing is wiped, stashed, silenced or reloaded here — a
// withdrawal is an SDK call, and the SDK clears what it stored. The client itself
// is created at load by `destinations/posthog.js` (CI guard 2j lives there).
//
// The record is ours (`tp-consent`), not the SDKs' own copies: it is applied on
// every start, so a copy an SDK lost (logout resets PostHog, and its reset
// forgets consent too) is put back from the one answer the visitor actually gave.
import { identifyUser, setCampaign } from '@/lib/analytics';
import { onConsent } from '@/lib/destinations/posthog';
import { onConsent as adsOnConsent } from '@/lib/destinations/ads';
import { onConsent as openaiAdsOnConsent } from '@/lib/destinations/openaiAds';
import { buildConsent, parseConsent } from '@/lib/consent-record';

const STORAGE_KEY = 'tp-consent';

// "Cookie settings" listeners. An emitter, not a context: one subscriber.
const openListeners = new Set();

/**
 * The visitor's current answer, or null when there isn't a usable one.
 * @returns {{v:number, ts:string, analytics:boolean, marketing:boolean}|null}
 */
export function getConsent() {
  try {
    return parseConsent(localStorage.getItem(STORAGE_KEY), Date.now());
  } catch {
    // Private mode / storage disabled — the same as never having answered.
    return null;
  }
}

/**
 * Record the answer just given and return it. Only writes the record — applying
 * it is `applyConsent`.
 * @param {boolean} accepted
 */
export function setConsent(accepted) {
  const record = buildConsent(accepted, Date.now());
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(record));
  } catch { /* private mode — the answer holds for this visit only */ }
  return record;
}

/** Show the panel again. Changes nothing by itself — only its buttons write. */
export function openConsentBanner() {
  openListeners.forEach((listener) => listener());
}

/** @param {() => void} listener @returns {() => void} unsubscribe */
export function subscribeConsentOpen(listener) {
  openListeners.add(listener);
  return () => openListeners.delete(listener);
}

/**
 * Put every destination in the state the record describes. Called on every start
 * (main.jsx, right after boot) and on every answer (the banner). Safe to repeat:
 * the adapters are idempotent, and none of them sends an opt-in event.
 *
 * `null` (no usable answer — never asked, expired, our version moved,
 * hand-edited) is a valid input: PostHog is opted out by config until a grant,
 * so the adapters only have to undo a grant they still remember.
 *
 * Another tab changing the answer is NOT mirrored live: the SDKs read their
 * state on load, so the other tab follows on its next navigation. A background
 * tab may hold unsaved work; it is not reloaded for this.
 *
 * @param {ReturnType<typeof getConsent>} record
 * @param {string} [uid]  pass when a session is already open, so the person is
 *   (re)identified now instead of on the next auth cycle.
 */
export function applyConsent(record, uid) {
  // Google first, and for a refusal too: the tag reads its Consent Mode state at
  // load, and once loaded silence is the wrong signal. The `denied` default lives
  // in index.html, so a null record has nothing to update.
  if (record) updateGoogleConsent(record);

  // The ad pixels load on a marketing grant. Dormant without their ids,
  // idempotent, prod-only. A withdrawal reaches Google through Consent Mode
  // above and OpenAI through the pixel's own `oaiq('consent', false)`.
  adsOnConsent(record);
  openaiAdsOnConsent(record);

  // PostHog: two native calls and nothing else — `opt_in_capturing()` on a grant
  // (which also makes the SDK send the initial `$pageview` it withheld at load),
  // `opt_out_capturing()` on a refusal (which wipes what was stored). The client
  // already exists: main.jsx booted it, silent.
  onConsent(record);

  // Campaign marks on this visit's events, for the visitor who has no account yet.
  // After the switch above, because a grant is the moment capture starts at all.
  setCampaign();

  // The account can already exist when the banner is answered — a confirmation
  // link opened on a phone that never saw it, or a visitor who ignored the banner
  // and signed in with Google first. Identify now rather than on the next auth
  // cycle, so this visit's events belong to the account from here on.
  if (uid) identifyUser(uid);
}

/**
 * The stub and the `denied` default live in index.html; this is only the update.
 * `marketing` always equals `analytics` today (one sentence asks both), but stays a
 * separate field because TRIP-227 splits the question.
 */
function updateGoogleConsent(record) {
  const ads = record.marketing ? 'granted' : 'denied';
  window.gtag?.('consent', 'update', {
    analytics_storage: record.analytics ? 'granted' : 'denied',
    ad_storage: ads,
    ad_user_data: ads,
    ad_personalization: ads,
  });
}
