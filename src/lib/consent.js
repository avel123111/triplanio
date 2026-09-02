// Cookie consent — the single owner of "may we run analytics" (TRIP-311),
// variant B (TRIP-407).
//
// This module records the visitor's answer and APPLIES it to the destinations; it
// no longer creates the PostHog client itself. Under variant B the client is
// booted (memory-only) at load by main.jsx, and consent's job is to UPGRADE it to
// device persistence — `applyConsent` → `posthogAdapter.onConsent`. `posthog.init`
// lives in `destinations/posthog.js` now (CI guard 2j moved with it). The Google
// consent signal (`updateGoogleConsent`) still rides through here, and TRIP-227
// hangs GTM / GA4 / ad pixels off `applyConsent`.
import { identifyUser } from '@/lib/analytics';
import { isPersisting, onConsent, stopAnalytics } from '@/lib/destinations/posthog';
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
 * (upgrading persistence, or reloading on a downgrade) is applyConsent's / the
 * banner's half. Under B there is no held queue to drop on a refusal any more.
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
// Keyed on `isPersisting()`, NOT readiness: under B a memory-only tab wrote nothing
// to the device, so a foreign refusal must leave it running (silencing it would
// throw away captures it was entitled to make). One-way on purpose: a grant
// elsewhere does not start persistence here.
window.addEventListener('storage', (event) => {
  if (event.key !== STORAGE_KEY) return;
  const record = parseConsent(event.newValue, Date.now());
  if (!shouldSilenceOnConsentChange(isPersisting(), record)) return;
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

  // Upgrade the memory-only client to device persistence when analytics is granted
  // (a no-op otherwise, and idempotent). The client already exists — main.jsx
  // booted it — so this never inits.
  onConsent(record);

  // A logged-in visitor is already identified from load now (TRIP-502: identify
  // rides readiness, not consent). This grant-time call is the immediate re-sync:
  // the person just flipped to persisting, so re-run identify + last-touch campaign
  // (identifyUser owns that) at once rather than waiting for the next profile load.
  if (record.analytics && uid) identifyUser(uid);
}

/**
 * Remove everything PostHog stored here. Runs on any start without a usable answer
 * (which also clears pre-TRIP-311 keys, no migration needed) and on withdrawal.
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
