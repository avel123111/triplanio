// City / address geocoding via LocationIQ (managed Nominatim on OSM/ODbL),
// proxied through the `geoLocationiq` edge function so the LocationIQ key stays
// server-side. LocationIQ mirrors the Nominatim response shape (place_id, lat,
// lon, display_name, address{}, type, class, importance), so the mapping below
// is unchanged from the previous direct-Nominatim implementation.
//
// Results may be stored permanently (OSM/ODbL + attribution — a "Search by
// LocationIQ" backlink is required on the Free plan). Timezones are resolved
// separately offline via src/lib/timezone.js (tz-lookup).
// Returns: { external_city_id, city_name, country, country_code, latitude, longitude }
import { supabase } from '@/api/supabaseClient';

// Thin call into the geoLocationiq edge proxy. Returns the LocationIQ result
// array (Nominatim-shaped) or [] on any error.
async function liq(action, body) {
  // Retry with backoff on an invoke error. LocationIQ free is ~2 req/s; when the
  // rate limit is hit the geoLocationiq edge function returns a 502 (upstream
  // 429), surfacing here as `error`. Without retry that becomes [] → empty search
  // dropdown / unresolved (red) cities. A genuine no-match returns a 200 with an
  // empty array (no error), so it is NOT retried (no added latency on normal use).
  const backoff = [0, 600, 1200];
  for (let attempt = 0; attempt < backoff.length; attempt++) {
    if (backoff[attempt]) await new Promise((r) => setTimeout(r, backoff[attempt]));
    const { data, error } = await supabase.functions.invoke('geoLocationiq', {
      body: { action, ...body },
    });
    if (!error) return data?.results || [];
  }
  return [];
}

const POPULATED = new Set([
  'city', 'town', 'village', 'hamlet', 'suburb', 'neighbourhood',
  'municipality', 'locality', 'administrative', 'island', 'islet',
  'state', 'county', 'region', 'province',
]);

// Map one raw LocationIQ/Nominatim row → the app's city shape.
function mapCity(d) {
  const a = d.address || {};
  const name =
    a.city || a.town || a.village || a.hamlet || a.suburb ||
    a.neighbourhood || a.municipality || a.locality || a.county ||
    a.state || d.name || d.display_name.split(',')[0];
  const nd = d.namedetails || {};
  return {
    external_city_id: String(d.place_id),
    city_name: name,
    // Canonical English name from namedetails: explicit name:en, else the
    // international name, else the default OSM name (Latin for many cities).
    city_name_en: nd['name:en'] || nd['int_name'] || nd['name'] || '',
    country: a.country || '',
    country_code: (a.country_code || '').toUpperCase(),
    latitude: parseFloat(d.lat),
    longitude: parseFloat(d.lon),
    display_name: d.display_name,
    _importance: d.importance || 0,
  };
}

