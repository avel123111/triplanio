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
 * Deliberately dependency-free and tiny (Deno cold-start): this is the reusable
 * seam, adopted opportunistically per function — not a framework.
 */

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
