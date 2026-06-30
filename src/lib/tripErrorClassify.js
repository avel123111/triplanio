// Pure trip-load error/state classification — NO network or supabase imports, so
// it's unit-testable in isolation (node --test) and reusable by any trip screen.
// The actual `getTripDetails` invocation lives in invokeTripFn.js, which imports
// and re-exports these. Why split (TRIP-56): the network call needs the supabase
// client; this classification doesn't, and keeping it pure lets us lock the
// offline/paused gate behaviour with a test that never touches the wire.

// Thrown when the session can't be recovered (refresh failed, or 401 persisted
// after the retry). Callers redirect to /login rather than show "no access".
export class TripAuthError extends Error {
  constructor() {
    super('auth');
    this.name = 'TripAuthError';
    this.tripErrorKind = 'auth';
  }
}

// Pull the HTTP status out of a supabase-js functions.invoke error. On a non-2xx
// response supabase-js rejects with a FunctionsHttpError whose `.context` is the
// raw Response, so `.context.status` is the code. Network / relay failures
// (FunctionsFetchError / FunctionsRelayError) carry no `.context.status` → null.
export function statusOf(error) {
  const s = error?.context?.status;
  return typeof s === 'number' ? s : null;
}

/**
 * Classify a trip-load error into the screen it should produce:
 *   'auth'      → session unrecoverable → redirect to /login (no error screen)
 *   'access'    → 403 / 404 → "no access" stub (TripAccessError)
 *   'temporary' → 500 / network / unknown → "temporary error, retry" stub
 */
export function tripErrorKind(error) {
  if (!error) return null;
  if (error instanceof TripAuthError || error?.tripErrorKind === 'auth') return 'auth';
  const status = statusOf(error);
  if (status === 401) return 'auth'; // refresh+retry already gave up upstream
  if (status === 403 || status === 404) return 'access';
  return 'temporary'; // 500, or no status (network/relay) → recoverable
}

/**
 * Resolve a React-Query trip-load query into the screen the gate should render.
 * Returns one of: 'loading' | 'auth' | 'temporary' | 'access' | 'ok'.
 *
 * Why this can't be `tripErrorKind(error)` alone (TRIP-56 follow-up): React
 * Query's default `networkMode:'online'` does NOT fetch while the browser is
 * offline — it PAUSES the query (`fetchStatus === 'paused'`), so it never throws
 * and `error` stays undefined. The old gate (`!isLoading && !trip → no access`)
 * then read that empty-but-not-loading state as "no access" and flashed the
 * wrong screen the instant you opened a trip offline. A paused query with no
 * data is a transient connectivity failure, not a permission loss → 'temporary'.
 *
 * Order matters:
 *  - 'auth' wins even over cached data (a dead session must redirect, not show
 *    a stale trip).
 *  - usable (possibly cached) data → 'ok': keep the trip visible even if a
 *    BACKGROUND refetch failed or is paused offline (don't blow away the cache).
 *  - 'paused' (offline, no data) → 'temporary' BEFORE the pending check, so the
 *    retry screen shows immediately instead of an endless spinner.
 *  - still pending / fetching → 'loading' (covers disabled queries too, whose
 *    status is 'pending' with an 'idle' fetchStatus — never misread as 'access').
 *  - settled with no error and no data → 'access' (the genuine empty/no-trip
 *    case; real 403/404 arrive as a thrown error and are classified above).
 *
 * @param {{ isPending: boolean, fetchStatus: string, error: unknown, hasData: boolean }} q
 */
export function tripGateKind({ isPending, fetchStatus, error, hasData }) {
  if (error && tripErrorKind(error) === 'auth') return 'auth';
  if (hasData) return 'ok';
  if (error) return tripErrorKind(error);           // 'access' | 'temporary'
  if (fetchStatus === 'paused') return 'temporary'; // offline, nothing cached
  if (fetchStatus === 'fetching' || isPending) return 'loading';
  return 'access';                                   // settled, no data, no error
}
