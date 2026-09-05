// The OpenAI Ads destination (TRIP-514) — a thin `oaiq` adapter with the SAME
// contract as destinations/ads.js (`boot` / `onConsent` / `conversion`), so
// consent.js drives it exactly like the Google one.
//
// DORMANT by construction: without `VITE_OPENAI_PIXEL_ID` nothing loads and every
// `conversion()` is a no-op, so merging this ships ZERO behaviour change until the
// pixel id is set in prod. Turning it on there also makes the "advertising
// measurement" lines in privacy.en.html cover a second partner — that copy is
// updated in the same change.
//
// Why not the raw <head> snippet OpenAI ships: the pixel must not load — and must
// send no pings — before the visitor accepts the cookie banner. So instead of an
// inline script, the SDK is injected HERE, only on a marketing grant: nothing of
// OpenAI exists in the page until the grant. OpenAI's own consent control
// (`oaiq("consent", …)`, default `true`) is used for what it is for — a withdrawal
// AFTER the SDK is present, in the same document (the pixel stores its own copy
// of the answer, so it also holds on its next load).
//
// No `posthog-js` and no ingestion key live here, so CI guard 2j does not apply
// (same as ads.js).
import { isProdHost } from '@/lib/analyticsEnv';

const PIXEL_ID = import.meta.env.VITE_OPENAI_PIXEL_ID;

// Our internal action name → the OpenAI standard event name. One row per action,
// mirroring the label map in ads.js. `payment` is intentionally absent for now:
// registration only (per TRIP-514); payment and the server-side Conversions API
// are a separate task.
const EVENT_NAMES = {
  registration: 'registration_completed',
};

// The SDK loads at most once. Also the gate `conversion()` reads — a measure call
// before the SDK exists has nowhere to go.
let loaded = false;

/** Contract parity with the other adapters. Nothing to do before consent. */
export function boot() {}

/**
 * Load the OpenAI pixel when MARKETING consent is granted — and only in production
 * with a configured pixel id. Idempotent (loads at most once); once loaded, a
 * changed answer is passed to the pixel's own consent switch.
 *
 * The bootstrap below is OpenAI's official loader: it defines the `window.oaiq`
 * command queue and injects `oaiq.min.js`. We run it on the grant instead of inline
 * in <head>, so nothing of OpenAI touches the page before consent.
 *
 * @param {{marketing?: boolean}|null} record
 */
export function onConsent(record) {
  if (!isProdHost || !PIXEL_ID) return;
  if (loaded) {
    window.oaiq('consent', record?.marketing === true);
    return;
  }
  if (!record?.marketing) return;
  loaded = true;

  if (!window.oaiq) {
    const queue = function () { queue.q.push(arguments); };
    queue.q = [];
    window.oaiq = queue;

    const script = document.createElement('script');
    script.async = true;
    script.src = 'https://bzrcdn.openai.com/sdk/oaiq.min.js';
    const first = document.getElementsByTagName('script')[0];
    first.parentNode.insertBefore(script, first);
  }

  window.oaiq('init', { pixelId: PIXEL_ID });
}

/**
 * Report an OpenAI Ads conversion (TRIP-514). No-op until the SDK is loaded, so it
 * is safe to call unconditionally from the registration point.
 *
 * The `customer_action` shape is OpenAI's standard type for lead / registration /
 * appointment events. Two optional matching keys, both mirroring the Google
 * adapter's `conversion()`:
 *
 * - `sha256_email` — enhanced matching. Handed to the pixel through a second
 *   `init` on the same pixel id, which is the SDK's own way to set `user` after
 *   the fact (measured on oaiq 0.1.41: a repeat `init` updates the user config,
 *   re-reads the click id from the address, and does not create a second pixel).
 *   The digest is the one hashEmail.js computes for Google — the RAW email never
 *   comes here. The pixel then attributes a registration to the ChatGPT account
 *   that clicked even when the click id did not survive the journey.
 * - `eventId` — the pixel's `event_id`. A stable id (the account id) is what
 *   lets the server-side Conversions API, when it ships, send the same event
 *   without OpenAI counting it twice: dedup is by this id.
 *
 * @param {'registration'} kind
 * @param {{ eventId?: string, sha256_email?: string }} [opts]
 */
export function conversion(kind, { eventId, sha256_email } = {}) {
  if (!loaded || !PIXEL_ID) return;
  const eventName = EVENT_NAMES[kind];
  if (!eventName) return;

  if (sha256_email) {
    window.oaiq('init', { pixelId: PIXEL_ID, user: { email_sha256: sha256_email } });
  }
  window.oaiq(
    'measure',
    eventName,
    { type: 'customer_action' },
    eventId ? { event_id: eventId } : undefined,
  );
}
