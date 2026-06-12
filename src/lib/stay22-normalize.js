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

// Map one Stay22 result to the flat shape the card renders. Booking is the only
// provider we request, so we read prices/links from `suppliers.booking`.
function mapResult(r, currency) {
  const booking = r?.suppliers?.booking || null;
  const rating = r?.rating || {};
  const priceTotal = booking?.price?.total;
  return {
    id: r?.id,
    name: r?.name || '',
    // Click link → roam page (per product decision), carries aid=triplanio.
    url: r?.url || booking?.link || '',
    thumbnail: r?.media?.thumbnail || '',
    bookingLogo: booking?.media?.logoSquare || '',
    address: r?.location?.address || '',
    // rating.value is a 0–10 (Booking) score; hide when there are no reviews.
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

// Build the edge-function payload from a city-visit node + trip context.
// Returns null when coordinates are missing (hook stays disabled).
export function buildStay22Params({ visit, currency, lang, page }) {
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
  };
}

export const STAY22_KEY = (visit, currency, lang, page) => [
  'stay22',
  visit?.id || `${visit?.latitude},${visit?.longitude}`,
  dateOnly(visit?.start_date),
  dateOnly(visit?.end_date),
  currency || '',
  lang || '',
  page || 1,
];
