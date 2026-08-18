/**
 * Distributed-trace header parsing for edge functions (TRIP-373).
 *
 * Split out of `sentry.ts` on purpose: `sentry.ts` reads `Deno.env` and imports
 * `npm:@sentry/deno` at module load, so it cannot be imported under `deno test`
 * without `--allow-env` / `--allow-net`. This module is PURE (only the Web
 * `crypto` + `Request` globals, no env, no SDK), so `trace_test.ts` pins the
 * parser with no runtime permissions — the same discipline as `mutateResponse.ts`.
 */

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
