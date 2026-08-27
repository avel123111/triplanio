// Pure Stay22 response→view mapping + request param building.
// Kept free of React/supabase imports so it is unit-testable under `node --test`.

// Relative imports (not the `@/` alias) so `node --test` can load this file directly.
import { BASE_FORK_FILTERS, applyForkFilters, byNumberAsc, byNumberDesc, numberOrNull } from './forkFilter.js';
import { haversineKm } from './geoDistance.js';

// Ensure checkout is strictly after checkin; Stay22 needs a valid range to
// return prices. start/end are date-only ('YYYY-MM-DD') city-visit dates.
export function ensureNextDay(checkin, checkout) {
  if (!checkin) return checkout || '';
  if (checkout && checkout > checkin) return checkout;
  const d = new Date(checkin);
  d.setDate(d.getDate() + 1);
  return d.toISOString().slice(0, 10);
}

export function dateOnly(v) {
  if (!v) return '';
  return String(v).slice(0, 10);
}

// Extract [lng, lat] from a Stay22 result's location. The v2 payload carries
// `location.coordinates`; we accept both the GeoJSON array form ([lng, lat]) and
// an object form ({ lat/latitude, lng/lon/longitude }) so a future shape change
// doesn't silently drop every badge. Returns { lat, lng } or null when absent.
function readCoords(loc) {
  const c = loc?.coordinates ?? loc;
  if (!c) return null;
  if (Array.isArray(c)) {
    const [lng, lat] = c; // GeoJSON order is [lng, lat]
    return Number.isFinite(lat) && Number.isFinite(lng) ? { lat, lng } : null;
  }
  const lat = c.lat ?? c.latitude;
  const lng = c.lng ?? c.lon ?? c.longitude;
  return Number.isFinite(lat) && Number.isFinite(lng) ? { lat, lng } : null;
}

// Map one Stay22 result to the flat shape the card + map badge render.
// Supplier-agnostic: we don't pin a provider, so a result may carry any supplier
// (booking, expedia, vrbo, hotelscom). The v2 `suppliers` map has NO defined
// ordering or "primary" entry, so we surface the first key's logo/price/link on
// the card + badge. Determinism (cheapest / top-rated) is a separate concern.
function mapResult(r, currency, center) {
  const suppliers = r?.suppliers || {};
  const supplierKey = Object.keys(suppliers)[0] || null;
  const sup = supplierKey ? suppliers[supplierKey] : null;
  const rating = r?.rating || {};
  const priceTotal = sup?.price?.total;
  const coords = readCoords(r?.location);
  return {
    id: r?.id,
    name: r?.name || '',
    // Which network this stay is bookable through (booking/expedia/…). Used for
    // the click log's `partner` and as the supplier-logo alt text.
    supplierKey,
    // Direct allez link to the primary supplier (NOT the roam aggregator page),
    // carries aid=triplanio. Falls back to the roam url if a supplier link is absent.
    link: sup?.link || r?.url || '',
    thumbnail: r?.media?.thumbnail || '',
    supplierLogo: sup?.media?.logoSquare || '',
    address: r?.location?.address || '',
    // Coordinates for the map badge; null → the result shows in the list only.
    lat: coords?.lat ?? null,
    lng: coords?.lng ?? null,
    // rating.value is a 0–10 score; hide when there are no reviews.
    ratingValue: typeof rating.value === 'number' && rating.value > 0 && rating.count > 0 ? rating.value : null,
    ratingCount: rating.count > 0 ? rating.count : null,
    stars: rating.hotelStars || null,
    // price shown only when present (beta returns it only with valid dates).
    price: typeof priceTotal === 'number' ? priceTotal : null,
    currency,
    // Удаление от центра города. Нужно, потому что пул склеен из ДВУХ выдач с
    // разным порядком: без общей меры «recommended» стал бы порядком склейки,
    // то есть случайностью, которая выглядит как решение.
    distanceKm: distanceFrom(center, coords),
  };
}

/**
 * Удаление отеля от центра города, `null` когда посчитать нечем. Именно `null`, а
 * не `NaN`: компаратор `byNumberAsc` уводит `null` в конец списка (`?? Infinity`),
 * а `NaN` из этой проверки выскальзывает и делает сравнение бессмысленным —
 * `NaN < x` и `NaN > x` оба ложны, так что элемент «равен» всему подряд и
 * рассыпается по списку случайным образом.
 */
function distanceFrom(center, coords) {
  if (!center || !coords) return null;
  if (!Number.isFinite(center.lat) || !Number.isFinite(center.lng)) return null;
  const km = haversineKm(center.lat, center.lng, coords.lat, coords.lng);
  return Number.isFinite(km) ? km : null;
}

