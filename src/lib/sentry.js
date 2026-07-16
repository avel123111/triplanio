/* global __SENTRY_RELEASE__ */
/**
 * Sentry — browser error monitoring.
 *
 * One Sentry project (org `triplanio`, EU region). Environments are separated by
 * the `environment` tag (production / development), not by separate projects.
 *
 * The DSN is public by design (it only allows event submission, no read access)
 * and ships in the bundle, exactly like the Mapbox token.
 *
 * Config notes:
 *  - No DSN → the SDK is never initialised and every Sentry call is a safe no-op.
 *    This keeps local dev (and any env without the var) completely silent.
 *  - Tracing ON at 10% (TRIP-219 F5): browser page-loads / navigations with timed
 *    spans for the backend calls they make. Trace headers are NOT propagated to
 *    Supabase yet (its CORS allow-list omits sentry-trace/baggage → would fail the
 *    preflight); connecting the browser trace to the edge is a separate step.
 *  - Session Replay ON, privacy-first: only sessions WITH an error are recorded,
 *    and all text / inputs / media are masked — a replay shows structure, never
 *    real content (email / billing / trip data).
 *  - `sendDefaultPii: false` + `beforeSend` scrubbing: this app handles user
 *    emails, trip data and Stripe, so nothing PII-bearing is attached
 *    automatically and request bodies / query strings / auth headers are removed
 *    before any event leaves the browser.
 */
import * as Sentry from '@sentry/react';

const DSN = import.meta.env.VITE_SENTRY_DSN;
const ENVIRONMENT = import.meta.env.VITE_SENTRY_ENVIRONMENT || import.meta.env.MODE;
// Injected at build time from VERCEL_GIT_COMMIT_SHA (see vite.config.js `define`).
// Empty string when building outside Vercel — treated as "no release".
const RELEASE = __SENTRY_RELEASE__ || undefined;

// Pure browser noise — would only burn the shared free-plan quota without ever
// being actionable. `Failed to fetch` / `AbortError` are users navigating away
// or going offline mid-request, not bugs.
const IGNORE_ERRORS = [
  'ResizeObserver loop limit exceeded',
  'ResizeObserver loop completed with undelivered notifications.',
  'Non-Error promise rejection captured',
  'Failed to fetch',
  'NetworkError when attempting to fetch resource.',
  'Load failed',
  'AbortError',
];

export function initSentry() {
  if (!DSN) return;

  Sentry.init({
    dsn: DSN,
    environment: ENVIRONMENT,
    release: RELEASE,
    integrations: [
      Sentry.browserTracingIntegration(),
      // Privacy-first replay: mask ALL text + inputs + media so the recording
      // captures layout/interaction structure, never real content.
      Sentry.replayIntegration({ maskAllText: true, maskAllInputs: true, blockAllMedia: true }),
    ],
    // Tracing: sample 10% of transactions (browser + timed backend-call spans).
    // Not 1.0 — protect the shared free-plan quota; raise once stable.
    tracesSampleRate: 0.1,
    // Do NOT attach sentry-trace / baggage headers yet: the Supabase edge CORS
    // allow-list (_shared/cors.ts) doesn't include them, so injecting them would
    // fail the preflight and break every call. Connecting the browser trace to the
    // edge (CORS header + withHandler instrumentation) is a separate step; until
    // then browser-side spans still time each backend call.
    tracePropagationTargets: [],
    // Session Replay: record ONLY sessions where an error occurred (never healthy
    // traffic), so volume tracks error count, not user traffic.
    replaysOnErrorSampleRate: 1.0,
    replaysSessionSampleRate: 0,
    sendDefaultPii: false,
    ignoreErrors: IGNORE_ERRORS,
    beforeSend(event) {
      // Strip anything that could carry PII before the event is sent.
      if (event.request) {
        delete event.request.cookies;
        delete event.request.data;
        if (event.request.headers) {
          delete event.request.headers.Authorization;
          delete event.request.headers.authorization;
          delete event.request.headers.Cookie;
        }
        // Query strings can carry tokens / emails — keep the path, drop the rest.
        if (event.request.url) {
          event.request.url = event.request.url.split('?')[0];
        }
      }
      // Keep only a stable user id for grouping; never email / username / ip.
      if (event.user) {
        event.user = event.user.id ? { id: event.user.id } : undefined;
      }
      return event;
    },
  });
}

// Re-exported so callers (e.g. AppErrorBoundary) capture via this module instead
// of importing the SDK directly.
export { Sentry };
