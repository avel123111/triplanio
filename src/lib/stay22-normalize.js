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

// Normalize the optional filters object into edge-function fields. Only
// non-empty values are returned, so "no filters / reset" sends nothing extra
// and the edge function keeps its defaults (adults=2, children=0, no rooms,
// no price bounds). min/max are per-night price in USD (Stay22 semantics).
export function filterParams(filters) {
  if (!filters) return {};
  const out = {};
  if (filters.adults > 0) out.adults = filters.adults;
  if (filters.children > 0) out.children = filters.children;
  if (filters.rooms > 0) out.rooms = filters.rooms;
  if (filters.min != null && filters.min !== '') out.min = filters.min;
  if (filters.max != null && filters.max !== '') out.max = filters.max;
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

// Stable cache key — includes pageSize + filters so changing either refetches.
export const STAY22_KEY = (visit, currency, lang, page, filters, pageSize) => [
  'stay22',
  visit?.id || `${visit?.latitude},${visit?.longitude}`,
  dateOnly(visit?.start_date),
  dateOnly(visit?.end_date),
  currency || '',
  lang || '',
  page || 1,
  pageSize || 0,
  JSON.stringify(filterParams(filters)),
];
