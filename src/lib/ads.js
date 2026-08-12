// Google Ads tag loader (TRIP-227) — the single door that puts the advertising
// tag on the page, the mirror of the PostHog seam in consent.js.
//
// THE INVARIANT, same shape as PostHog's: the tag is injected here and nowhere
// else, and only for someone who agreed to marketing. Everything Google can
// store stays `denied` (the Consent Mode default in index.html) until then, so
// a visitor who never answers, or answers "necessary only", loads no ad tag and
// gets no `_gcl_*` cookie.
//
// Three gates, all must hold — the same trio PostHog uses:
//   1. a marketing consent on the record (passed in by applyConsent);
//   2. a prod host, or an explicit dev opt-in — dev/preview stay silent so test
//      traffic never reaches the live Ads account;
//   3. a non-empty VITE_GADS_TAG_ID — empty means the code ships DORMANT. The
//      tag goes live only when the id is set in Vercel and the build redeploys,
//      so merging this changes nothing for anyone until that deliberate switch.
//
// No posthog import lives here on purpose: CI guard 2j keeps `posthog-js` behind
// analytics.js / consent.js, and this module has no business touching it.
import { campaignQuery } from '@/lib/campaign';

// The tag id, form `AW-XXXXXXXXX`. Public by design (it ships in the bundle like
// the Mapbox / PostHog keys). Empty → every function below is a no-op.
const TAG_ID = import.meta.env.VITE_GADS_TAG_ID;

// The prod split. Mirrors consent.js rather than importing `isProdHost` from it:
// consent.js imports THIS module, and reaching back would make the cycle. Two
// hostnames are cheaper to repeat than a circular import is to reason about.
const PROD_HOSTS = new Set(['triplanio.com', 'www.triplanio.com']);
const isProdHost = typeof window !== 'undefined' && PROD_HOSTS.has(window.location.hostname);

// dev / preview stay silent unless opted in, so clicks on a test stand never
// land in the live Ads account. The twin of VITE_POSTHOG_ENABLE_DEV.
const adsEnabledHere =
  isProdHost || ['1', 'true'].includes(import.meta.env.VITE_GADS_ENABLE_DEV);

// The address THIS document arrived on, read once at load — before any SPA
// navigation has had a chance to drop the query. This is the only place the
// click ids (`gclid`, `utm_*`) are still guaranteed to be present.
const entrySearch = typeof window === 'undefined' ? '' : window.location.search;

// Inject at most once per session. A returning visitor hits applyConsent on
// every boot; the tag only needs to load the first time.
let loaded = false;

/**
 * Put the click ids of the entry page back into the address bar.
 *
 * The Ads tag reads `gclid` from `window.location` at the moment it loads, and
 * writes it into its first-party `_gcl_*` cookie — the link between an ad click
 * and a later conversion. But the tag loads LATE (only after the consent
 * answer), by which point the SPA has usually navigated the visitor off the
 * entry url onto `/login` with a bare query. Without this, the typical path
 * "click ad → press Start → answer banner" leaves the tag on a url with no
 * `gclid`, and Google can never tie the conversion to the click. Our own
 * attribution survives regardless (the marks were captured in memory at load),
 * so this fixes the Google side only.
 *
 * `campaignQuery` is the same whitelist the outgoing-link helper uses, so a
 * share token (`?t=…`) can never ride along. Only keys the current url is
 * missing are added, and `history.state` is preserved so react-router's own
 * history bookkeeping is left intact.
 */
function restoreClickIdsToUrl() {
  const marks = new URLSearchParams(campaignQuery(entrySearch));
  if ([...marks].length === 0) return;

  const current = new URLSearchParams(window.location.search);
  let added = false;
  for (const [key, value] of marks) {
    if (!current.has(key)) { current.set(key, value); added = true; }
  }
  if (!added) return;

  const query = current.toString();
  const url = window.location.pathname + (query ? `?${query}` : '') + window.location.hash;
  // replaceState, not a router navigation: this must not re-render the app or
  // add a history entry, only make the address the tag reads carry the click id.
  window.history.replaceState(window.history.state, '', url);
}

/**
 * Load the Google Ads tag if the record allows it. Called from applyConsent,
 * once the Consent Mode `update` has already been queued, so the tag applies the
 * granted state as soon as it evaluates.
 *
 * @param {{ marketing?: boolean }} record  the visitor's consent record
 */
export function initAdsTag(record) {
  if (loaded || !TAG_ID || !adsEnabledHere) return;
  if (!record?.marketing) return;
  // The gtag() stub and the `consent default` are set up in index.html before
  // this bundle runs; reuse that global, never redefine it.
  if (typeof window.gtag !== 'function') return;

  loaded = true;
  restoreClickIdsToUrl();

  const script = document.createElement('script');
  script.async = true;
  script.src = `https://www.googletagmanager.com/gtag/js?id=${encodeURIComponent(TAG_ID)}`;
  document.head.appendChild(script);

  window.gtag('js', new Date());
  window.gtag('config', TAG_ID);
}
