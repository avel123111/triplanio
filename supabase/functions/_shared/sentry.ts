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
 * The event `contexts.trace` linking an edge error to the browser trace that
 * triggered it: `trace_id` + `parent_span_id` come from the incoming request; the
 * event gets its OWN fresh `span_id`.
 */
export type EdgeTraceContext = {
  trace_id: string;
  span_id: string;
  parent_span_id: string;
};

// `sentry-trace` header: `<32-hex trace_id>-<16-hex span_id>[-<0|1 sampled>]`.
const SENTRY_TRACE_RE = /^([0-9a-f]{32})-([0-9a-f]{16})(?:-[01])?$/i;

/** A fresh 16-hex span id for THIS event (uses the runtime crypto, no PRNG state). */
function randomSpanId(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(8));
  return Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
}

/**
 * Parse the incoming `sentry-trace` header into an event trace context (TRIP-373)
 * so an edge error is stitched under the SAME trace as the browser transaction
 * that made the call. Returns undefined when the header is absent or malformed.
 *
 * ISOLATION: the caller passes this straight to `captureEdgeError` → the per-call
 * `captureException` context, NEVER onto the global scope — so a concurrent request
 * in the same isolate can never inherit this trace.
 *
 * Only `sentry-trace` is read: `trace_id` + `parent_span_id` fully identify the
 * parent for error-linking. `baggage` carries the dynamic sampling context, which
 * only matters once the edge emits its OWN transactions (the deferred perf
 * waterfall) — it is CORS-allow-listed + proxy-forwarded so that step needs no
 * transport change, but it contributes nothing to an error event.
 */
export function traceContextFromRequest(req: Request): EdgeTraceContext | undefined {
  const header = req.headers.get('sentry-trace');
  if (!header) return undefined;
  const m = SENTRY_TRACE_RE.exec(header.trim());
  if (!m) return undefined;
  return {
    trace_id: m[1].toLowerCase(),
    parent_span_id: m[2].toLowerCase(),
    span_id: randomSpanId(),
  };
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
): Promise<void> {
  if (!dsn) return;
  try {
    Sentry.captureException(error, {
      tags: { fn },
      ...(extra ? { extra } : {}),
      // Stitch onto the browser trace when the caller propagated one (TRIP-373).
      ...(trace ? { contexts: { trace } } : {}),
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
