// User-level travel statistics — aggregates across ALL the user's trips + custom
// visits, for the Trips home screen and the "My statistics" screen.
//
// Pure, side-effect-free derivations over the `points` array returned by the
// get_user_travel_stats() RPC. City/country counting REUSES the single source of
// truth (src/lib/trip-cities.js cityKey) so the numbers can never drift from the
// per-trip counts shown elsewhere. Year filtering and every aggregate happen
// here on the client — the RPC ships the compact point set once, the year switch
// never hits the network.
//
// Point shape (from RPC): { id, kind:'trip'|'custom', trip_id|null, city_name,
//   country_code, lat, lng, start_date, end_date }. RPC already restricts trip
//   points to transit cities, so every point is a real destination.
import { cityKey } from './trip-cities.js';
import { continentOf } from './continents.js';

// "Мир исследован" denominator — UN member states (decision: 195 everywhere).
export const WORLD_COUNTRIES = 195;

const ccUp = (c) => (c ? String(c).trim().toUpperCase() : '');

/** Visit year (start preferred, else end), or null. */
export function pointYear(p) {
  const d = p?.start_date || p?.end_date;
  if (!d) return null;
  const y = Number(String(d).slice(0, 4));
  return Number.isFinite(y) ? y : null;
}

/** Distinct visit years present in points, newest first. */
export function availableYears(points = []) {
  const s = new Set();
  for (const p of points) { const y = pointYear(p); if (y) s.add(y); }
  return [...s].sort((a, b) => b - a);
}

/** Filter to a single year; year === 'all' | null keeps everything. */
export function filterByYear(points = [], year) {
  if (year == null || year === 'all') return points;
  const y = Number(year);
  return points.filter((p) => pointYear(p) === y);
}

/** Map pin colour bucket: 'manual' (custom), 'future' (planned), 'trip' (past/now). */
export function pointType(p, today = new Date()) {
  if (p?.kind === 'custom') return 'manual';
  const s = p?.start_date ? new Date(p.start_date) : null;
  if (s && s.getTime() > today.getTime()) return 'future';
  return 'trip';
}

// Single source of truth for the visit-type accent (map pins/legend, list badges,
// visit panel). Binds to EXISTING design tokens — no new tokens. Previously this
// map + dominantTone() were copy-pasted in Statistics.jsx / StatsMap.jsx /
// VisitPanel.jsx; they import these now so the colour can never drift.
// trip + manual share the brand hue (manual reads "lighter" — a hollow marker /
// lower-opacity fill); future is the rose accent (--ev-activity). Priority for a
// place with mixed visit types stays trip > manual > future (TONE_RANK below).
export const TONE = { trip: 'hsl(var(--primary))', manual: 'hsl(var(--primary))', future: 'var(--ev-activity)' };
// "Most real" wins (trip > manual > future) so a city visited on a trip never
// looks merely "planned" when several visit types share a pin/place.
export const TONE_RANK = { trip: 0, manual: 1, future: 2 };

/** Dominant visit type across a group of points (lowest TONE_RANK wins). */
export function dominantTone(points = []) {
  let best = null;
  for (const p of points) {
    const tn = pointType(p);
    if (best == null || TONE_RANK[tn] < TONE_RANK[best]) best = tn;
  }
  return best || 'trip';
}

// ─── visit unit (one "посещение") ────────────────────────────────────────────
// A "посещение" of a place = one TRIP that went there (all the trip's points in a
// country/city collapse to one), or one MANUAL visit (each custom row counts on
// its own). This is the unit the country/city lists, the "favorite" records and
// the visit-panel header all count by — so a country with 9 trips reads "9", not
// the number of city-stops, and matches what VisitPanel groups in its body.
function visitUnitKey(p) {
  if (!p) return null;
  if (p.kind === 'trip' && p.trip_id) return `t:${p.trip_id}`;
  if (p.kind === 'custom') return `c:${p.id}`;
  return null;
}
/** Distinct visit units (trips + manual entries) across a set of points. */
export function countVisitUnits(points = []) {
  const s = new Set();
  for (const p of points) { const u = visitUnitKey(p); if (u) s.add(u); }
  return s.size;
}

// ─── counts (dedup identical to trip-cities.js) ──────────────────────────────
export function countCities(points = []) {
  const s = new Set();
  for (const p of points) { const k = cityKey(p); if (k) s.add(k); }
  return s.size;
}
export function countCountries(points = []) {
  const s = new Set();
  for (const p of points) { const c = ccUp(p?.country_code); if (c) s.add(c); }
  return s.size;
}
export function countContinents(points = []) {
  const s = new Set();
  for (const p of points) { const c = continentOf(p?.country_code); if (c) s.add(c); }
  return s.size;
}
/** Distinct trips represented in points (trip points only). */
export function countTrips(points = []) {
  const s = new Set();
  for (const p of points) { if (p?.kind === 'trip' && p.trip_id) s.add(p.trip_id); }
  return s.size;
}

/** { visited, total, pct } against the 195 denominator. */
export function worldExplored(points = []) {
  const visited = countCountries(points);
  return { visited, total: WORLD_COUNTRIES, pct: Math.min(100, Math.round((visited / WORLD_COUNTRIES) * 100)) };
}

