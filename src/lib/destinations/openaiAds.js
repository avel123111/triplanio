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
// Фаза 1 measures registration only (per TRIP-514), payment/Conversions API is a
// separate task.
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
 * appointment events. Enhanced matching (a hashed email in `init`'s `user`) and the
 * server-side Conversions API are deliberately out of scope for Фаза 1.
 *
 * @param {'registration'} kind
 */
export function conversion(kind) {
  if (!loaded || !PIXEL_ID) return;
  const eventName = EVENT_NAMES[kind];
  if (!eventName) return;

  window.oaiq('measure', eventName, { type: 'customer_action' });
}
