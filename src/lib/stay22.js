// Stay22 accommodations data layer for the hotel "fork" side-panel.
//
// Fetches live bookable stays for a city via the `stay22Accommodations` edge
// function (which holds the X-API-KEY secret server-side). Nothing is persisted:
// the panel fetches on open and React Query caches the result client-side.
//
// Pure mapping/param helpers live in ./stay22-normalize.js so they can be
// unit-tested without React/supabase.

import { useMemo, useState, useEffect } from 'react';
import { useQuery, keepPreviousData } from '@tanstack/react-query';
import { supabase } from '@/api/supabaseClient';
import { usePartnerLogger } from '@/lib/partnerTracking';
import {
  normalizeStay22, buildStay22Params, STAY22_POOL_KEY,
  mergePool, POOL_PAGES,
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

// Lazily resolve + persist the city's English name (city_name_en) the first time
// the hotel panel opens for a city. New cities get the column filled on demand;
// existing cities are covered by the one-off backfill script. Cached per visit id.
const enCache = new Map();
async function ensureCityNameEn(visit) {
  if (!visit) return '';
  if (visit.city_name_en) return visit.city_name_en;
  if (visit.id && enCache.has(visit.id)) return enCache.get(visit.id);
  const en = await cityNameEn(visit.city_name, visit.country_code);
  if (visit.id) enCache.set(visit.id, en);
  if (en && visit.id) {
    // Benign metadata write; RLS gates city_visits writes to trip participants.
    supabase.from('city_visits').update({ city_name_en: en }).eq('id', visit.id).then(() => {}, () => {});
  }
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
  const { data, error } = await supabase.functions.invoke('stay22Accommodations', { body });
  if (error) throw error;
  if (data?.error) throw new Error(data.error);
  return normalizeStay22(data);
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
    const { hotels, truncated } = mergePool(pages);
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
  const [page, setPage] = useState(1);
  const [applied, setApplied] = useState(null);
  const [hoveredId, setHoveredId] = useState(null);
  const [selectedId, setSelectedId] = useState(null);
  // Reset the lifted state whenever the target city changes / the panel closes.
  const visitId = visit?.id || null;
  useEffect(() => {
    setPage(1); setApplied(null); setHoveredId(null); setSelectedId(null);
  }, [visitId, enabled]);

  const query = useStay22Pool({ visit, currency, lang, filters: applied, enabled });

  const logHotelClick = usePartnerLogger(tripId);
  const openHotelLink = (id) => {
    const h = (query.data?.hotels || []).find((x) => String(x.id) === String(id));
    if (!h?.link) return;
    logHotelClick({ partner: h.supplierKey || 'stay22', type: 'hotel', link: h.link, provider: 'stay22' });
    window.open(h.link, '_blank', 'noopener,noreferrer');
  };

  const bundle = enabled ? {
    data: query.data, isLoading: query.isLoading,
    // Dim the list only on a city/filter switch (placeholder) or first load — NOT
    // while the background tail pages stream in (the pool just grows under it).
    isFetching: query.isPlaceholderData || query.isLoading,
    isError: query.isError, refetch: query.refetch,
    page, onPageChange: setPage,
    applied,
    // Filter changes reload the pool → drop any stale selection/hover + reset page.
    onApply: (snap) => { setApplied(snap); setPage(1); setSelectedId(null); setHoveredId(null); },
    onResetAll: () => { setApplied(null); setPage(1); setSelectedId(null); setHoveredId(null); },
    hoveredId, selectedId,
    onHover: setHoveredId, onSelect: setSelectedId,
  } : null;

  return { bundle, query, selectedId, hoveredId, setSelectedId, setHoveredId, openHotelLink };
}
