// Pure load-state classification — NO network or supabase imports, so it's
// unit-testable in isolation (node --test) and reusable by any data screen.
// Generic (not trip-specific): it maps a Supabase error / React-Query state onto
// the screen that should render. The stale-token 401 is now recovered in the
// client's fetch layer (createAuthRetryFetch), so a 401 that still reaches here
// means the session is genuinely dead → redirect to /login.

// Normalize the HTTP status out of a supabase-js error, REGARDLESS of transport
// (TRIP-208). The app talks to Supabase two ways and each rejects with a
// different error shape:
//   1. functions.invoke (edge) → FunctionsHttpError whose `.context` is the raw
//      Response, so `.context.status` is the code.
//   2. PostgREST direct (.from()/.rpc()) → PostgrestError with NO `.context`; it
//      carries a `.code` (SQLSTATE / PostgREST code), not an HTTP status.
//   3. Auth/Storage errors carry a numeric `.status` directly.
// Without this, a real 403/401 from a direct REST call had no status → fell
// through to 'temporary', so the "no access" / login-redirect screens only ever
// fired for edge calls. Map the auth-relevant PostgREST codes so both transports
// classify identically. Network / relay failures carry no status → null.
export function statusOf(error) {
  if (!error) return null;
  // 1. Edge invoke (FunctionsHttpError)
  const ctx = error.context?.status;
  if (typeof ctx === 'number') return ctx;
  // 2. Auth/Storage errors expose a numeric status directly
  if (typeof error.status === 'number') return error.status;
  // 3. PostgREST / Postgres error codes → HTTP-equivalent status. This is the
  //    CLIENT mirror of the server taxonomy in _shared/classifyDbError.ts — keep
  //    the two in sync. The whole point (TRIP-208 re-analysis) is that the code
  //    space is NOT binary ("PGRST116 vs everything"): a query can fail permanently
  //    (bad input, RLS deny) or transiently (timeout, deadlock, connection), and
  //    each must reach a DIFFERENT screen. Only codes that CHANGE the screen are
  //    mapped; genuinely transient/unknown codes stay null → 'temporary' (retry).
  switch (error.code) {
    // ── permanent "not found": the row isn't there or the identifier is unusable.
    //    Retrying never helps → 404 (→ 'not_found' screen, not "temporary").
    case 'PGRST116':               // no rows for .single()/.maybeSingle()
    case '22P02':                  // invalid text representation (bad uuid/int/enum)
    case '22003':                  // numeric value out of range
    case '22007':                  // invalid datetime format
    case '22008':      return 404; // datetime field overflow
    // ── permanent "denied": a real permission failure.
    case '42501':      return 403; // insufficient_privilege (RLS deny) → forbidden
    // ── auth: the session itself is invalid.
    case 'PGRST301':               // JWT expired
    case 'PGRST302':   return 401; // anonymous/invalid JWT
    // ── everything else (57014 timeout, 40001 deadlock, 53xxx/08xxx connection,
    //    42P01/42703 our-bug, unknown) → null → 'temporary'. Transient codes are
    //    correctly retryable; our-bug codes surface as "temporary" but should be
    //    caught by Sentry, not fixed by the user.
    default:           return null;
  }
}

/**
 * Classify a load error into the screen it should produce:
 *   'auth'      → 401, session unrecoverable → redirect to /login (no error screen)
 *   'not_found' → 404 → "doesn't exist / broken link" stub (never accusatory)
 *   'access'    → 403 → "no access" stub (you're not a member)
 *   'temporary' → 500 / network / unknown → "temporary error, retry" stub
 *
 * 404 and 403 are split (TRIP-208 re-analysis): a missing trip / typo'd link is
 * NOT the same as "you're not allowed" — telling a user "no access" for a broken
 * URL is wrong. `not_found` is a dead end (no retry); `access` is a permission
 * wall; `temporary` invites a retry.
 */
