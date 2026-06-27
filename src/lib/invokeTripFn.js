// Trip-read invocation with one-shot 401 recovery + error classification.
//
// Why this exists (TRIP-56): every trip screen loaded `getTripDetails` and
// collapsed ANY failure into the single "no access" stub. A transient 401 (the
// access token went stale on a throttled background tab while the SESSION is
// still alive) looked like a permanent loss of rights. Here we refresh the
// session once and retry once before giving up, and we expose `tripErrorKind`
// so the UI can map the real HTTP status to the right screen instead of one
// catch-all. Shared by TripView and TripStructureEdit so the two never diverge.

import { supabase } from '@/api/supabaseClient';

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
function statusOf(error) {
  const s = error?.context?.status;
  return typeof s === 'number' ? s : null;
}

/**
 * Invoke getTripDetails with one-shot 401 recovery.
 * - success → returns `data`.
 * - 401 → refresh the session ONCE, retry the request ONCE. Still failing (or
 *   refresh failed) → throw TripAuthError. The single-shot guard is critical:
 *   without it a truly dead session loops refresh→401→refresh forever.
 * - any other error → re-thrown untouched so `tripErrorKind` can classify it.
 */
export async function invokeGetTripDetails(body) {
  const first = await supabase.functions.invoke('getTripDetails', { body });
  if (!first.error) return first.data;

  if (statusOf(first.error) === 401) {
    const { data: refreshed, error: refreshErr } = await supabase.auth.refreshSession();
    if (refreshErr || !refreshed?.session) throw new TripAuthError();

    const second = await supabase.functions.invoke('getTripDetails', { body });
    if (!second.error) return second.data;
    if (statusOf(second.error) === 401) throw new TripAuthError();
    throw second.error;
  }

  throw first.error;
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
