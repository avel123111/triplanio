/**
 * Shared HTTP contract for edge functions (TRIP-169).
 *
 * Two small pieces of the "input boundary" that the frontend already expects:
 *
 *   1. `readJson(req)` — parse the request body as a JSON object, turning a
 *      broken/empty/non-object body into a clean 400 (via `HttpError`) instead
 *      of an unhandled throw that the generic handler catch surfaces as 500.
 *
 *   2. `jsonError(...)` / `HttpError` — one canonical error shape `{ error, code }`
 *      (the exact shape `src/lib/edgeError.js#parseEdgeError` reads: `error` =
 *      user-facing text, `code` = optional machine branch). A handler can `throw
 *      new HttpError(status, message, code)` anywhere and let its top-level catch
 *      render it with `jsonError`.
 *
 *   3. `withHandler(fnName, handler)` — the one edge seam (TRIP-219): cors +
 *      OPTIONS + a top-level try/catch that reports every ERROR outcome (4xx/5xx)
 *      to Sentry (see below). Replaces the hand-written cors/OPTIONS/try/catch that
 *      each function used to repeat, so Sentry coverage is uniform by construction.
 *
 * Tiny by design (Deno cold-start). The only shared deps are the sibling cors +
 * sentry seams — still "seam, not framework".
 */
import { corsFor } from './cors.ts';
import { captureEdgeError } from './sentry.ts';

export type ErrorBody = { error: string; code?: string };

/** An error carrying the HTTP status + optional machine code to return to the client. */
export class HttpError extends Error {
  readonly status: number;
  readonly code?: string;
  constructor(status: number, message: string, code?: string) {
    super(message);
    this.name = 'HttpError';
    this.status = status;
    this.code = code;
  }
}

/** Canonical error response: `{ error, code? }` with the given status + CORS headers. */
export function jsonError(
  status: number,
  message: string,
  code: string | undefined,
  headers: HeadersInit,
): Response {
  const body: ErrorBody = code ? { error: message, code } : { error: message };
  return Response.json(body, { status, headers });
}

/**
 * Parse the request body as a JSON object. Throws `HttpError(400, …)` on a
 * malformed/empty body or a non-object top-level value (array / string / number),
 * so a bad body becomes a 400 with `code: 'INVALID_BODY'` — never a 500.
 */
export async function readJson(req: Request): Promise<Record<string, unknown>> {
  let raw: unknown;
  try {
    raw = await req.json();
  } catch {
    throw new HttpError(400, 'Request body must be valid JSON', 'INVALID_BODY');
  }
  if (raw === null || typeof raw !== 'object' || Array.isArray(raw)) {
    throw new HttpError(400, 'Request body must be a JSON object', 'INVALID_BODY');
  }
  return raw as Record<string, unknown>;
}

/**
 * Fire a Sentry report in the BACKGROUND so monitoring never adds latency to the
 * response. `captureEdgeError` does `await flush(2000)`; awaiting that on every
 * 4xx (e.g. each 401/validation reject) would slow hot paths. Supabase edge
 * exposes `EdgeRuntime.waitUntil` to finish background work after the response is
 * sent — use it when present, else fall back to fire-and-forget (local dev, where
 * Sentry is a no-op without a DSN anyway).
 */
const _edge = (globalThis as { EdgeRuntime?: { waitUntil(p: Promise<unknown>): void } }).EdgeRuntime;
function reportInBackground(p: Promise<unknown>): void {
  if (_edge?.waitUntil) _edge.waitUntil(p);
  else void p;
}

/**
 * A handler that `return`ed >= 400 carries its reason in the `{ error, code }`
 * body, not in a thrown Error — so the synthetic `"<fn> responded <status>"`
 * event would otherwise say WHAT (the status) but not WHY. Read the body off a
 * CLONE (the original stream must stay intact for the real response) and fold
 * `error`/`code` into the Sentry `extra`, best-effort: a non-JSON / unreadable
 * body just yields the bare status. Runs in the background, so this adds no
 * latency to the response the user already received.
 */
async function reportResponseError(fnName: string, res: Response): Promise<void> {
  const extra: Record<string, unknown> = { status: res.status };
  try {
    const body = await res.clone().json();
    if (body && typeof body === 'object') {
      if (body.error != null) extra.error = String(body.error).slice(0, 500);
      if (body.code != null) extra.code = body.code;
    }
  } catch { /* non-JSON body — status alone is what we have */ }
  return captureEdgeError(new Error(`${fnName} responded ${res.status}`), fnName, extra);
}

/**
 * The single edge seam: `Deno.serve(withHandler('fnName', async (req, cors) => …))`.
 *
 * Handles cors + OPTIONS, and reports every ERROR outcome (4xx/5xx) to Sentry,
 * however it arose (TRIP-219 — Pavel: send any unexpected behaviour, incl. 4xx/400):
 *   - an unexpected throw            → 500 `INTERNAL`, reported;
 *   - a thrown `HttpError`           → its 4xx rendered via `jsonError`, reported;
 *   - a handler `return`ing >= 400   → reported by status (covers explicit
 *                                       `return jsonError(4xx, …)` early-returns).
 * 3xx redirects are deliberate successes, not errors, so they are NOT reported.
 * The `{ error, code }` body shape is preserved byte-for-byte, so the frontend
 * `parseEdgeError` contract is unchanged. Reporting is backgrounded (no latency).
 *
 * Excluded by design (own contracts / already self-capture): stripe-webhook,
 * telegramWebhook, render-share-card, rate-limited signupPrecheck/requestPasswordReset.
 * Those stay hand-written and carry a `// sentry: manual` marker for the CI guard.
 */
export function withHandler(
  fnName: string,
  handler: (req: Request, corsHeaders: HeadersInit) => Promise<Response>,
): (req: Request) => Promise<Response> {
  return async (req: Request): Promise<Response> => {
    const corsHeaders = corsFor(req);
    if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });
    try {
      const res = await handler(req, corsHeaders);
      // Report every >=400 outcome — UNLESS the handler already captured this
      // response itself with richer context and opted out via `x-sentry-skip: 1`
      // (e.g. geoLocationiq's 429/502, which carry distinct grouping + upstream
      // status). Without the opt-out those would be reported twice.
      if (res.status >= 400 && res.headers.get('x-sentry-skip') !== '1') {
        reportInBackground(reportResponseError(fnName, res));
      }
      return res;
    } catch (e) {
      if (e instanceof HttpError) {
        reportInBackground(captureEdgeError(e, fnName, { status: e.status, code: e.code }));
        return jsonError(e.status, e.message, e.code, corsHeaders);
      }
      // Also log to the Supabase function logs — a second channel that survives
      // when Sentry is unset (local dev) or misconfigured. Only the unexpected
      // 5xx path is logged; expected 4xx control flow would just be noise.
      console.error(`${fnName} unhandled:`, e);
      reportInBackground(captureEdgeError(e, fnName));
      return jsonError(500, (e as Error).message, 'INTERNAL', corsHeaders);
    }
  };
}