export function loadErrorKind(error) {
  if (!error) return null;
  const status = statusOf(error);
  if (status === 401) return 'auth'; // fetch-layer refresh+retry already gave up
  if (status === 404) return 'not_found';
  if (status === 403) return 'access';
  return 'temporary'; // 500, or no status (network/relay) → recoverable
}

/**
 * Resolve a React-Query load into the screen the gate should render.
 * Returns one of: 'loading' | 'auth' | 'temporary' | 'not_found' | 'access' | 'ok'.
 *
 * Why this can't be `loadErrorKind(error)` alone (TRIP-56 follow-up): React
 * Query's default `networkMode:'online'` does NOT fetch while the browser is
 * offline — it PAUSES the query (`fetchStatus === 'paused'`), so it never throws
 * and `error` stays undefined. The old gate (`!isLoading && !data → no access`)
 * then read that empty-but-not-loading state as "no access" and flashed the
 * wrong screen the instant you opened a screen offline. A paused query with no
 * data is a transient connectivity failure, not a permission loss → 'temporary'.
 *
 * Order matters:
 *  - 'auth' wins even over cached data (a dead session must redirect, not show
 *    stale data).
 *  - usable (possibly cached) data → 'ok': keep it visible even if a BACKGROUND
 *    refetch failed or is paused offline (don't blow away the cache).
 *  - 'paused' (offline, no data) → 'temporary' BEFORE the pending check, so the
 *    retry screen shows immediately instead of an endless spinner.
 *  - still pending / fetching → 'loading' (covers disabled queries too, whose
 *    status is 'pending' with an 'idle' fetchStatus — never misread as 'access').
 *  - settled with no error and no data → depends on `emptyIsOk` (TRIP-220):
 *      • single-resource fetch (a trip by id) → 'access'. Under RLS a forbidden
 *        row comes back as an EMPTY success, not a 403, so "settled + empty" is
 *        the only signal that the caller isn't a member — the genuine deny case.
 *      • collection fetch (trips list, inbox) → 'ok'. An empty list is the
 *        legitimate "you have none yet" state, NOT a permission wall. Reading it
 *        as 'access' is exactly what made a zero-trip user land on the trip-level
 *        "Нет доступа к этому путешествию" screen right after login. Callers over
 *        a collection pass `emptyIsOk:true` so empty falls through to their own
 *        empty-state render. Real 403/404 still arrive as a thrown error above.
 *
 * @param {{ isPending: boolean, fetchStatus: string, error: unknown, hasData: boolean, emptyIsOk?: boolean }} q
 */
export function queryGateKind({ isPending, fetchStatus, error, hasData, emptyIsOk = false }) {
  if (error && loadErrorKind(error) === 'auth') return 'auth';
  if (hasData) return 'ok';
  if (error) return loadErrorKind(error);           // 'not_found' | 'access' | 'temporary'
  if (fetchStatus === 'paused') return 'temporary'; // offline, nothing cached
  if (fetchStatus === 'fetching' || isPending) return 'loading';
  return emptyIsOk ? 'ok' : 'access';                // settled, no data, no error
}

/**
 * SystemStub descriptor (icon/tone + i18n keys) for a load-error gate kind.
 * ONE source for the error-screen look so the ~3 full-screen gates (Statistics,
 * Inbox, Trips) don't each hand-map kind → copy. Mirrors PageNotFound's styling
 * for 'not_found'. Returns i18n KEYS (caller runs them through t()).
 *   'not_found' → search / brand  → "this doesn't exist / broken link"
 *   'access'    → lock   / warm   → "no access"
 *   'temporary' → warning/ warning→ "couldn't load, retry"
 */
export function gateStubProps(kind) {
  switch (kind) {
    case 'not_found': return { icon: 'search',  tone: 'brand',   title: 'sys.not_found_title', body: 'sys.not_found_body' };
    case 'access':    return { icon: 'lock',    tone: 'warm',    title: 'sys.no_access_title', body: 'sys.no_access_body' };
    default:          return { icon: 'warning', tone: 'warning', title: 'sys.load_error_title', body: 'sys.load_error_desc' };
  }
}
