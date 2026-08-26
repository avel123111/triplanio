// Pure Stay22 response→view mapping + request param building.
// Kept free of React/supabase imports so it is unit-testable under `node --test`.

// Relative imports (not the `@/` alias) so `node --test` can load this file directly.
import { BASE_FORK_FILTERS, applyForkFilters, byNumberAsc, byNumberDesc, numberOrNull } from './forkFilter.js';

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
function mapResult(r, currency) {
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
  };
}

export function normalizeStay22(data) {
  const meta = data?.meta || {};
  const currency = meta.currency || null;
  return {
    hotels: Array.isArray(data?.results) ? data.results.map((r) => mapResult(r, currency)).filter((h) => h.id) : [],
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

// Build the edge-function payload from a city-visit node + trip context.
// Returns null when coordinates are missing (hook stays disabled).
export function buildStay22Params({ visit, currency, lang, page, pageSize, filters }) {
  const lat = visit?.latitude;
  const lng = visit?.longitude;
  if (lat == null || lng == null) return null;
  const checkin = dateOnly(visit?.start_date);
  const checkout = ensureNextDay(checkin, dateOnly(visit?.end_date));
  return {
    lat,
    lng,
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
// How many Stay22 pages we burst-load (pageSize=100 each) and the hard cap on the
// pooled stays. Page 1 paints instantly; pages 2..POOL_PAGES load in one parallel
// background burst and are appended. The cap covers cities with 150/250 stays;
// past it we keep the first POOL_MAX (Stay22 orders by relevance) and drop the rest.
export const POOL_PAGES = 3;
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
