// @ts-check
// Subscription / plan helpers (frontend UI gating).
// The backend (getUserPlan / checkSubscriptionStatus edge functions) remains the
// source of truth for enforcement; this mirrors it for showing the right UI.

import { useQuery } from '@tanstack/react-query';

// A user is "active Pro" when their status is 'pro' and the subscription has not
// expired. Mirrors the server (getUserPlan): a 'pro' row with NO end date is
// treated as NOT active (free), to avoid client/server drift.
export function isProActive(user) {
  if (user?.subscription_status !== 'pro') return false;
  const end = user?.subscription_end_date;
  return !!end && new Date(end) > new Date();
}

// Owner-aware trip Pro resolution, CACHED across page mounts via react-query.
// Trip-level Pro = is_pro_trip (known instantly) OR the trip OWNER has an active
// subscription (resolved server-side by checkSubscriptionStatus; a participant's
// own sub does NOT unlock someone else's trip).
//
// Single source of truth shared by TripView and the structure editor. Because the
// result is cached by trip id, crossing the edit↔trip route boundary (a full page
// remount) reads the cache synchronously instead of re-fetching — so `resolved` is
// already true on the second mount and the sidebar "upgrade" card no longer flashes.
//
// Returns { isPro, resolved }. `resolved` stays false on the FIRST resolve so the
// upgrade banner isn't shown prematurely on pro trips during the async check.
export function useTripProStatus(tripId, isProTrip = false) {
  const q = useQuery({
    queryKey: ['trip-owner-pro', tripId],
    queryFn: async () => {
      // Lazy import keeps this module free of the '@/'-aliased invokeFn (and its
      // transitive '@/api/supabaseClient') at load time, so the pure isProActive
      // predicate stays importable under `node --test` (the drift-guard test).
      // Behaviour is unchanged — the client is a singleton resolved on first use.
      const { invokeFn } = await import('@/lib/invokeFn');
      const res = await invokeFn('checkSubscriptionStatus', { body: { tripId } });
      return !!res.data?.isPro;
    },
    enabled: !!tripId,
    staleTime: 5 * 60 * 1000,
    gcTime: 30 * 60 * 1000,
    // A transient failure of checkSubscriptionStatus (cold start / network blip)
    // must NOT drop a paying user to "not Pro" on the first miss. Retry a couple
    // of times (react-query applies exponential backoff) before settling to error.
    // Still fails safe: after retries exhaust, isError → resolved with Pro denied,
    // never granted.
    retry: 2,
  });
  const ownerPro = q.data === true;
  return {
    isPro: !!isProTrip || ownerPro,
    // Instant if the trip itself is Pro; otherwise once the query settles. On a
    // warm cache the query is already success on first render → no flash.
    resolved: !!isProTrip || q.isSuccess || q.isError,
  };
}
