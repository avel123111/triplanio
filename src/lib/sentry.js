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
 *  - Errors only for now: tracing and replay are OFF to protect the shared
 *    free-plan event quota. Enable a small `tracesSampleRate` once the app is
 *    stable.
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
    tracesSampleRate: 0,
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
