// Stay22 accommodations data layer for the hotel "fork" side-panel.
//
// Fetches live bookable stays for a city via the `stay22Accommodations` edge
// function (which holds the X-API-KEY secret server-side). Nothing is persisted:
// the panel fetches on open and React Query caches the result client-side.
//
// Pure mapping/param helpers live in ./stay22-normalize.js so they can be
// unit-tested without React/supabase.

import { useMemo } from 'react';
import { useQuery, keepPreviousData } from '@tanstack/react-query';
import { invokeFn } from '@/lib/invokeFn';
import { usePartnerLogger } from '@/lib/partnerTracking';
import { useForkList } from '@/lib/useForkList';
import { mergeById } from '@/lib/forkPool';
import {
  normalizeStay22, buildStay22Params, STAY22_POOL_KEY,
  POOL_PAGES, POOL_MAX, applyClientFilters, BASE_HOTEL_FILTERS,
} from '@/lib/stay22-normalize';
import { cityNameEn } from '@/lib/geo';
import { countryNameEn } from '@/lib/countryNamesEn';

export { normalizeStay22, buildStay22Params };

// Stay22 recommends a client cache of ~60 min; we keep prices reasonably fresh
// (5 min stale) but hold the pool in cache for the whole editor session so
// reopening the same city doesn't refire 3 requests.
const POOL_STALE_MS = 5 * 60 * 1000;
const POOL_GC_MS = 30 * 60 * 1000;
const POOL_PAGE_SIZE = 100;

// Resolve the city's English name for the Stay22 address, preferring what the
// payload already carries: the visit's own column (written by every creation path
// — add_city / add_layover_transfer / ManualPlanner / copyTrip), then the cities
// directory row getTripDetails attaches by geonameid. Same ladder as
// activityPlatforms (buildBookingPlatforms.jsx:70). Only a row that has neither
// reaches the gazetteer. Cached per visit id for the page session — rendering
// must not write to the database, so the result is NOT persisted back.
const enCache = new Map();
async function ensureCityNameEn(visit) {
  if (!visit) return '';
  if (visit.city_name_en) return visit.city_name_en;
  if (visit.cities?.name_en) return visit.cities.name_en;
  if (visit.id && enCache.has(visit.id)) return enCache.get(visit.id);
  const en = await cityNameEn(visit.city_name, visit.country_code);
  if (visit.id) enCache.set(visit.id, en);
  return en;
}

// Fetch + normalize one Stay22 page. Resolves (and persists) the English city
// name + country so Stay22 doesn't resolve "Cairo" to Cairo, IL instead of Cairo,
// Egypt. Returns the normalized { hotels, meta }. Shared by every page request.
async function fetchStay22Page(visit, { currency, lang, page, pageSize, filters }) {
  const params = buildStay22Params({ visit, currency, lang, page, pageSize, filters });
  if (!params) return normalizeStay22(null);
  const cityEn = await ensureCityNameEn(visit);
  const cntryEn = visit?.country_code ? countryNameEn(visit.country_code) : null;
  const address = cityEn ? [cityEn, cntryEn].filter(Boolean).join(', ') : null;
  const body = address ? { ...params, address } : params;
  const { data, error } = await invokeFn('stay22Accommodations', { body });
  if (error) throw error;
  // 200-with-{error}: invokeFn already reported it — mark the thrown error so the
  // QueryCache.onError seam doesn't capture it a second time (new Error drops the
  // stamp invokeFn puts on real error objects).
  if (data?.error) throw Object.assign(new Error(data.error), { __seamHandled: true });
  // When a platform is selected, surface that supplier on the card (the v2
  // suppliers map has no primary/order, so pick the requested one).
  return normalizeStay22(data, filters?.provider || null);
}

/**
 * Whole-city pool hook for the hotel fork panel (TRIP-141).
 *
 * Loads ALL pages of a city's stays (capped at POOL_PAGES × POOL_PAGE_SIZE) into
 * one client pool — the single source of truth for both the list (client
 * pagination) and the map (client clustering). Progressive: page 1 paints
 * instantly; pages 2..POOL_PAGES load in ONE parallel background burst and are
 * merged in (dedup by id). Cached for the session, keyed by visit + filters, so
 * changing the filters reloads everything but paging/panning reuses the cache.
 *
 * @param {object}  args.visit    city-visit node (needs latitude/longitude, dates)
 * @param {string}  args.currency trip currency (EUR/USD)
 * @param {string}  args.lang     user locale (en/es/ru)
 * @param {object}  args.filters  committed guests/price filters (or null)
 * @param {boolean} args.enabled  fetch only while the panel is open
 * @returns {{ data:{hotels,meta}, isLoading, isFetching, isError, isPlaceholderData,
 *            tailLoading, truncated, refetch }}
 */
