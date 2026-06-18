// Viator activities data layer for the activity "fork" side-panel.
//
// Fetches live bookable tours/experiences for a city via the `viatorActivities`
// edge function (which holds the exp-api-key secret server-side). Nothing is
// persisted: the panel fetches on open and React Query caches the result.
//
// The Viator destinationId lives on the cities table (cities.viator_dest_id),
// joined to the visit via city_visits.city_id. We resolve it client-side with a
// cheap cities lookup (RLS: cities is world-readable) and cache it per city_id —
// so getTripDetails (a security-sensitive trip-read fn) doesn't need changing.

import { useQuery, keepPreviousData } from '@tanstack/react-query';
import { supabase } from '@/api/supabaseClient';

// city_id -> viator_dest_id (or null). Resolved once per city per session.
const destCache = new Map();
async function resolveViatorDestId(visit) {
  const cityId = visit?.city_id;
  if (!cityId) return null;
  if (destCache.has(cityId)) return destCache.get(cityId);
  const { data } = await supabase
    .from('cities')
    .select('viator_dest_id')
    .eq('id', cityId)
    .maybeSingle();
  const id = data?.viator_dest_id || null;
  destCache.set(cityId, id);
  return id;
}

export const VIATOR_KEY = (visit, currency, lang, page) => [
  'viator',
  visit?.city_id || null,
  (visit?.start_date || '').slice(0, 10),
  (visit?.end_date || '').slice(0, 10),
  currency || '',
  lang || '',
  page || 1,
];

/**
 * React Query hook for the activity fork panel.
 * @param {object} args
 * @param {object} args.visit    city-visit node (needs city_id, start_date, end_date)
 * @param {string} args.currency trip currency (EUR/USD)
 * @param {string} args.lang     user locale (en/es/ru)
 * @param {number} args.page     1-based page
 * @param {boolean} args.enabled fetch only while the panel is open
 */
export function useViatorActivities({ visit, currency, lang, page = 1, enabled = true }) {
  return useQuery({
    queryKey: VIATOR_KEY(visit, currency, lang, page),
    enabled: !!enabled && !!visit?.city_id,
    placeholderData: keepPreviousData, // keep the previous page visible while loading
    staleTime: 5 * 60 * 1000,
    queryFn: async () => {
      const destinationId = await resolveViatorDestId(visit);
      // City not on Viator yet (no viator_dest_id) → empty, no upstream call.
      if (!destinationId) return { activities: [], meta: { total: 0, page, hasMore: false } };
      const body = {
        destinationId,
        startDate: (visit?.start_date || '').slice(0, 10) || undefined,
        endDate: (visit?.end_date || '').slice(0, 10) || undefined,
        currency,
        lang,
        page,
      };
      const { data, error } = await supabase.functions.invoke('viatorActivities', { body });
      if (error) throw error;
      if (data?.error) throw new Error(data.error);
      return data; // { activities, meta }
    },
  });
}
