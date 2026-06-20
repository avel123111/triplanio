import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/api/supabaseClient';

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
    isBlocked: !isPro && activeCount >= 1,
    isLoading: q.isLoading,
    refetch: q.refetch,
  };
}