export function useStay22Pool({ visit, currency, lang, filters, enabled = true }) {
  const canFetch = !!buildStay22Params({ visit, currency, lang, page: 1, pageSize: POOL_PAGE_SIZE, filters });
  const poolKey = STAY22_POOL_KEY(visit, currency, lang, filters);

  // Page 1 — the fast first paint. keepPreviousData holds the prior city's pool
  // visible while a new city loads (consumers gate on isPlaceholderData).
  const page1 = useQuery({
    queryKey: [...poolKey, 'p1'],
    enabled: !!enabled && canFetch,
    placeholderData: keepPreviousData,
    staleTime: POOL_STALE_MS,
    gcTime: POOL_GC_MS,
    queryFn: () => fetchStay22Page(visit, { currency, lang, page: 1, pageSize: POOL_PAGE_SIZE, filters }),
  });

  // Only chase the tail once page 1 (for THIS city) reports more pages exist.
  const hasMore = !page1.isPlaceholderData && !!page1.data?.meta?.hasMore;

  // Tail — pages 2..POOL_PAGES in one parallel burst. We don't know the exact page
  // count up front (meta.total is unreliable), so we optimistically request every
  // remaining page at once; a page past the end just returns [] and merges away.
  const tail = useQuery({
    queryKey: [...poolKey, 'tail'],
    enabled: !!enabled && canFetch && hasMore,
    staleTime: POOL_STALE_MS,
    gcTime: POOL_GC_MS,
    queryFn: async () => {
      const reqs = [];
      for (let p = 2; p <= POOL_PAGES; p++) {
        reqs.push(fetchStay22Page(visit, { currency, lang, page: p, pageSize: POOL_PAGE_SIZE, filters }));
      }
      return Promise.all(reqs); // [{hotels,meta}, …]
    },
  });

  const placeholder = page1.isPlaceholderData;
  const data = useMemo(() => {
    // While page 1 shows a PREVIOUS city (placeholder), don't blend in this city's
    // tail — emit page 1's (stale) pool alone so list + map stay on one city.
    const pages = [page1.data?.hotels];
    if (!placeholder && Array.isArray(tail.data)) pages.push(...tail.data.map((r) => r?.hotels));
    const { items: hotels, truncated } = mergeById(pages, { getKey: (h) => h.id, cap: POOL_MAX });
    const meta = { ...(page1.data?.meta || {}), total: hotels.length, truncated };
    return { hotels, meta };
  }, [page1.data, tail.data, placeholder]);

  return {
    data,
    isLoading: page1.isLoading,
    isFetching: page1.isFetching || tail.isFetching,
    isError: page1.isError, // tail failures degrade to page-1-only, never blank the panel
    isPlaceholderData: placeholder,
    tailLoading: hasMore && tail.isFetching,
    truncated: data.meta.truncated,
    refetch: () => { page1.refetch(); if (hasMore) tail.refetch(); },
  };
}

// useStay22Bundle — the whole "hotel find" list state (pool query + client
// pagination + applied filters + hover/select) packaged as the `stay22` bundle
// that ForkPartnerModal / AddBookingPanel expect. Extracted from the structure
// editor so the SAME hotel-find experience works in the global add-booking drawer
// on the timeline/calendar (TRIP-195). The editor additionally derives map pins
// from the returned `query`; consumers without a map just pass `bundle` down.
export function useStay22Bundle({ visit, currency = 'EUR', lang, enabled = true, tripId }) {
  // One state contract, shared with the activity fork (TRIP-293):
  //  · CLIENT filters (`filters`): text search, price range (trip currency), sort —
  //    applied to the set that feeds BOTH the list and the map pins.
  //  · SERVER filters (`applied`): guests/rooms + platform — reload the pool.
  // Reset / page-rewind / city-change semantics live in the hook, not here.
  const {
    filters: clientFilters, applied, page, hoveredId, selectedId,
    setPage, setHoveredId, setSelectedId,
    applyFilters: applyClient, applyServer, resetAll,
  } = useForkList({ visitId: visit?.id || null, enabled, baseFilters: BASE_HOTEL_FILTERS });

  const query = useStay22Pool({ visit, currency, lang, filters: applied, enabled });

  // Filtered + sorted pool — the single source of truth for list AND map pins.
  const rawHotels = query.data?.hotels;
  const data = useMemo(() => {
    const hotels = applyClientFilters(rawHotels, clientFilters);
    return {
      hotels,
      meta: {
        ...(query.data?.meta || {}),
        total: hotels.length,
        pooled: rawHotels?.length ?? 0, // full pool size (pre client-filter) for "truncated" context
      },
    };
  }, [rawHotels, clientFilters, query.data?.meta]);

  const logHotelClick = usePartnerLogger(tripId);
  const openHotelLink = (id) => {
    const h = (rawHotels || []).find((x) => String(x.id) === String(id));
    if (!h?.link) return;
    logHotelClick({ partner: h.supplierKey || 'stay22', type: 'hotel', link: h.link, provider: 'stay22' });
    window.open(h.link, '_blank', 'noopener,noreferrer');
  };

  const bundle = enabled ? {
    data, isLoading: query.isLoading,
    // Dim the list only on a city/filter switch (placeholder) or first load — NOT
    // while the background tail pages stream in (the pool just grows under it).
    isFetching: query.isPlaceholderData || query.isLoading,
    isError: query.isError, refetch: query.refetch,
    page, onPageChange: setPage,
    // SERVER filters (guests + platform): reload the pool → drop selection + reset page.
    applied, onApply: applyServer,
    onResetAll: resetAll,
    // CLIENT filters (text / price / sort): instant over the pool.
    clientFilters,
    onSearch: (text) => applyClient({ text }),
    onApplyPrice: (min, max) => applyClient({ min, max }),
    onSort: (sortBy) => applyClient({ sortBy }),
    hoveredId, selectedId,
    onHover: setHoveredId, onSelect: setSelectedId,
  } : null;

  // `query`-shaped object for the map pins: same FILTERED hotels as the list, so
  // pins and list never diverge. Keeps placeholder/currency flags from the pool.
  const filteredQuery = { ...query, data };

  return { bundle, query: filteredQuery, selectedId, hoveredId, setSelectedId, setHoveredId, openHotelLink };
}
