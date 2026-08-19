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
 *
 * Distributed tracing (TRIP-373): we STITCH the edge error onto the browser trace
 * that triggered it — the error event carries the incoming request's `trace_id` as
 * its `contexts.trace`, so it lands under the same trace tree as the browser
 * transaction (fixes "two unconnected trees"). This is ERROR-linking only and
 * touches NO scope — the parsed trace rides `captureException`'s per-call context,
 * exactly like tags/extra, preserving the per-request isolation above.
 *
 * DEFERRED — full performance waterfall (browser click → edge span → DB): would
 * require turning edge tracing ON (`tracesSampleRate > 0`) and wrapping each
 * handler in a span/transaction. Both need per-request scope (`startSpan` /
 * `withIsolationScope`), which reintroduces the shared-scope leak this file is
 * built to avoid — a concurrent request in a reused isolate could inherit another's
 * span/context. Error-linking gives the "one trace tree" DoD without that risk;
 * the waterfall stays out until per-request isolation is proven safe here (rule 13,
 * security-review). This is an architectural deferral, not an omission.
 */
import * as Sentry from 'npm:@sentry/deno@10.56.0';
import { envTag } from './envTag.ts';
// The `sentry-trace` parser lives in the env/SDK-free `trace.ts` so `trace_test.ts`
// can pin it under `deno test` without --allow-env/--allow-net. Imported here for
// `captureEdgeError`'s signature AND re-exported, so this Sentry seam stays the
// single import surface for callers (`http.ts`).
import { traceContextFromRequest, type EdgeTraceContext } from './trace.ts';
export { traceContextFromRequest };
export type { EdgeTraceContext };

const dsn = Deno.env.get('SENTRY_DSN');

// Fail-loud на мисконфиг: развёрнутый проект помечает окружение секретом
// `SENTRY_ENVIRONMENT`, но если при этом `SENTRY_DSN` пуст — edge-мониторинг
// молча выключен (captureEdgeError = no-op). Делаем тихую слепоту видимой
// строкой в логе функции. Локалка (обе не заданы) — молчит.
if (!dsn && Deno.env.get('SENTRY_ENVIRONMENT')) {
  console.warn('SENTRY_DSN unset — edge monitoring OFF');
}

if (dsn) {
  Sentry.init({
    dsn,
    environment: envTag(),
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


/**
 * Capture an edge-function error and flush before the isolate is frozen
 * (without the flush, short-lived isolates drop the event). No-op without a DSN.
 * Never throws — monitoring must not break the handler. Context (tags/extra AND
 * the optional distributed-trace link) is passed directly, not via the shared
 * global scope (see isolation note above).
 */
export async function captureEdgeError(
  error: unknown,
  fn: string,
  extra?: Record<string, unknown>,
  trace?: EdgeTraceContext,
  fingerprint?: string[],
): Promise<void> {
  if (!dsn) return;
  try {
    Sentry.captureException(error, {
      tags: { fn },
      ...(extra ? { extra } : {}),
      // Stitch onto the browser trace when the caller propagated one (TRIP-373).
      ...(trace ? { contexts: { trace } } : {}),
      // Explicit grouping key (TRIP-441). Only the synthetic `<fn> responded <status>`
      // path passes one: those events all share ONE stack (they are minted at a
      // single line in reportResponseError), so default stack-grouping collapses
      // every function's returned-≥400 into one un-triageable issue. Fingerprinting
      // by fn+status splits them apart. Thrown errors carry no fingerprint and keep
      // their natural per-stack grouping.
      ...(fingerprint ? { fingerprint } : {}),
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
