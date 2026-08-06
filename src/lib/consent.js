// Cookie consent — the single owner of "may we run analytics" (TRIP-311).
//
// THE INVARIANT: `posthog.init()` is called here and nowhere else, and only for
// someone who said yes. An uninitialised client is a no-op by construction, so
// there are no consent checks on the call-sites and none of PostHog's own consent
// machinery is used — we depend on no library internals, hence no version pin.
// CI guard 2j fails the build if a second `posthog.init` appears. TRIP-227 hangs
// GTM / GA4 / ad pixels off `applyConsent`.
import posthog from 'posthog-js';
import { forgetPendingEvents, identifyUser, isAnalyticsOn, startAnalytics, stopAnalytics } from '@/lib/analytics';
import { buildConsent, parseConsent } from '@/lib/consent-record';

const STORAGE_KEY = 'tp-consent';

// "Cookie settings" listeners. An emitter, not a context: one subscriber.
const openListeners = new Set();

// All three masks matter: `__ph_opt_in_out_*` has two underscores so it misses
// the `ph_` mask, and `dmn_chk_*` is the cross-subdomain probe.
const POSTHOG_KEY = /^(ph_|__ph_opt_in_out_|dmn_chk_)/;

// The production split, shared with main.jsx. One list, not two copies.
const PROD_HOSTS = new Set(['triplanio.com', 'www.triplanio.com']);
export const isProdHost = PROD_HOSTS.has(window.location.hostname);
// True local `vite dev` is the ONLY place without the vercel.json /ingest rewrite.
const isLocalhost = ['localhost', '127.0.0.1'].includes(window.location.hostname);
// dev / preview stay silent by default so the single (free-tier) project isn't
// polluted by test traffic; enable with VITE_POSTHOG_ENABLE_DEV=true.
const analyticsEnabledHere =
  isProdHost || ['1', 'true'].includes(import.meta.env.VITE_POSTHOG_ENABLE_DEV);
const POSTHOG_TOKEN = import.meta.env.VITE_POSTHOG_PROJECT_TOKEN;

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
 * Record the answer just given and return it.
 * @param {boolean} accepted
 */
export function setConsent(accepted) {
  const record = buildConsent(accepted, Date.now());
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(record));
  } catch { /* private mode — the answer holds for this visit only */ }
  // "No" is an answer too: whatever this document held waiting for a destination
  // now has none. Not stopAnalytics() — that would flip `isAnalyticsOn()` and rob
  // the banner of the one thing it reads to decide a downgrade needs a reload.
  if (!accepted) forgetPendingEvents();
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

// Consent is per-device. Another open tab keeps a live client whose next capture
// WRITES `ph_*` back, undoing the deletion; `storage` fires only in those tabs.
// We silence rather than reload — a background tab may hold unsaved work. One-way
// on purpose: a grant elsewhere does not start analytics here.
window.addEventListener('storage', (event) => {
  if (event.key !== STORAGE_KEY || !isAnalyticsOn()) return;
  if (parseConsent(event.newValue, Date.now())?.analytics) return;
  stopAnalytics();
  clearAnalyticsStorage();
});

/**
 * Put the app in the state the record describes. Safe to call on every start:
 * it starts PostHog at most once and sends no opt-in event.
 *
 * @param {ReturnType<typeof getConsent>} record
 * @param {string} [uid]  pass when a session is already open, so the person
 *   appears immediately instead of waiting for the next auth cycle.
 */
export function applyConsent(record, uid) {
  if (!record) return;

  // Sent for a refusal too: once TRIP-227 loads tags, silence is the wrong signal.
  updateGoogleConsent(record);

  if (!record.analytics || isAnalyticsOn() || !POSTHOG_TOKEN || !analyticsEnabledHere) return;

  posthog.init(POSTHOG_TOKEN, {
    // Same-origin proxy path (TRIP-265). Post to `${origin}/ingest` on EVERY host
    // that serves this app — prod, www, dev.triplanio.com, Vercel previews — so
    // ingestion is always same-origin as the page: no CORS, no cross-host
    // redirect. The rewrite lives in vercel.json, so only true local `vite dev`
    // lacks it → there we hit PostHog EU directly.
    api_host: isLocalhost
      ? (import.meta.env.VITE_POSTHOG_HOST || 'https://eu.i.posthog.com')
      : `${window.location.origin}/ingest`,
    defaults: '2026-05-30',
    autocapture: false,
    capture_pageview: false, // our own page_view via track() replaces it (no dupe)
    capture_performance: false,
    disable_session_recording: true,
    person_profiles: 'identified_only',
  });
  // `env` super-property tags every event → prod dashboards filter env=prod.
  posthog.register({ env: isProdHost ? 'prod' : 'dev' });
  startAnalytics();
  // The account can already exist when the banner is answered — a confirmation
  // link opened on a phone that never saw it, or a visitor who ignores it and
  // signs in with Google first. AuthContext's own identify ran as a no-op back
  // then and held the marks; this is the first moment there is a PostHog to say
  // them to, and the person must be born carrying them (TRIP-335).
  if (uid) identifyUser(uid);
}

/**
 * Remove everything PostHog stored here. Runs on any start without a usable
 * answer (which also clears pre-TRIP-311 keys, no migration needed) and on
 * withdrawal.
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
 * `marketing` always equals `analytics` today (one sentence asks both), but stays
 * a separate field because TRIP-227 splits the question.
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