export function normalizeStay22(data, center = null) {
  const meta = data?.meta || {};
  const currency = meta.currency || null;
  return {
    hotels: Array.isArray(data?.results) ? data.results.map((r) => mapResult(r, currency, center)).filter((h) => h.id) : [],
    meta: {
      page: meta.page || 1,
      pageSize: meta.pageSize || 10,
      total: meta.total ?? null,
      hasMore: !!meta.hasMore,
      checkin: meta.checkin || null,
      checkout: meta.checkout || null,
      nights: meta.nights ?? null,
      currency,
    },
  };
}

// Normalize the optional filters object into SERVER edge-function fields. Only
// non-empty values are returned, so "no filters / reset" sends nothing extra and
// the edge function keeps its defaults (adults=2, children=0, no rooms). The
// `provider` platform filter was retired on the FE (Stay22 disabled it) — every
// request now goes with the default provider. Price is NOT here — it is filtered
// on the CLIENT over the pooled results (in the trip currency), so it never
// reloads the pool.
export function filterParams(filters) {
  if (!filters) return {};
  const out = {};
  if (filters.adults > 0) out.adults = filters.adults;
  if (filters.children > 0) out.children = filters.children;
  if (filters.rooms > 0) out.rooms = filters.rooms;
  return out;
}

// Every client knob of the hotel list, in ONE object — both the initial state and
// the reset target (useForkList). Hotels have no boolean flags of their own, so
// this is the plain fork base; guests are SERVER filters and live in the
// `applied` snapshot instead.
export const BASE_HOTEL_FILTERS = { ...BASE_FORK_FILTERS };

// Where each knob reads from a pooled hotel. Text spans name+address; price is the
// total-stay price in the TRIP currency (pool field `price`) — hotels without a
// price are hidden while a price bound is set. Sort: 'recommended' (pool order —
// no comparator) / 'price' ↑ / 'rating' ↓ (guest score).
export const STAY22_FILTER_SPEC = {
  text: (h) => `${h?.name || ''} ${h?.address || ''}`,
  price: (h) => numberOrNull(h?.price),
  sorts: {
    // «Рекомендованные» = БЛИЖАЙШИЕ к центру города. Раньше ключа тут не было и
    // порядок оставался тем, что прислал Stay22 — для одной выдачи это и было
    // «по удалению» (замер: 84–100% пар неубывающие). Теперь выдачи две, и
    // порядок склейки не значит ничего, поэтому мера названа явно.
    recommended: byNumberAsc((h) => h?.distanceKm),
    price: byNumberAsc((h) => h?.price),
    rating: byNumberDesc((h) => h?.ratingValue),
  },
};

// Client-side filter + sort over the pooled hotels. Runs on the whole-city pool
// that feeds BOTH the list and the map pins, so the two stay in sync. Returns a
// new array; the input order is never mutated.
export function applyClientFilters(hotels, filters) {
  return applyForkFilters(hotels, filters, STAY22_FILTER_SPEC);
}

// Сегодняшний день как 'YYYY-MM-DD' по ЛОКАЛЬНОМУ календарю гостя. Stay22 меряет
// «сегодня» своим часовым поясом, а человек — своим; взять UTC значило бы отрезать
// сегодняшнюю ночь всем, кто западнее Гринвича, за несколько часов до полуночи.
export function todayLocal(now = new Date()) {
  const pad = (n) => String(n).padStart(2, '0');
  return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
}

// ── Прямоугольник вокруг города (TRIP: покрытие больших городов) ─────────────
//
// Точечный поиск Stay22 отдаёт «~140 ближайших, но не дальше радиуса», и в
// плотном городе счётчик выбирается за считанные километры: Лос-Анджелес — 139
// отелей в 6.4 км, Рим — 119 в 0.5 км. Это несколько кварталов вместо города, и
// `radius` кляксу только СЖИМАЕТ. Прямоугольник — второй гео-режим API — даёт
// выборку, РАЗМАЗАННУЮ по площади: на LA 99 отелей с медианой 23 км от центра и
// ни одного общего с точечной выдачей. Поэтому пул собирается из ДВУХ запросов.
//
// Полусторона одна на все города НАМЕРЕННО. Население плотность не предсказывает
// (Церматт, 6.6 тыс. жителей, укладывается в 0.7 км; Хальштатт, 779 человек,
// растягивается на 9.9 км), а любое правило «для крупных городов иначе» пришлось
// бы настраивать под город — то есть это не правило. В маленьком городе коробка
// просто добавляет мало (Монтерей +17) — там больше физически ничего нет.
export const POOL_BOX_KM = 12;

// Гео-режимы пула ОДНИМ списком — он же порядок склейки. Список, а не булев
// флаг: третий источник (например, видимая область карты) добавится строкой
// сюда, а не разветвлением каждого места, где сегодня стоит `box ? … : …`.
export const GEO_MODES = ['point', 'box'];