// ─── lists ───────────────────────────────────────────────────────────────────
/** Countries with VISIT counts (distinct trips + manual entries), desc. [{ code, count }] */
export function countriesList(points = []) {
  const m = new Map(); // code → Set of visit-unit keys
  for (const p of points) {
    const c = ccUp(p?.country_code); if (!c) continue;
    const u = visitUnitKey(p); if (!u) continue;
    let s = m.get(c); if (!s) { s = new Set(); m.set(c, s); }
    s.add(u);
  }
  return [...m.entries()].map(([code, s]) => ({ code, count: s.size })).sort((a, b) => b.count - a.count);
}
/** Cities with VISIT counts (distinct trips + manual entries), desc. [{ key, city_name, country_code, count }] */
export function citiesList(points = []) {
  const m = new Map();
  for (const p of points) {
    const k = cityKey(p); if (!k) continue;
    const u = visitUnitKey(p); if (!u) continue;
    let e = m.get(k);
    if (!e) { e = { key: k, city_name: p.city_name, country_code: p.country_code, units: new Set() }; m.set(k, e); }
    e.units.add(u);
  }
  return [...m.values()]
    .map((e) => ({ key: e.key, city_name: e.city_name, country_code: e.country_code, count: e.units.size }))
    .sort((a, b) => b.count - a.count);
}
/** Distinct countries visited per continent. { AF: 3, EU: 7, ... } */
export function continentsBreakdown(points = []) {
  const out = {}; const seen = new Set();
  for (const p of points) {
    const cc = ccUp(p?.country_code); if (!cc) continue;
    const cont = continentOf(cc); if (!cont) continue;
    const key = `${cont}|${cc}`; if (seen.has(key)) continue;
    seen.add(key); out[cont] = (out[cont] || 0) + 1;
  }
  return out;
}

// ─── by year (trip count per year) ───────────────────────────────────────────
/** { 2024: 2, 2025: 3, ... } — distinct trips per year (trip's earliest year). */
export function tripsByYear(points = []) {
  const tripYear = new Map();
  for (const p of points) {
    if (p?.kind !== 'trip' || !p.trip_id) continue;
    const y = pointYear(p); if (!y) continue;
    const cur = tripYear.get(p.trip_id);
    if (cur == null || y < cur) tripYear.set(p.trip_id, y);
  }
  const out = {};
  for (const y of tripYear.values()) out[y] = (out[y] || 0) + 1;
  return out;
}

// ─── records ─────────────────────────────────────────────────────────────────
/** Total days spanned across trips (sum of each trip's [minStart..maxEnd]+1). */
export function daysInTrips(points = []) {
  const span = new Map();
  for (const p of points) {
    if (p?.kind !== 'trip' || !p.trip_id) continue;
    const s = p.start_date ? new Date(p.start_date).getTime() : null;
    if (s == null || Number.isNaN(s)) continue;
    const eRaw = p.end_date ? new Date(p.end_date).getTime() : s;
    const e = Number.isNaN(eRaw) ? s : eRaw;
    const cur = span.get(p.trip_id) || { min: Infinity, max: -Infinity };
    cur.min = Math.min(cur.min, s); cur.max = Math.max(cur.max, e);
    span.set(p.trip_id, cur);
  }
  let days = 0;
  for (const { min, max } of span.values()) {
    if (min === Infinity) continue;
    days += Math.round((max - min) / 86_400_000) + 1;
  }
  return days;
}
/** Most-visited city by visit units (trips + manual): { city_name, country_code, count } | null. */
export function favoriteCity(points = []) {
  const top = citiesList(points)[0];
  return top ? { city_name: top.city_name, country_code: top.country_code, count: top.count } : null;
}
/** Most-visited country: { code, count } | null. */
export function favoriteCountry(points = []) {
  const list = countriesList(points);
  return list.length ? list[0] : null;
}
/** Trip with the most unique cities: { trip_id, title, cities } | null. */
export function longestTrip(points = [], trips = {}) {
  const per = new Map();
  for (const p of points) {
    if (p?.kind !== 'trip' || !p.trip_id) continue;
    const k = cityKey(p); if (!k) continue;
    let set = per.get(p.trip_id);
    if (!set) { set = new Set(); per.set(p.trip_id, set); }
    set.add(k);
  }
  let best = null;
  for (const [tid, set] of per) {
    if (!best || set.size > best.cities) best = { trip_id: tid, cities: set.size, title: trips?.[tid]?.title || null };
  }
  return best;
}

// ─── convenience bundles ─────────────────────────────────────────────────────
/** Home statbar (caller passes all points; home is not year-filtered). */
export function homeStats(points = [], transfersTotal = 0) {
  return {
    countries: countCountries(points),
    cities: countCities(points),
    trips: countTrips(points),
    transfers: transfersTotal,
    world: worldExplored(points),
  };
}
/** "My statistics" screen bundle for the active year selection. */
export function statisticsBundle(points = [], trips = {}) {
  return {
    countries: countCountries(points),
    cities: countCities(points),
    continents: countContinents(points),
    trips: countTrips(points),
    world: worldExplored(points),
    continentsBreakdown: continentsBreakdown(points),
    countriesList: countriesList(points),
    citiesList: citiesList(points),
    byYear: tripsByYear(points),
    records: {
      days: daysInTrips(points),
      favoriteCity: favoriteCity(points),
      favoriteCountry: favoriteCountry(points),
      longestTrip: longestTrip(points, trips),
    },
  };
}
