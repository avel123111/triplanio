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

import { useMemo } from 'react';
import { useQuery, keepPreviousData } from '@tanstack/react-query';
import { invokeFn } from '@/lib/invokeFn';

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

// Bounded client pool (≤ POOL_PAGES × edge page size of 50 → up to 250). We fetch
// a capped pool ONCE and let the panel filter (name/desc/price/free-cancellation)
// + sort + paginate on the CLIENT — the same one-pool model Stay22HotelList uses —
// so filtering isn't limited to a single server page. Loading mirrors the hotel
// pool too: page 1 paints instantly, pages 2..POOL_PAGES load in one parallel
// background burst and merge in (dedup by product code).
const POOL_PAGES = 5;
const POOL_STALE_MS = 5 * 60 * 1000;

// Fetch one edge page of activities. Returns { activities, meta }.
async function fetchViatorPage(base, page) {
  const { data, error } = await invokeFn('viatorActivities', { body: { ...base, page } });
  if (error) throw error;
  if (data?.error) throw new Error(data.error);
  return { activities: data?.activities || [], meta: data?.meta || {} };
}

// Merge already-fetched activity pages into one pool, deduped by product code
// (the first page to carry a code wins — earlier Viator pages rank higher).
// Input is an array of activity arrays; an entry may be undefined while its page
// is still loading (progressive).
function mergePool(pages) {
  const seen = new Set();
  const out = [];
  for (const page of pages || []) {
    if (!Array.isArray(page)) continue;
    for (const a of page) {
      if (!a || a.code == null) continue;
      const key = String(a.code);
      if (seen.has(key)) continue;
      seen.add(key);
      out.push(a);
    }
  }
  return out;
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
      const destinationId = await resolveViatorDestId(visit);
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
    const activities = mergePool(pages);
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
