/**
 * Server-side port of the app's trip stat rules (src/lib/trip-cities.js +
 * src/lib/trip-stats.js). Kept byte-for-byte in logic so the numbers on the
 * share card match what the user sees in the app: transit-only scope, dedup by
 * geonameid (name+cc fallback), haversine distance over ALL visits in order,
 * days = nights + 1.
 */

export type Visit = {
  position: number;
  city_name_en: string | null;
  name_i18n: Record<string, string> | null;
  country_code: string | null;
  latitude: number | null;
  longitude: number | null;
  kind: string | null;
  geonameid: number | string | null;
  start_date: string | null;
  end_date: string | null;
};

export type Lang = 'ru' | 'en' | 'es';

/** Localized display name of a visit: name_i18n[lang] -> en -> city_name_en. */
export function cityLabel(v: Visit, lang: Lang): string {
  const i = v.name_i18n || {};
  return i[lang] || i.en || v.city_name_en || '';
}

const isTransit = (v: Visit) => v?.kind === 'transit';

/** Canonical city identity: gn:<id> -> <name_en>|<cc> -> null. */
function cityKey(v: Visit): string | null {
  if (v.geonameid != null && v.geonameid !== '') return `gn:${v.geonameid}`;
  const name = String(v.name_i18n?.en || v.city_name_en || '').trim().toLowerCase();
  if (name) return `${name}|${(v.country_code || '').trim().toLowerCase()}`;
  return null;
}

/** Unique transit cities (first occurrence), in input order. */
export function uniqueTransitCities(visits: Visit[]): Visit[] {
  const seen = new Set<string>();
  const out: Visit[] = [];
  for (const v of visits.filter(isTransit)) {
    const key = cityKey(v);
    if (!key || seen.has(key)) continue;
    seen.add(key);
    out.push(v);
  }
  return out;
}

export function uniqueCityCount(visits: Visit[]): number {
  return uniqueTransitCities(visits).length;
}

export function uniqueCountryCount(visits: Visit[]): number {
  const codes = new Set<string>();
  for (const v of visits.filter(isTransit)) {
    const cc = (v.country_code || '').trim().toLowerCase();
    if (cc) codes.add(cc);
  }
  return codes.size;
}

function haversineKm(aLat: number, aLng: number, bLat: number, bLng: number): number {
  const R = 6371;
  const toRad = (d: number) => (d * Math.PI) / 180;
  const dLat = toRad(bLat - aLat);
  const dLng = toRad(bLng - aLng);
  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(aLat)) * Math.cos(toRad(bLat)) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.min(1, Math.sqrt(h)));
}

/** Total straight-line route distance in km over visits already in trip order. */
export function routeDistanceKm(orderedVisits: Visit[]): number {
  const pts = orderedVisits
    .filter((v) => v.latitude != null && v.longitude != null)
    .map((v) => [Number(v.latitude), Number(v.longitude)] as const);
  let km = 0;
  for (let i = 1; i < pts.length; i++) km += haversineKm(pts[i - 1][0], pts[i - 1][1], pts[i][0], pts[i][1]);
  return Math.round(km);
}

/** [minStartISO, maxEndISO] across visits, or [null, null]. */
export function dateSpan(visits: Visit[]): [string | null, string | null] {
  let min: number | null = null;
  let max: number | null = null;
  for (const v of visits) {
    if (v.start_date) {
      const s = new Date(v.start_date).getTime();
      if (!Number.isNaN(s) && (min == null || s < min)) min = s;
    }
    const endRaw = v.end_date || v.start_date;
    if (endRaw) {
      const e = new Date(endRaw).getTime();
      if (!Number.isNaN(e) && (max == null || e > max)) max = e;
    }
  }
  if (min == null || max == null) return [null, null];
  return [new Date(min).toISOString().slice(0, 10), new Date(max).toISOString().slice(0, 10)];
}

/** Whole days spanned (nights + 1), 0 when dateless. */
export function tripDays(startISO: string | null, endISO: string | null): number {
  if (!startISO || !endISO) return 0;
  const s = new Date(startISO).getTime();
  const e = new Date(endISO).getTime();
  if (Number.isNaN(s) || Number.isNaN(e)) return 0;
  const nights = Math.max(0, Math.round((e - s) / 86_400_000));
  return nights > 0 ? nights + 1 : 0;
}
