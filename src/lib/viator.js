// Viator activities data layer for the activity "fork" side-panel.
//
// Fetches live bookable tours/experiences for a city via the `viatorActivities`
// edge function (which holds the exp-api-key secret server-side). Nothing is
// persisted: the panel fetches on open and React Query caches the result.
//
// The Viator destinationId lives on the cities table (cities.viator_dest_id),
// resolved by the visit's GeoNames identity (city_visits.geonameid → cities.geonameid,
// TRIP-146 v2). Late-binding by value: cities is a sparse affiliate directory, so a
// city added to it later is picked up by existing visits with no backfill. Resolved
// client-side with a cheap cities lookup (RLS: cities is world-readable) and cached
// per geonameid — so getTripDetails doesn't need a join change here.

import { useQuery, keepPreviousData } from '@tanstack/react-query';
import { supabase } from '@/api/supabaseClient';

// geonameid -> viator_dest_id (or null). Resolved once per city per session.
const destCache = new Map();
async function resolveViatorDestId(visit) {
  const gid = visit?.geonameid;
  if (!gid) return null;
  if (destCache.has(gid)) return destCache.get(gid);
  const { data } = await supabase
    .from('cities')
    .select('viator_dest_id')
    .eq('geonameid', gid)
    .maybeSingle();
  const id = data?.viator_dest_id || null;
  destCache.set(gid, id);
  return id;
}

export const VIATOR_KEY = (visit, currency, lang) => [
  'viator',
  visit?.geonameid || null,
  (visit?.start_date || '').slice(0, 10),
  (visit?.end_date || '').slice(0, 10),
  currency || '',
  lang || '',
];

// Bounded client pool (≤ POOL_PAGES × edge page size). We fetch a capped pool
// ONCE and let the panel filter (name/price) + paginate on the CLIENT — the same
// one-pool model Stay22HotelList uses — so filtering isn't limited to a single
// server page. The cap keeps the upstream round-trips bounded per city.
const POOL_PAGES = 5;

/**
 * React Query hook for the activity fork panel.
 * @param {object} args
 * @param {object} args.visit    city-visit node (needs geonameid, start_date, end_date)
 * @param {string} args.currency trip currency (EUR/USD)
 * @param {string} args.lang     user locale (en/es/ru)
 * @param {boolean} args.enabled fetch only while the panel is open
 */
export function useViatorActivities({ visit, currency, lang, enabled = true }) {
  return useQuery({
    queryKey: VIATOR_KEY(visit, currency, lang),
    enabled: !!enabled && !!visit?.geonameid,
    placeholderData: keepPreviousData, // keep the previous pool visible while refetching
    staleTime: 5 * 60 * 1000,
    queryFn: async () => {
      const destinationId = await resolveViatorDestId(visit);
      // City not on Viator yet (no viator_dest_id) → empty, no upstream call.
      if (!destinationId) return { activities: [], meta: { total: 0, pooled: 0 } };
      const base = {
        destinationId,
        startDate: (visit?.start_date || '').slice(0, 10) || undefined,
        endDate: (visit?.end_date || '').slice(0, 10) || undefined,
        currency,
        lang,
      };
      const activities = [];
      let total = null;
      for (let p = 1; p <= POOL_PAGES; p++) {
        const { data, error } = await supabase.functions.invoke('viatorActivities', { body: { ...base, page: p } });
        if (error) throw error;
        if (data?.error) throw new Error(data.error);
        activities.push(...(data?.activities || []));
        if (data?.meta?.total != null) total = data.meta.total;
        if (!data?.meta?.hasMore) break;
      }
      return { activities, meta: { total, pooled: activities.length } };
    },
  });
}
