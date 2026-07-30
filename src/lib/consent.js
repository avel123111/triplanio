// Cookie consent — the single owner of "may we run analytics" (TRIP-311).
//
// THE INVARIANT: `posthog.init()` is called here and nowhere else, and only for
// someone who said yes. Until then PostHog does not exist in the browser, and an
// uninitialised client makes every call in the codebase a no-op by construction
// (`capture` / `identify` / `reset` are gated on `__loaded`; `register` /
// `get_property` ride `persistence?.`). That is why there are no consent checks
// scattered over the call-sites, why none of PostHog's own consent machinery
// (`opt_in/opt_out`, `cookieless_mode`, `__ph_opt_in_out_*`) is used, and why the
// version is not pinned — we depend on no library internals. CI guard 2j fails
// the build if a second `posthog.init` appears.
//
// TRIP-227 hangs GTM / GA4 / ad pixels off `applyConsent` — one place, so the
// second entry point never appears.
import posthog from 'posthog-js';
import { isAnalyticsOn, startAnalytics, syncCampaignToPerson } from '@/lib/analytics';
import { buildConsent, parseConsent } from '@/lib/consent-record';

const STORAGE_KEY = 'tp-consent';

// Listeners that want the panel shown again ("Cookie settings"). A one-line
// emitter rather than a React context: the banner is the only subscriber, and a
// context would have to wrap the tree above the router just to carry a boolean.
const openListeners = new Set();

// Everything PostHog leaves behind, across both stores. `__ph_opt_in_out_*` has
// TWO leading underscores so it does not match the `ph_` mask, and `dmn_chk_*`
// is PostHog's cross-subdomain probe — miss either and a revoke looks done while
// a stale key still steers the next init.
const POSTHOG_KEY = /^(ph_|__ph_opt_in_out_|dmn_chk_)/;

// The production split, shared with main.jsx (the canon inspector is off here for
// the same reason). One list — the two copies that used to sit side by side drift
// the day a domain is added.
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
  return record;
}

/**
 * Show the panel again — what "Cookie settings" does. Deliberately changes
 * NOTHING on its own: opening your settings must not cost you the choice you
 * already made. The answer is only rewritten when a button in the panel is
 * pressed.
 */
export function openConsentBanner() {
  openListeners.forEach((listener) => listener());
}

/** @param {() => void} listener @returns {() => void} unsubscribe */
export function subscribeConsentOpen(listener) {
  openListeners.add(listener);
  return () => openListeners.delete(listener);
}

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

  // Sent for a refusal too, not only for a yes. It matches the `denied` default
  // from index.html today, but leaving it out would mean withdrawing consent
  // never tells Google anything — and once TRIP-227 has tags loaded, silence is
  // the wrong signal.
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
  // Re-attach the marks this visit arrived with. They were held in memory until
  // now because writing them to the device before consent is the very thing this
  // ticket forbids, and by this point the URL that carried them is long gone.
  startAnalytics();
  if (uid) {
    posthog.identify(uid);
    // AuthContext pairs every identify() with this, but its own call already ran
    // as a no-op before consent. Without repeating it here the campaign never
    // reaches the PERSON, and person properties are what attributes the purchase
    // — that one is born on the server, where super-properties never arrive.
    syncCampaignToPerson();
  }
}

/**
 * Remove everything PostHog stored on this device. Two callers: every start
 * without a usable answer — which is what clears the keys set before this ticket
 * shipped, with no separate migration — and the banner, when someone withdraws a
 * consent that had already started PostHog.
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
 * PostHog writes its cookie on the registrable domain (`.triplanio.com`), and a
 * delete without a matching `domain` attribute silently does nothing. Preview
 * hosts (`*.vercel.app`) get no attribute at all, so try both spellings.
 * @returns {string[]} the `domain=` attribute to append, empty string included
 */
function cookieDomainAttrs() {
  const parts = window.location.hostname.split('.');
  return parts.length >= 2 ? ['', `; domain=.${parts.slice(-2).join('.')}`] : [''];
}

/**
 * Tell Google what it may use. The stub and the `denied` default live inline in
 * index.html so they run before any tag loads; this is only the update.
 * Advertising signals move with `marketing`, which today always equals
 * `analytics` — the banner asks about both in one sentence. They stay separate
 * fields because TRIP-227 splits the question, and then only this file changes.
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
