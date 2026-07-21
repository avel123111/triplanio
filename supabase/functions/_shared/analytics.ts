/**
 * Server-side PostHog capture for Supabase Edge Functions (TRIP-213 Phase 2).
 *
 * Some product events are born on the server, not in the browser — revenue
 * (Stripe webhook), the North Star "trip reached 2 participants", lifecycle
 * reminders. This is the single fire-and-forget emitter for those.
 *
 * - Uses the PUBLIC project write token (the same `phc_…` key shipped in the
 *   browser bundle — safe to use here); set `POSTHOG_PROJECT_TOKEN` as an edge
 *   secret. No-op when it is unset, so local / unconfigured runs stay silent.
 * - `env` mirrors the frontend super-property (prod|dev) and is derived from the
 *   per-project `SENTRY_ENVIRONMENT` secret — no new env var for that.
 * - `distinct_id` MUST be the user's uid, matching the browser's
 *   posthog.identify(uid), so server + client events land on the same person.
 * - Fire-and-forget: analytics must NEVER block or fail the request; every error
 *   is swallowed.
 */
const TOKEN = Deno.env.get('POSTHOG_PROJECT_TOKEN');
const HOST = Deno.env.get('POSTHOG_HOST') || 'https://eu.i.posthog.com';
const ENV = Deno.env.get('SENTRY_ENVIRONMENT') === 'development' ? 'dev' : 'prod';

/**
 * Capture a product-analytics event from an edge function.
 * @param event       snake_case event name (e.g. 'purchase_completed')
 * @param distinctId  the user's uid (PostHog person). Skipped when null.
 * @param props       event properties (no PII beyond ids)
 * @param groups      optional group analytics, e.g. { trip: tripId }
 */
export function captureServer(
  event: string,
  distinctId: string | null | undefined,
  props: Record<string, unknown> = {},
  groups?: Record<string, string>,
): void {
  if (!TOKEN || !distinctId) return;
  const body = {
    api_key: TOKEN,
    event,
    distinct_id: distinctId,
    properties: {
      ...props,
      env: ENV,
      $lib: 'edge',
      ...(groups ? { $groups: groups } : {}),
    },
    timestamp: new Date().toISOString(),
  };
  // Fire-and-forget — do not await, never throw into the caller.
  fetch(`${HOST}/capture/`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  }).catch(() => { /* analytics is best-effort */ });
}