const KM_PER_DEG_LAT = 111.32;

/**
 * Углы прямоугольника ±`km` вокруг точки. Долготный шаг растёт к полюсам
 * (`/cos(lat)`), поэтому у самых полюсов он вырождается — там коробку зажимаем в
 * полмира по долготе, чтобы не улететь в бесконечность, и в ±90 по широте.
 */
export function boxAround(lat, lng, km = POOL_BOX_KM) {
  const dLat = km / KM_PER_DEG_LAT;
  const cos = Math.cos((lat * Math.PI) / 180);
  const dLng = Math.abs(cos) < 1e-6 ? 180 : Math.min(180, km / (KM_PER_DEG_LAT * Math.abs(cos)));
  return {
    swlat: Math.max(-90, lat - dLat),
    swlng: lng - dLng,
    nelat: Math.min(90, lat + dLat),
    nelng: lng + dLng,
  };
}

// Build the edge-function payload from a city-visit node + trip context.
// Returns null when the request cannot be made at all — no coordinates, or the
// stay is entirely in the past.
//
// Даты в прошлом — не «пустая выдача», а ОШИБКА апстрима: Stay22 отвечает
// `400 VALIDATION_ERROR: checkin Must be today or in the future`, edge переводит
// любой не-2xx в 502, и панель краснеет вместо списка, попутно заводя событие в
// Sentry (`_shared/http.ts` репортит всё >= 400, кроме 401). В проде больше
// половины посещений уже в прошлом — это был самый частый способ увидеть панель
// отелей сломанной. Поэтому:
//   · поездка ЗАКОНЧИЛАСЬ → null, запрос не уходит, панель рисует то же пустое
//     состояние, что и без координат (в нём есть кнопка «искать на Booking»);
//   · поездка ИДЁТ СЕЙЧАС → checkin поднимается до сегодня: вчерашнюю ночь не
//     забронировать, а оставшиеся — можно, и это единственный осмысленный
//     диапазон для человека в середине поездки.
// `today` параметром — чтобы функция осталась чистой и проверяемой тестом.
export function buildStay22Params({ visit, currency, lang, page, pageSize, filters, geo = 'point', today = todayLocal() }) {
  const lat = visit?.latitude;
  const lng = visit?.longitude;
  if (lat == null || lng == null) return null;
  const startDate = dateOnly(visit?.start_date);
  const endDate = ensureNextDay(startDate, dateOnly(visit?.end_date));
  if (endDate && endDate <= today) return null;
  const checkin = startDate && startDate < today ? today : startDate;
  const checkout = ensureNextDay(checkin, endDate);
  // Гео уходит ОДНО: либо точка, либо коробка. Слать оба разом нельзя — тогда за
  // нас выбирал бы edge, а не мы (там коробка выигрывает), и по телу запроса
  // нельзя было бы понять, что именно спрашивали.
  return {
    ...(geo === 'box' ? boxAround(Number(lat), Number(lng)) : { lat, lng }),
    ...(checkin && { checkin }),
    ...(checkout && { checkout }),
    ...(currency && { currency }),
    ...(lang && { lang }),
    page: page && page > 0 ? page : 1,
    ...(pageSize && pageSize > 0 && { pageSize }),
    ...filterParams(filters),
  };
}

// ── v2 pool (TRIP-141): all-pages load + single client pool ──────────────────
// Сколько РАУНДОВ мы берём и жёсткий потолок пула. Раунд = ОДНА страница из
// каждого НЕИСЧЕРПАННОГО гео-режима; раунд 1 красит экран, раунды
// 2..POOL_ROUNDS догружаются одним фоновым залпом.
//
// Раундов два, а не три: с двумя источниками бюджет запросов на раунд удвоился,
// а пул всё равно упирается в POOL_MAX раньше — на Лос-Анджелесе точка даёт 234
// и коробка 171, то есть потолок в 300 выбирается уже на втором раунде, и третий
// был бы запросами в мусор.
export const POOL_ROUNDS = 2;
export const POOL_MAX = 300;

// Merging pooled pages is the SHARED fork-pool merge (mergeById in forkPool.js);
// this list binds it to the Stay22 `id` and POOL_MAX at the call site in stay22.js,
// exactly as the activity pool binds it to the Viator product code.

// Stable cache key for the whole-city pool. Page-independent (the pool spans every
// page) — only visit + dates + currency/lang + filters change it, so flipping the
// filters reloads all pages while panning/paging the result reuses the cache.
export const STAY22_POOL_KEY = (visit, currency, lang, filters) => [
  'stay22-pool',
  visit?.id || `${visit?.latitude},${visit?.longitude}`,
  dateOnly(visit?.start_date),
  dateOnly(visit?.end_date),
  currency || '',
  lang || '',
  JSON.stringify(filterParams(filters)),
];
