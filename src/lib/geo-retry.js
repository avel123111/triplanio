// Retry-delay policy for the client geocode proxy call (TRIP-59). Kept in its own
// pure module (no supabaseClient / import.meta.env) so it is unit-testable under
// `node --test`, unlike geo.js which pulls in the browser Supabase client.

// Jitter window (ms) added on top of the retry floor. Even when every client gets
// the SAME Retry-After value from the server, the random component spreads their
// retries out so they don't fire in lock-step and re-stack the peak (retry-storm).
export const LIQ_RETRY_JITTER_MS = 400;
// Floor (ms) when the server gave no Retry-After hint (e.g. a 502 upstream error).
export const LIQ_RETRY_BASE_FLOOR_MS = 350;
// Hard cap (ms) on the honored Retry-After so a pathological value can't freeze an
// interactive search box.
export const LIQ_RETRY_MAX_MS = 5000;

// Delay before the single retry. Honor the server's Retry-After as the FLOOR so we
// never retry before the rate budget has refilled — under load a premature retry
// is both wasted (it re-hits the same exhausted budget) and harmful (it adds load
// to an already-saturated endpoint, amplifying the peak). Jitter is added on top
// to desynchronize clients that received the same Retry-After.
//
// `error` is a Supabase FunctionsHttpError whose `.context` is the raw Response;
// the Retry-After header is readable cross-origin only because the edge exposes it
// via Access-Control-Expose-Headers (see supabase/functions/_shared/cors.ts).
// `rand` is injectable for deterministic tests (defaults to Math.random).
export function liqRetryDelayMs(error, rand = Math.random) {
  let floor = LIQ_RETRY_BASE_FLOOR_MS;
  const res = error?.context;
  const header = res && typeof res.headers?.get === 'function' ? res.headers.get('Retry-After') : null;
  const secs = header != null ? parseInt(header, 10) : NaN; // our edge emits seconds
  if (Number.isFinite(secs) && secs > 0) floor = Math.min(secs * 1000, LIQ_RETRY_MAX_MS);
  return floor + rand() * LIQ_RETRY_JITTER_MS;
}