// Filter a raw LocationIQ array to populated places, dedup, sort by importance,
// cap at 12. Shared by searchCities (single) and resolveCities (batch) so the
// "pick the right city" logic lives in ONE place.
function refineCities(data) {
  const seen = new Set();
  return (data || [])
    .filter(d => POPULATED.has(d.type) || d.class === 'place' || d.class === 'boundary')
    .map(mapCity)
    .filter(c => {
      const key = `${c.city_name}|${c.country_code}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    })
    .sort((a, b) => b._importance - a._importance)
    .slice(0, 12);
}

export async function searchCities(query, lang) {
  if (!query || query.length < 2) return [];
  // Caller passes the app language so city/country names come back localized.
  const acceptLang = lang
    || (typeof navigator !== 'undefined' && navigator.language)
    || 'en';
  // No type filter upstream - the geocoder's city filter is too restrictive and
  // misses resort towns / villages / suburbs (e.g. Maspalomas). We request more
  // results and filter to populated places client-side.
  const data = await liq('search', { q: query, lang: acceptLang, limit: 20 });
  return refineCities(data);
}

// Batch-resolve many city names in ONE edge call (TRIP-145 P2). The edge dedups
// identical queries and shares the 'search' cache; we get back an array aligned
// to `queries`, each element refined exactly like searchCities (best = [0]) so
// callers pick result[0] as before. Background priority (yields to interactive
// autocomplete/manual search under the rate limit).
export async function resolveCities(queries, lang) {
  if (!Array.isArray(queries) || queries.length === 0) return [];
  const acceptLang = lang
    || (typeof navigator !== 'undefined' && navigator.language)
    || 'en';
  const cities = queries.map((qx) => ({ q: qx, lang: acceptLang }));
  const { data, error } = await supabase.functions.invoke('geoLocationiq', {
    body: { action: 'resolveCities', cities },
  });
  if (error) return queries.map(() => []);
  const raw = data?.results || [];
  return queries.map((_, i) => refineCities(raw[i] || []));
}

// Reverse geocode lat/lon → city object.
// `lang` = app locale so the detected city/country come back localized
// (matches searchCities). Falls back to the browser language, then 'en'.
export async function reverseGeocode(lat, lon, lang) {
  const acceptLang = lang
    || (typeof navigator !== 'undefined' && navigator.language)
    || 'en';
  const rows = await liq('reverse', { lat, lon, lang: acceptLang });
  const d = rows[0];
  if (!d) return null;
  const a = d.address || {};
  const name = a.city || a.town || a.village || a.hamlet || a.suburb || a.municipality || d.name;
  if (!name) return null;
  return {
    external_city_id: String(d.place_id),
    city_name: name,
    country: a.country || '',
    country_code: (a.country_code || '').toUpperCase(),
    latitude: parseFloat(d.lat),
    longitude: parseFloat(d.lon),
    display_name: d.display_name,
  };
}

// Forward-geocode a full street address (booking parsing, TRIP-145). NOT cached
// server-side (addresses are high-cardinality, ~zero cross-user reuse). Returns
// { latitude, longitude } ONLY when the match is house/building level; otherwise
// null — the caller keeps the original address as text with NO map point and
// never falls back to the city center. Background priority on the edge.
function isHouseLevel(d) {
  const a = d.address || {};
  return Boolean(a.house_number) || d.type === 'house' || d.type === 'building' || d.class === 'building';
}

export async function geocodeAddress(address, lang) {
  if (!address || !String(address).trim()) return null;
  const acceptLang = lang
    || (typeof navigator !== 'undefined' && navigator.language)
    || 'en';
  const { data, error } = await supabase.functions.invoke('geoLocationiq', {
    body: { action: 'geocodeAddress', q: String(address), lang: acceptLang, limit: 1 },
  });
  if (error) return null;
  const d = (data?.results || [])[0];
  if (!d || !isHouseLevel(d)) return null;
  const latitude = parseFloat(d.lat);
  const longitude = parseFloat(d.lon);
  if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) return null;
  return { latitude, longitude };
}

// Resolve the canonical English city name by forward-searching the (possibly
// localized) city name; searchCities reads namedetails (name:en / int_name /
// name), which is accurate — unlike reverse geocoding, which returned
// sub-localities (Tao/Khok Tum, see TRIP-142). Used for Stay22 address search and
// partner/referral links. Returns '' when unavailable.
export async function cityNameEn(cityName, countryCode) {
  if (!cityName) return '';
  const rows = await searchCities(cityName, 'en');
  const best = (countryCode && rows.find(r => r.country_code === String(countryCode).toUpperCase())) || rows[0];
  return best?.city_name_en || '';
}

// Country code → emoji flag
export function countryFlag(code) {
  if (!code || code.length !== 2) return '🌍';
  const cc = code.toUpperCase();
  return String.fromCodePoint(...[...cc].map(c => 0x1f1a5 + c.charCodeAt(0)));
}
