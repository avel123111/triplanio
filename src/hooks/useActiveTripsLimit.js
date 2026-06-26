import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/api/supabaseClient';
import { isActiveTripCapReached } from '@/lib/limits';

/**
 * Single client-side source for the free-tier "active owned trip" gate.
 *
 * Wraps the getActiveTrips edge function — which itself wraps the DB
 * active_owned_trips() helper (migration 0045) — so every screen (create dialog,
 * manual/AI planner blocker, copy action, list banner) reads the SAME number and
 * the rule can never drift between client copies.
 *
 * Rule: a free user may have at most 1 ACTIVE owned trip.
 *
 * @param {string|undefined} userId - skip the fetch until known.
 * @returns {{ activeCount: number, isPro: boolean, isBlocked: boolean, isLoading: boolean, refetch: () => void }}
 *          isBlocked = free user already at the cap. While loading, isBlocked is
 *          false so screens don't flash a blocker before the count arrives.
 */
/**
 * Single invalidation point for everything that changes a user's active-trip
 * count: create, copy, delete. Drops the free-tier gate cache
 * (['active-trips-limit'] — keyed by userId, so invalidate by prefix) plus the
 * trips list. Call this after ANY mutation that adds/removes an owned trip, so
 * the create dialog and the planner's full-screen guard can never read a stale
 * count (staleTime 30s) and disagree with the server.
 *
 * @param {import('@tanstack/react-query').QueryClient} [qc]
 */
export function invalidateActiveTripsLimit(qc) {
  qc?.invalidateQueries({ queryKey: ['active-trips-limit'] });
  qc?.invalidateQueries({ queryKey: ['trips'] });
}

export function useActiveTripsLimit(userId) {
  const q = useQuery({
    queryKey: ['active-trips-limit', userId],
    enabled: !!userId,
    staleTime: 30_000,
    queryFn: async () => {
      const { data, error } = await supabase.functions.invoke('getActiveTrips', { body: {} });
      if (error) throw error;
      return { activeCount: data?.activeCount ?? 0, isPro: !!data?.isPro };
    },
  });

  const activeCount = q.data?.activeCount ?? 0;
  const isPro = q.data?.isPro ?? false;

  return {
    activeCount,
    isPro,
    isBlocked: isActiveTripCapReached(isPro, activeCount),
    isLoading: q.isLoading,
    refetch: q.refetch,
  };
}
