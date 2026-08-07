// Viator activities data layer for the activity "fork" side-panel.
//
// Fetches live bookable tours/experiences for a city via the `viatorActivities`
// edge function (which holds the exp-api-key secret server-side). Nothing is
// persisted: the panel fetches on open and React Query caches the result.
//
// The Viator destinationId lives on the cities table (cities.viator_dest_id),
// bound to the visit by its GeoNames identity (city_visits.geonameid →
// cities.geonameid, TRIP-146 v2). It travels ON THE VISIT: getTripDetails looks the
// directory rows up by geonameid and attaches them as `v.cities` (index.ts:146-153),
// so the panel reads a field it already has instead of asking the database again.
// Late binding is unchanged — cities is a sparse affiliate directory and the lookup
// still happens per trip load, so a city added to it later is picked up with no
// backfill; `cities: null` (city not in the directory) is a legitimate value.

import { useMemo } from 'react';
import { useQuery, keepPreviousData } from '@tanstack/react-query';
import { invokeFn } from '@/lib/invokeFn';
import { mergeById } from '@/lib/forkPool';

export const VIATOR_KEY = (visit, currency, lang) => [
  'viator',
  visit?.geonameid || null,
  (visit?.start_date || '').slice(0, 10),
  (visit?.end_date || '').slice(0, 10),
  currency || '',
  lang || '',
];

// Bounded client pool (≤ POOL_PAGES × edge page size of 50 → up to 250). We fetch
// a capped pool ONCE and let the panel filter (name/desc/price/free-cancellation)
// + sort + paginate on the CLIENT — the same one-pool model Stay22HotelList uses —
// so filtering isn't limited to a single server page. Loading mirrors the hotel
// pool too: page 1 paints instantly, pages 2..POOL_PAGES load in one parallel
// background burst and merge in (dedup by product code).
const POOL_PAGES = 5;
// Hard ceiling on the pooled activities. It matches what the burst can actually
// fetch, so today it never fires; it is here so that raising POOL_PAGES (or a
// supplier returning fuller pages) cannot grow the pool — and the DOM — without a
// ceiling, the way this list had none before.
const POOL_MAX = POOL_PAGES * 50; // edge page size is 50
const POOL_STALE_MS = 5 * 60 * 1000;

// Fetch one edge page of activities. Returns { activities, meta }.
async function fetchViatorPage(base, page) {
  const { data, error } = await invokeFn('viatorActivities', { body: { ...base, page } });
  if (error) throw error;
  // 200-with-{error}: invokeFn already reported it — mark the thrown error so the
  // QueryCache.onError seam doesn't capture it a second time (new Error drops the
  // stamp invokeFn puts on real error objects).
  if (data?.error) throw Object.assign(new Error(data.error), { __seamHandled: true });
  return { activities: data?.activities || [], meta: data?.meta || {} };
}

/**
 * React Query hook for the activity fork panel. Progressive whole-city pool:
 * page 1 paints instantly; pages 2..POOL_PAGES burst-load in the background and
 * merge in. Mirrors useStay22Pool so both fork panels share one loading model.
 * @param {object} args
 * @param {object} args.visit    city-visit node (needs geonameid, start_date, end_date)
 * @param {string} args.currency trip currency (EUR/USD)
 * @param {string} args.lang     user locale (en/es/ru)
 * @param {boolean} args.enabled fetch only while the panel is open
 * @returns {{ data:{activities,meta}, isLoading, isFetching, isError, refetch }}
 */
export function useViatorActivities({ visit, currency, lang, enabled = true }) {
  const canFetch = !!enabled && !!visit?.geonameid;
  const poolKey = VIATOR_KEY(visit, currency, lang);
  const base = {
    destinationId: undefined, // resolved lazily inside the query
    startDate: (visit?.start_date || '').slice(0, 10) || undefined,
    endDate: (visit?.end_date || '').slice(0, 10) || undefined,
    currency,
    lang,
  };

  // Page 1 — the fast first paint. keepPreviousData holds the prior city's pool
  // visible while a new city loads.
  const page1 = useQuery({
    queryKey: [...poolKey, 'p1'],
    enabled: canFetch,
    placeholderData: keepPreviousData,
    staleTime: POOL_STALE_MS,
    queryFn: async () => {
      const destinationId = visit?.cities?.viator_dest_id || null;
      // City not on Viator yet (no viator_dest_id) → empty, no upstream call.
      if (!destinationId) return { activities: [], meta: { total: 0, hasMore: false, destinationId: null } };
      const res = await fetchViatorPage({ ...base, destinationId }, 1);
      return { ...res, meta: { ...res.meta, destinationId } };
    },
  });

  const destinationId = page1.data?.meta?.destinationId || null;
  const hasMore = !page1.isPlaceholderData && !!page1.data?.meta?.hasMore && !!destinationId;

  // Tail — pages 2..POOL_PAGES in one parallel burst.
  const tail = useQuery({
    queryKey: [...poolKey, 'tail'],
    enabled: canFetch && hasMore,
    staleTime: POOL_STALE_MS,
    queryFn: async () => {
      const reqs = [];
      for (let p = 2; p <= POOL_PAGES; p++) reqs.push(fetchViatorPage({ ...base, destinationId }, p));
      return Promise.all(reqs); // [{activities,meta}, …]
    },
  });

  const placeholder = page1.isPlaceholderData;
  const data = useMemo(() => {
    const pages = [page1.data?.activities];
    if (!placeholder && Array.isArray(tail.data)) pages.push(...tail.data.map((r) => r?.activities));
    // No `truncated` in meta: unlike the hotel count row there is no "N+" label to
    // render it, and a field nobody reads is not a safeguard.
    const { items: activities } = mergeById(pages, { getKey: (a) => a.code, cap: POOL_MAX });
    return { activities, meta: { total: page1.data?.meta?.total ?? null, pooled: activities.length } };
  }, [page1.data, tail.data, placeholder]);

  return {
    data,
    isLoading: page1.isLoading,
    isFetching: page1.isFetching || tail.isFetching,
    isError: page1.isError, // tail failures degrade to page-1-only, never blank the panel
    refetch: () => { page1.refetch(); if (hasMore) tail.refetch(); },
  };
}
