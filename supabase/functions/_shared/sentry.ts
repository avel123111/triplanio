/**
 * Sentry for Supabase Edge Functions (Deno).
 *
 * Same single Sentry project as the frontend (org `triplanio`, EU region);
 * events are tagged `runtime: edge` to separate them from browser events, and
 * `environment` (production / development) comes from the per-project secret.
 *
 * IMPORTANT — request isolation: the Sentry Deno SDK does NOT isolate scope per
 * request. In a reused edge isolate the global scope (breadcrumbs / user / tags)
 * is shared across invocations, which would bleed one request's context — and
 * PII — into another request's error. Following Supabase's guide we therefore
 * disable default integrations and pass ALL per-request context directly to
 * captureException instead of ever touching the global scope.
 *
 * Config: errors only (`tracesSampleRate: 0`), `sendDefaultPii: false`. No-op
 * when SENTRY_DSN is unset, so local / unconfigured runs stay silent.
 */
import * as Sentry from 'npm:@sentry/deno@10.56.0';

const dsn = Deno.env.get('SENTRY_DSN');

if (dsn) {
  Sentry.init({
    dsn,
    environment: Deno.env.get('SENTRY_ENVIRONMENT') ?? 'production',
    defaultIntegrations: false,
    tracesSampleRate: 0,
    sendDefaultPii: false,
    beforeSend(event) {
      // Edge ingestion records the caller IP / geo even with sendDefaultPii off.
      // We don't need request-origin PII on edge errors — drop the user block.
      delete event.user;
      return event;
    },
  });
  // Static, request-independent tags only — safe to set on the global scope.
  // `runtime` is reserved by the SDK (reports the Deno version), so use `surface`.
  Sentry.setTag('surface', 'edge');
  const region = Deno.env.get('SB_REGION');
  if (region) Sentry.setTag('region', region);
}

export function sentryEnabled(): boolean {
  return Boolean(dsn);
}

/**
 * Capture an edge-function error and flush before the isolate is frozen
 * (without the flush, short-lived isolates drop the event). No-op without a DSN.
 * Never throws — monitoring must not break the handler. Context is passed
 * directly, not via the shared global scope (see isolation note above).
 */
export async function captureEdgeError(
  error: unknown,
  fn: string,
  extra?: Record<string, unknown>,
): Promise<void> {
  if (!dsn) return;
  try {
    Sentry.captureException(error, {
      tags: { fn },
      ...(extra ? { extra } : {}),
    });
    await Sentry.flush(2000);
  } catch (_e) {
    // swallow — a Sentry failure must never surface to the caller
  }
}

/**
 * Report a payment / entitlement ANOMALY as a message-level event (not a thrown
 * exception). Tagged for precise alert routing: alert rules fire on
 * `kind:payment_anomaly AND level:error` only — `warning`/`info` stay silent
 * (healthy self-heals, expected denials). Never throws; no-op without a DSN.
 *
 * Use ONLY for non-fatal money anomalies that `break` rather than retry. Genuine
 * write/RPC failures still go through captureEdgeError + throw so Stripe retries.
 */
export async function reportPaymentAnomaly(
  tag: string,
  ctx?: Record<string, unknown>,
  level: 'info' | 'warning' | 'error' = 'error',
): Promise<void> {
  if (!dsn) return;
  try {
    Sentry.captureMessage(`payment_anomaly:${tag}`, {
      level,
      tags: { fn: 'payments', kind: 'payment_anomaly', anomaly: tag },
      ...(ctx ? { extra: ctx } : {}),
    });
    await Sentry.flush(2000);
  } catch (_e) {
    // swallow — monitoring must never surface to the caller
  }
}

export { Sentry };
