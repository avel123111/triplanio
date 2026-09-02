// Cookie consent — the single owner of the visitor's answer, and the place that
// APPLIES it to the destinations. It does not create the PostHog client: main.jsx
// boots it at load and `posthog.init` lives in `destinations/posthog.js` (CI guard
// 2j moved with it).
//
// What the answer switches (TRIP-502): session REPLAY and the Google Ads tag —
// the two things that need consent under any reading. Product analytics itself
// runs from load as first-party audience measurement, and a REFUSAL stops it and
// wipes what was stored (`stopAnalytics` + `clearAnalyticsStorage`), here and in
// every other open tab. The Google consent signal (`updateGoogleConsent`) rides
// through here too, and TRIP-227 hangs GTM / GA4 off `applyConsent`.
import { identifyUser } from '@/lib/analytics';
import { isReady, onConsent, stopAnalytics } from '@/lib/destinations/posthog';
import { onConsent as adsOnConsent } from '@/lib/destinations/ads';
import { buildConsent, parseConsent, shouldSilenceOnConsentChange } from '@/lib/consent-record';

const STORAGE_KEY = 'tp-consent';

// "Cookie settings" listeners. An emitter, not a context: one subscriber.
const openListeners = new Set();

// All three masks matter: `__ph_opt_in_out_*` has two underscores so it misses
// the `ph_` mask, and `dmn_chk_*` is the cross-subdomain probe.
const POSTHOG_KEY = /^(ph_|__ph_opt_in_out_|dmn_chk_)/;

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
 * Record the answer just given and return it. Only writes the record — applying it
 * (replay + the ad tag on a grant, wipe + reload on a refusal) is applyConsent's /
 * the banner's half.
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

// Another tab changing the answer to "no". We silence + wipe rather than reload —
// a background tab may hold unsaved work; `storage` fires only in the OTHER tabs.
// Keyed on readiness: every running tab now holds the same device storage, so a
// refusal made anywhere must stop this one too. One-way on purpose: a grant
// elsewhere does not start replay here.
window.addEventListener('storage', (event) => {
  if (event.key !== STORAGE_KEY) return;
  const record = parseConsent(event.newValue, Date.now());
  if (!shouldSilenceOnConsentChange(isReady(), record)) return;
  stopAnalytics();
  clearAnalyticsStorage();
});

/**
 * Put the destinations in the state the record describes. Safe to call on every
 * start: the adapters are idempotent and send no opt-in event.
 *
 * @param {ReturnType<typeof getConsent>} record
 * @param {string} [uid]  pass when a session is already open, so the person appears
 *   immediately instead of waiting for the next auth cycle.
 */
export function applyConsent(record, uid) {
  if (!record) return;

  // Sent for a refusal too: once TRIP-227 loads tags, silence is the wrong signal.
  // MUST precede adsOnConsent — the tag reads its Consent Mode state at load.
  updateGoogleConsent(record);

  // Load the Google Ads tag on a marketing grant (TRIP-407 PR5). Dormant without
  // VITE_GADS_TAG_ID, idempotent, and off any non-prod host — so this is a no-op
  // today and stays one until the tag id is set in prod.
  adsOnConsent(record);

  // Start session replay on an analytics grant (a no-op otherwise, and idempotent).
  // The client already exists — main.jsx booted it — so this never inits.
  onConsent(record);

  // A signed-in visitor is already identified from load (TRIP-502); this call is the
  // immediate re-sync of the last-touch campaign onto the person (identifyUser owns
  // that) rather than waiting for the next profile load. Only on a grant — a refuser
  // is about to be silenced and wiped.
  if (record.analytics && uid) identifyUser(uid);
}

/**
 * Remove everything PostHog stored here (pre-TRIP-311 keys included, so no
 * migration is needed). Runs on a refusal or a withdrawal — in this tab from the
 * banner, in the others from the `storage` listener above — and nowhere else: a
 * start without a usable answer only re-asks, it must not throw away the
 * analytics id the answer does not gate (TRIP-502).
 */
export function clearAnalyticsStorage() {
  try {
    Object.keys(localStorage)
      .filter((key) => POSTHOG_KEY.test(key))
      .forEach((key) => localStorage.removeItem(key));
  } catch { /* storage disabled — nothing was written either */ }

  for (const pair of document.cookie.split(';')) {
    const name = pair.split('=')[0].trim();
    if (!POSTHOG_KEY.test(name)) continue;
    for (const domainAttr of cookieDomainAttrs()) {
      document.cookie = `${name}=; expires=Thu, 01 Jan 1970 00:00:00 GMT; path=/${domainAttr}`;
    }
  }
}

/**
 * A delete without a matching `domain` silently does nothing, and previews
 * (`*.vercel.app`) get no attribute at all — try both spellings.
 */
function cookieDomainAttrs() {
  const parts = window.location.hostname.split('.');
  return parts.length >= 2 ? ['', `; domain=.${parts.slice(-2).join('.')}`] : [''];
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
