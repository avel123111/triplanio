// Stay22 accommodations data layer for the hotel "fork" side-panel.
//
// Fetches live bookable stays for a city via the `stay22Accommodations` edge
// function (which holds the X-API-KEY secret server-side). Nothing is persisted:
// the panel fetches on open and React Query caches the result client-side.
//
// Pure mapping/param helpers live in ./stay22-normalize.js so they can be
// unit-tested without React.

import { useMemo } from 'react';
import { useQuery, keepPreviousData } from '@tanstack/react-query';
import { invokeFn } from '@/lib/invokeFn';
import { usePartnerLogger } from '@/lib/partnerTracking';
import { useForkList } from '@/lib/useForkList';
import { mergeById } from '@/lib/forkPool';
import {
  normalizeStay22, buildStay22Params, STAY22_POOL_KEY,
  POOL_ROUNDS, POOL_MAX, GEO_MODES, applyClientFilters, BASE_HOTEL_FILTERS,
} from '@/lib/stay22-normalize';

export { normalizeStay22, buildStay22Params };

// Stay22 recommends a client cache of ~60 min; we keep prices reasonably fresh
// (5 min stale) but hold the pool in cache for the whole editor session so
// reopening the same city doesn't refire 3 requests.
const POOL_STALE_MS = 5 * 60 * 1000;
const POOL_GC_MS = 30 * 60 * 1000;
const POOL_PAGE_SIZE = 100;

// Fetch + normalize one Stay22 page. Тело запроса целиком собирает
// `buildStay22Params` — ищем ТОЛЬКО по координатам города, никакой строки адреса
// здесь больше не собирается (почему — в шапке `stay22Accommodations/index.ts`).
// Returns the normalized { hotels, meta }. Shared by every page request.
async function fetchStay22Page(visit, { currency, lang, page, pageSize, filters, geo = 'point' }) {
  const body = buildStay22Params({ visit, currency, lang, page, pageSize, filters, geo });
  if (!body) return normalizeStay22(null);
  const { data, error } = await invokeFn('stay22Accommodations', { body });
  if (error) throw error;
  // 200-with-{error}: invokeFn already reported it — mark the thrown error so the
  // QueryCache.onError seam doesn't capture it a second time (new Error drops the
  // stamp invokeFn puts on real error objects).
  if (data?.error) throw Object.assign(new Error(data.error), { __seamHandled: true });
  // Центр — координаты посещения: относительно него считается `distanceKm`, по
  // которому склеенный пул потом сортируется. Обе выдачи меряются ОДНОЙ точкой,
  // иначе «ближе» у точечной и у коробочной значило бы разное.
  return normalizeStay22(data, { lat: Number(visit?.latitude), lng: Number(visit?.longitude) });
}

/**
 * Один РАУНД пула — одна и та же страница из каждого ПЕРЕДАННОГО гео-режима,
 * параллельно.
 *
 * Точка отдаёт плотный центр (в Лос-Анджелесе ~140 штук в 6.4 км), коробка —
 * разброс по площади (~100 штук с медианой 23 км), и пересекаются они почти
 * никак: на LA из 99 коробочных все 99 были новыми. Поэтому не «шире искать», а
 * СПРОСИТЬ ПО КАЖДОМУ РЕЖИМУ и склеить — тем же `mergeById`, что уже сливает
 * страницы. Режимы приходят списком, а не парой аргументов: третий источник
 * (видимая область карты) станет ещё одной строкой в `GEO_MODES`.
 *
 * Ошибки режимов НЕ равнозначны, и глотать все нельзя — иначе упавший API
 * показал бы «в этом городе отелей нет» вместо ошибки, то есть соврал бы молча.
 * Поэтому ПЕРВЫЙ режим списка несущий: его отказ пробрасывается и панель
 * краснеет ровно как до появления коробки; остальные — расширения, их отказ
 * деградирует к выдаче несущего.
 *
 * `meta.more` — карта «режим → есть ли ещё страницы». По ней хвост спрашивает
 * ТОЛЬКО незакрытые режимы: без неё раунд 2 всегда дёргал и коробку, а она в
 * Лос-Анджелесе исчерпывается на первой же странице, то есть один запрос из
 * четырёх уходил в заведомый ноль.
 */
async function fetchStay22Round(visit, opts, modes = GEO_MODES) {
  const [lead, ...rest] = modes;
  const results = await Promise.all([
    fetchStay22Page(visit, { ...opts, geo: lead }),
    ...rest.map((geo) => fetchStay22Page(visit, { ...opts, geo }).catch(() => normalizeStay22(null))),
  ]);
  // Потолок здесь не ставим: раунд физически не больше `modes × pageSize`, а
  // единственный настоящий предел пула — `POOL_MAX` при финальной склейке.
  const { items: hotels } = mergeById(results.map((r) => r.hotels), { getKey: (h) => h.id });
  const more = Object.fromEntries(modes.map((m, i) => [m, !!results[i]?.meta?.hasMore]));
  return {
    hotels,
    // Мета — от несущего режима (там даты, валюта, число ночей) плюс карта
    // незакрытых режимов; `hasMore` остаётся производным «есть ли хоть один».
    meta: { ...results[0].meta, hasMore: Object.values(more).some(Boolean), more },
  };
}

/**
 * Whole-city pool hook for the hotel fork panel (TRIP-141).
 *
 * Loads a city's stays (POOL_ROUNDS раундов × режимы × POOL_PAGE_SIZE, финальный
 * потолок POOL_MAX) into
 * one client pool — the single source of truth for both the list (client
 * pagination) and the map (client clustering). Progressive: page 1 paints
 * instantly; раунды 2..POOL_ROUNDS load in ONE parallel background burst and are
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
    queryFn: () => fetchStay22Round(visit, { currency, lang, page: 1, pageSize: POOL_PAGE_SIZE, filters }),
  });

  // Хвост гонимся только за теми режимами, которые в раунде 1 (для ЭТОГО города)
  // сказали «есть ещё». Исчерпанный режим больше не спрашиваем — это и была
  // четверть запросов в ноль.
  const tailModes = page1.isPlaceholderData
    ? []
    : GEO_MODES.filter((m) => page1.data?.meta?.more?.[m]);

  // Хвост — раунды 2..POOL_ROUNDS одним параллельным залпом. Точное число страниц
  // заранее неизвестно (`meta.total` ненадёжен), поэтому просим все оставшиеся
  // сразу; раунд за концом выдачи вернёт [] и растворится в склейке.
  //
  // Набор режимов — ЧАСТЬ ключа: он выведен из раунда 1, и без него кэш хвоста
  // пережил бы смену набора, отдав выдачу, собранную по другим источникам.
  const tail = useQuery({
    queryKey: [...poolKey, 'tail', tailModes.join(',')],
    enabled: !!enabled && canFetch && tailModes.length > 0,
    staleTime: POOL_STALE_MS,
    gcTime: POOL_GC_MS,
    queryFn: async () => {
      const reqs = [];
      for (let p = 2; p <= POOL_ROUNDS; p++) {
        reqs.push(fetchStay22Round(visit, { currency, lang, page: p, pageSize: POOL_PAGE_SIZE, filters }, tailModes));
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
    tailLoading: tailModes.length > 0 && tail.isFetching,
    truncated: data.meta.truncated,
    refetch: () => { page1.refetch(); if (tailModes.length > 0) tail.refetch(); },
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
  //  · SERVER filters (`applied`): guests/rooms — reload the pool.
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
    // SERVER filters (guests): reload the pool → drop selection + reset page.
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
