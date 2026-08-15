// The Google Ads destination (TRIP-407 PR5/PR6) — a thin gtag adapter with the
// SAME contract as destinations/posthog.js (`boot` / `onConsent`), so consent.js
// drives both the same way.
//
// DORMANT by construction: without `VITE_GADS_TAG_ID` nothing loads and every
// `conversion()` is a no-op, so merging this ships ZERO behaviour change until the
// tag id is set in prod. Turning it on there also makes the "no third-party ad
// cookies" line in public/privacy.html untrue — a privacy/terms update is a
// separate task (flagged on the PR), not code here.
//
// URL invariant (TRIP-407): the tag is configured with `url_passthrough:true`,
// which means GTAG itself reads the ad-click ids (gclid…) off the address — we do
// NOT parse or cut the URL here. The single owner of URL trimming is the deferred
// analyticsUrl.js (TRIP-330), which will cover Google too; until then access_token
// / ?t= can ride into Google via url_passthrough, but ONLY once the tag is on. That
// is the acknowledged remainder, not a licence to grow a private `before_send` here.
//
// No `posthog-js` and no ingestion key live here, so CI guard 2j does not apply.
import { isProdHost } from '@/lib/analyticsEnv';

const TAG_ID = import.meta.env.VITE_GADS_TAG_ID;

// Conversion labels pair with the prod tag (AW-18353184123). One row per action;
// `send_to` is `${TAG_ID}/<label>`.
const CONVERSION_LABELS = {
  registration: '165uCL-X0dgcEPu6va9E',
  payment: 'If3PCLyX0dgcEPu6va9E',
};

// The tag loads at most once. Also the gate `conversion()` reads — a conversion
// before the tag exists has nowhere to go.
let loaded = false;

/** Contract parity with the PostHog adapter. Nothing to do before consent. */
export function boot() {}

/**
 * Load the Google Ads gtag tag when MARKETING consent is granted — and only in
 * production with a configured tag id. Idempotent (loads at most once).
 *
 * Consent Mode is already set by consent.js (`updateGoogleConsent`) BEFORE this,
 * on top of the `denied`-by-default stub in index.html, so the tag runs cookieless
 * until the very grant it is gated on. `url_passthrough` lets ad-click ids survive
 * that cookieless, cross-page journey. `allow_enhanced_conversions` turns on the
 * hashed-email match used by `conversion()`.
 *
 * @param {{marketing?: boolean}|null} record
 */
export function onConsent(record) {
  if (loaded || !record?.marketing || !isProdHost || !TAG_ID) return;
  loaded = true;

  const s = document.createElement('script');
  s.async = true;
  s.src = `https://www.googletagmanager.com/gtag/js?id=${TAG_ID}`;
  document.head.appendChild(s);

  // window.gtag + dataLayer already exist (index.html stub).
  window.gtag('js', new Date());
  window.gtag('config', TAG_ID, { url_passthrough: true, allow_enhanced_conversions: true });
}

/**
 * Report a Google Ads conversion (TRIP-407 PR6). No-op until the tag is loaded, so
 * it is safe to call unconditionally from the registration / payment points.
 *
 * `transaction_id` (the Stripe `session_id` for a payment) is what dedups a
 * conversion re-fired by a re-opened return URL. Enhanced conversions ride the
 * hashed email in `userData.sha256_email` — the SHA-256 hex from hashEmail.js; the
 * RAW email is never passed here (see hashEmail.js).
 *
 * @param {'registration'|'payment'} kind
 * @param {{ value?: number, currency?: string, transaction_id?: string,
 *   userData?: { sha256_email: string } }} [opts]
 */
export function conversion(kind, { value, currency, transaction_id, userData } = {}) {
  if (!loaded || !TAG_ID) return;
  const label = CONVERSION_LABELS[kind];
  if (!label) return;

  if (userData?.sha256_email) {
    window.gtag('set', 'user_data', { sha256_email_address: userData.sha256_email });
  }
  window.gtag('event', 'conversion', {
    send_to: `${TAG_ID}/${label}`,
    ...(value != null ? { value } : {}),
    ...(currency ? { currency } : {}),
    ...(transaction_id ? { transaction_id } : {}),
  });
}
