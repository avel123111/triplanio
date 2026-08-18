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
 *    spans for the backend calls they make. Trace headers ARE propagated to the
 *    same-origin `/api/*` edge transport (TRIP-373) — see `tracePropagationTargets`
 *    below — so an edge error is stitched under the same trace as the browser
 *    transaction that triggered it.
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

// Strip anything PII-bearing before an event leaves the browser. Used by BOTH
// `beforeSend` (error events) AND `beforeSendTransaction` (tracing events) — a
// trace/transaction envelope carries `request.url` too, and a sampled pageload on
// `/public/trip/:id?t=<share_token>` or an OAuth `?code=` callback would otherwise
// ship that credential despite the error-path scrub. (Session Replay records the
// URL in its OWN envelope, which no SDK hook intercepts — the residual there is
// limited to already-shared share tokens / short-lived expired OAuth codes.)
function scrubPii(event) {
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
}

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
    // Attach sentry-trace / baggage ONLY to the same-origin `/api/*` edge
    // transport (TRIP-432 façade → api/proxy.js → Supabase). This stitches the
    // browser trace to the edge error it triggered (TRIP-373). The pattern is
    // matched against the request URL, so a PATH regex (not a host) covers both
    // the relative `/api/getMe` and any absolute form. Deliberately narrow: it does
    // NOT match the direct supabase.co doors (Storage/Auth/realtime/gazetteer) —
    // those are cross-origin and would need the CORS allow-list to carry the
    // headers; they can be added here alongside that change when their trace is
    // wanted. `[]` (the old value) would disable propagation for EVERYTHING,
    // including same-origin.
    tracePropagationTargets: [/\/api\//],
    // Session Replay: record ONLY sessions where an error occurred (never healthy
    // traffic), so volume tracks error count, not user traffic.
    replaysOnErrorSampleRate: 1.0,
    replaysSessionSampleRate: 0,
    sendDefaultPii: false,
    ignoreErrors: IGNORE_ERRORS,
    // Vercel Live / Toolbar injects a feedback widget under /_next-live/* on dev &
    // preview deploys (never in production). Its rAF/web-vitals observers throw on
    // detached nodes — e.g. `selectNode ... has no parent` (InvalidNodeTypeError)
    // and `undefined is not iterable` — and our rAF/addEventListener wrappers report
    // them as ours. Third-party bundle, nothing to fix in our code → drop by source.
    denyUrls: [/\/_next-live\//],
    // Error events AND tracing transactions both go through the same PII scrub —
    // the URL (with any ?t= share token / ?code= OAuth) is dropped from both.
    beforeSend: scrubPii,
    beforeSendTransaction: scrubPii,
  });
}

// Re-exported so callers (e.g. AppErrorBoundary) capture via this module instead
// of importing the SDK directly.
export { Sentry };
