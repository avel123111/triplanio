// Pure Stay22 response→view mapping + request param building.
// Kept free of React/supabase imports so it is unit-testable under `node --test`.

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
// Supplier-agnostic: we no longer pin provider=booking, so a result may carry any
// supplier (booking, expedia, vrbo…). The PRIMARY supplier is the first entry of
// `suppliers` — its logo/price/link drive both the card and the badge. Determinism
// (cheapest / top-rated) is a separate, later concern.
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

// Supplier platforms for the server-side `provider` filter. `key` is the Stay22
// API value; `label` is the brand shown in the panel (proper noun, not translated).
export const STAY22_PROVIDERS = [
  { key: 'booking', label: 'Booking.com' },
  { key: 'expedia', label: 'Expedia' },
  { key: 'hotels', label: 'Hotels.com' },
  { key: 'vrbo', label: 'Vrbo' },
];

// Normalize the optional filters object into SERVER edge-function fields. Only
// non-empty values are returned, so "no filters / reset" sends nothing extra and
// the edge function keeps its defaults (adults=2, children=0, no rooms, no
// provider). Price is NOT here — it is filtered on the CLIENT over the pooled
// results (in the trip currency), so it never reloads the pool.
export function filterParams(filters) {
  if (!filters) return {};
  const out = {};
  if (filters.adults > 0) out.adults = filters.adults;
  if (filters.children > 0) out.children = filters.children;
  if (filters.rooms > 0) out.rooms = filters.rooms;
  if (filters.provider) out.provider = filters.provider;
  return out;
}

// Client-side filter + sort over the pooled hotels (React-free so it unit-tests).
// Runs on the whole-city pool that feeds BOTH the list and the map pins, so the
// two stay in sync. Text spans name+address; price is the total-stay price in the
// TRIP currency (pool field `price`) — hotels without a price are hidden while a
// price bound is set. Sort: 'recommended' (pool order) / 'price' ↑ / 'rating' ↓
// (guest score). Returns a new array; the input order is never mutated.
export function applyClientFilters(hotels, { text = '', min = '', max = '', sortBy = 'recommended' } = {}) {
  const q = (text || '').trim().toLowerCase();
  const lo = min !== '' && min != null ? Number(min) : null;
  const hi = max !== '' && max != null ? Number(max) : null;
  const priceActive = lo != null || hi != null;
  let out = (hotels || []).filter((h) => {
    if (q && !`${h.name || ''} ${h.address || ''}`.toLowerCase().includes(q)) return false;
    if (priceActive) {
      if (h.price == null) return false; // no comparable price → hide while filtering by price
      if (lo != null && h.price < lo) return false;
      if (hi != null && h.price > hi) return false;
    }
    return true;
  });
  if (sortBy === 'price') out = [...out].sort((a, b) => (a.price ?? Infinity) - (b.price ?? Infinity)); // cheapest first, nulls last
  else if (sortBy === 'rating') out = [...out].sort((a, b) => (b.ratingValue ?? -1) - (a.ratingValue ?? -1)); // best guest score first, nulls last
  return out;
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

// Merge already-normalized hotel pages into one pool: dedup by id (the FIRST page
// to carry an id wins — earlier Stay22 pages rank higher, so the kept entry is the
// more relevant one) and cap at POOL_MAX. Input is an array of hotel arrays; an
// entry may be undefined while its page is still loading (progressive). Returns
// { hotels, truncated } where truncated=true means the cap dropped real stays.
export function mergePool(pages) {
  const seen = new Set();
  const hotels = [];
  let truncated = false;
  for (const page of pages || []) {
    if (!Array.isArray(page)) continue;
    for (const h of page) {
      if (!h || h.id == null) continue;
      const key = String(h.id);
      if (seen.has(key)) continue;
      seen.add(key);
      if (hotels.length >= POOL_MAX) { truncated = true; continue; }
      hotels.push(h);
    }
  }
  return { hotels, truncated };
}

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
