// Trip-details loader (TRIP-56).
//
// The stale-token 401 recovery (refresh + retry once) now lives in the Supabase
// client's fetch layer (createAuthRetryFetch), so EVERY authorized call self-heals,
// not just this one. This is therefore a plain invoke: surface `data`, throw the
// error untouched so `loadErrorKind` / `queryGateKind` (loadStateClassify) can map
// it to the right screen. Shared by TripView and TripStructureEdit so they can't
// drift on how the trip is fetched.

import { supabase } from '@/api/supabaseClient';

export async function invokeGetTripDetails(body) {
  const { data, error } = await supabase.functions.invoke('getTripDetails', { body });
  if (error) throw error;
  return data;
}
