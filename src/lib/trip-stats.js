// Trip-level summary stats for the Overview screen.
//
// Pure, side-effect-free derivations from the trip's cityVisits + transfers.
// Used by the Overview stat row (TripStatRow). City counting reuses the same
// identity rule as the rest of the app via uniqueCityCount so the "cities"
// number never drifts between the timeline header and the overview.
import { uniqueCityCount } from '@/lib/trip-cities';

/** Unique countries across the trip's city visits (by ISO country_code). */
export function uniqueCountryCount(visits = []) {
  if (!Array.isArray(visits)) return 0;
  const codes = new Set();
  for (const v of visits) {
    const cc = (v?.country_code || '').trim().toLowerCase();
    if (cc) codes.add(cc);
  }
  return codes.size;
}

/** Whole nights between the trip start and end dates (>= 0). */
function nightsBetween(startISO, endISO) {
  if (!startISO || !endISO) return 0;
  const s = new Date(startISO).getTime();
  const e = new Date(endISO).getTime();
  if (Number.isNaN(s) || Number.isNaN(e)) return 0;
  return Math.max(0, Math.round((e - s) / 86_400_000));
}

/**
 * Trip date span [start, end] as ISO strings, or [null, null].
 * The authoritative range lives on the city visits (same source as the hero's
 * formatTripRange) — trip.start_date/end_date are often null — so we take the
 * min start / max end across visits and only fall back to the trip record.
 */
export function tripDateSpan(trip, visits = []) {
  let min = null;
  let max = null;
  for (const v of visits || []) {
    if (v?.start_date) {
      const s = new Date(v.start_date).getTime();
      if (!Number.isNaN(s) && (min == null || s < min)) min = s;
    }
    const endRaw = v?.end_date || v?.start_date;
    if (endRaw) {
      const e = new Date(endRaw).getTime();
      if (!Number.isNaN(e) && (max == null || e > max)) max = e;
    }
  }
  if (min != null && max != null) {
    return [new Date(min).toISOString(), new Date(max).toISOString()];
  }
  const start = trip?.start_date || trip?.details?.start_date || null;
  const end = trip?.end_date || trip?.details?.end_date || null;
  return [start, end];
}

/**
 * Trip duration as { days, nights }. Days = nights + 1 (an N-night trip spans
 * N+1 calendar days), clamped so a dateless trip reads 0/0.
 */
export function tripDuration(trip, visits = []) {
  const [start, end] = tripDateSpan(trip, visits);
  const nights = nightsBetween(start, end);
  return { days: nights > 0 ? nights + 1 : 0, nights };
}

/** Great-circle distance between two [lat, lng] points, in km (haversine). */
function haversineKm(aLat, aLng, bLat, bLng) {
  const R = 6371; // mean Earth radius, km
  const toRad = (d) => (d * Math.PI) / 180;
  const dLat = toRad(bLat - aLat);
  const dLng = toRad(bLng - aLng);
  const lat1 = toRad(aLat);
  const lat2 = toRad(bLat);
  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.min(1, Math.sqrt(h)));
}

/**
 * Approximate total route distance in km: sum of great-circle hops between
 * consecutive city visits (already in trip order). This is a straight-line
 * approximation — there is no road/flight-distance source — and is fine for the
 * at-a-glance Overview number. Returns 0 when fewer than 2 cities have coords.
 *
 * `visits` must be pre-sorted in trip order (callers pass sortVisits(visits)).
 */
export function routeDistanceKm(orderedVisits = []) {
  const pts = (orderedVisits || [])
    .filter((v) => v && v.latitude != null && v.longitude != null)
    .map((v) => [Number(v.latitude), Number(v.longitude)]);
  let km = 0;
  for (let i = 1; i < pts.length; i++) {
    km += haversineKm(pts[i - 1][0], pts[i - 1][1], pts[i][0], pts[i][1]);
  }
  return Math.round(km);
}

/**
 * One-call bundle for the Overview stat row.
 * @param visits  city visits (any order — counts are order-independent)
 * @param transfers  transfer rows
 * @param trip  trip record (for dates)
 * @param orderedVisits  visits in trip order, for the distance sum
 */
export function tripStats({ visits = [], transfers = [], trip, orderedVisits } = {}) {
  const { days, nights } = tripDuration(trip, visits);
  return {
    cities: uniqueCityCount(visits),
    countries: uniqueCountryCount(visits),
    transfers: Array.isArray(transfers) ? transfers.length : 0,
    distanceKm: routeDistanceKm(orderedVisits || visits),
    days,
    nights,
  };
}
