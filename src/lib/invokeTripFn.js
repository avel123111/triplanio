// Trip-read invocation with one-shot 401 recovery + error classification.
//
// Why this exists (TRIP-56): every trip screen loaded `getTripDetails` and
// collapsed ANY failure into the single "no access" stub. A transient 401 (the
// access token went stale on a throttled background tab while the SESSION is
// still alive) looked like a permanent loss of rights. Here we refresh the
// session once and retry once before giving up. The error/state CLASSIFICATION
// (tripErrorKind / tripGateKind / TripAuthError) lives in the pure, supabase-free
// `tripErrorClassify` module and is re-exported here so existing imports
// (`@/lib/invokeTripFn`) keep working. Shared by TripView and TripStructureEdit
// so the two never diverge.

import { supabase } from '@/api/supabaseClient';
import { TripAuthError, statusOf, tripErrorKind, tripGateKind } from '@/lib/tripErrorClassify';

export { TripAuthError, tripErrorKind, tripGateKind };

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
