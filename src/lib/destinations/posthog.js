// The PostHog destination (TRIP-407 PR3, variant B) — the ONE place the client is
// created, configured, and turned from a memory-only recorder into a persisting
// one. CI guard 2j allows `posthog-js` and `posthog.init` HERE (and in ads.js);
// nowhere else.
//
// Variant B: PostHog boots into `persistence:'memory'` on load, for EVERYONE — so
// the first screen of a first-time visitor (`landing_viewed`, `public_trip_viewed`
// …, which fire before any button can be clicked) is captured on an anonymous,
// device-less profile. Nothing is written to the device until consent; the hit
// itself is a standard cookieless network call — the Consent-Mode shape any
// analytics-aware app sends. Consent then upgrades the SAME client to localStorage
// via `set_config` — no second init, and no replayed queue: the old `pendingEvents`
// hold (TRIP-335) is deleted by this rewrite, memory persistence makes it moot.
//
// Two flags, deliberately distinct:
//   - `phReady`   — init has run (memory OR localStorage). The gate `track()` and
//                   `identifyUser()` read. TRUE under B even while memory-only.
//   - `persisting`— this document writes PostHog keys to the DEVICE. Only true
//                   after consent flips persistence to localStorage.
// Device-level actions (the cross-tab silencer, the banner's downgrade-reload)
// MUST key on `persisting`, never `phReady`: under B `phReady` is true for a
// memory-only tab that wrote nothing, and clearing/reloading it on a foreign
// refusal would be wrong.
import posthog from 'posthog-js';
import { analyticsEnabledHere, isLocalhost, isProdHost } from '@/lib/analyticsEnv';

const POSTHOG_TOKEN = import.meta.env.VITE_POSTHOG_PROJECT_TOKEN;

// The client. The live singleton in the app; swappable in tests, which cannot
// call the real `init` (it needs a DOM). Prod calls `boot()` with no argument, so
// this stays the real posthog everywhere it matters — the same singleton
// analytics.js captures through.
let ph = posthog;

let phReady = false;
let persisting = false;

/** @returns {boolean} init has run (memory OR localStorage) — the `track` gate */
export function isReady() {
  return phReady;
}

/** @returns {boolean} this document persists PostHog state to the device */
export function isPersisting() {
  return persisting;
}

// Same-origin proxy on every DEPLOYED host (prod / www / dev / preview) via the
// vercel.json `/ingest` rewrite → no CORS, no cross-host redirect. Only true local
// `vite dev` lacks the rewrite, so there we post to PostHog EU directly.
function apiHost() {
  return isLocalhost
    ? (import.meta.env.VITE_POSTHOG_HOST || 'https://eu.i.posthog.com')
    : `${window.location.origin}/ingest`;
}

/**
 * Create the client in memory-only mode. Idempotent, and a no-op where analytics
 * is disabled (dev / preview without the enable flag) or the token is absent — so
 * an absent/failed boot cannot leave `phReady` lying. Called once from main.jsx,
 * BEFORE React mounts, so every `track()` on the first screen sees a live client.
 *
 * @param {typeof posthog} [client]  test seam — prod calls `boot()` with no arg
 */
export function boot(client) {
  if (client) ph = client;
  if (phReady || !POSTHOG_TOKEN || !analyticsEnabledHere) return;
  ph.init(POSTHOG_TOKEN, {
    api_host: apiHost(),
    defaults: '2026-05-30',
    autocapture: false,
    capture_pageview: false, // our own page_view via track() replaces it (no dupe)
    capture_performance: false,
    disable_session_recording: true,
    disable_surveys: true, // опросами не пользуемся — иначе SDK тянет ~33 КБ с их CDN (TRIP-475)
    // Код — единственный замок на сбор: настройка проекта (heatmaps_opt_in)
    // не должна включать сбор мыше-движений без нашего ведома (TRIP-328).
    enable_heatmaps: false,
    person_profiles: 'identified_only',
    persistence: 'memory', // variant B: nothing on the device until consent
  });
  // `env` super-property tags every event → prod dashboards filter env=prod.
  ph.register({ env: isProdHost ? 'prod' : 'dev' });
  phReady = true;
}

/**
 * Apply a consent record to the client. Only the analytics grant matters here
 * (the Google side is consent.js). On a grant, flip the SAME client's persistence
 * to the device — no second init. Idempotent: once persisting, a repeat call does
 * nothing.
 *
 * @param {{analytics?: boolean}|null} record
 */
export function onConsent(record) {
  if (!phReady || persisting || !record?.analytics) return;
  ph.set_config({ persistence: 'localStorage+cookie' });
  persisting = true;
}

/**
 * Stop feeding the client. `init()` cannot be undone, so this drops the gate and
 * opts the client out of capturing — the withdrawal path and the cross-tab
 * refusal. No queue to forget any more.
 */
export function stopAnalytics() {
  phReady = false;
  persisting = false;
  ph.opt_out_capturing?.();
}
