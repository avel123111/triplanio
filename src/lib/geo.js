// Geocoding split (TRIP-146 + TRIP-226): CITY operations run inhouse against the
// local GeoNames gazetteer (RPCs search_gazetteer / search_gazetteer_batch /
// nearest_cities) — one identity key `geonameid`, localized name_i18n snapshot,
// no external dependency. Only ADDRESS operations (booking parsing) still use
// LocationIQ (managed Nominatim on OSM/ODbL) via the `geoLocationiq` edge proxy,
// which keeps the billable key server-side. Timezones are resolved separately
// offline via src/lib/timezone.js (tz-lookup).
import { supabase } from '@/api/supabaseClient';
import { invokeFn } from '@/lib/invokeFn';
import { mapGazCity, buildResolvePayload, expandBatchRows } from './geo-cities.js';

// App UI locales baked into the per-visit name_i18n snapshot. Anything else
// collapses to English.
function normLang(lang) {
  const l = (lang || (typeof navigator !== 'undefined' && navigator.language) || 'en')
    .slice(0, 2).toLowerCase();
  return (l === 'es' || l === 'ru') ? l : 'en';
}

// City typeahead via the local GeoNames gazetteer (TRIP-146): one stable RPC
// `search_gazetteer`, no LocationIQ. Rows come back already filtered + ranked
// server-side (one per geonameid), mapped to the shared city shape. `lang`
// localizes both the display and the name_i18n snapshot.
export async function searchCities(query, lang) {
  if (!query || query.length < 2) return [];
  const lk = normLang(lang);
  const { data, error } = await supabase.rpc('search_gazetteer', { q: query, lang: lk, lim: 12 });
  if (error) return [];
  return (data || []).map((g) => mapGazCity(g, lk));
}

// Batch-resolve many city names → geonameid via the gazetteer (TRIP-146/214/159).
// `items` is an array of EITHER plain query strings OR objects
// `{ city_name, name_en, country, country_code }`. For objects we send BOTH the
// localized name and the English name; the RPC resolves the localized one first
// (the gazetteer has native alt-names, so it's the widest — esp. Cyrillic towns
// the AI mis-transliterates) and falls back to English for small foreign towns
// without a localized alt-name. `country_code` biases toward same-country matches.
//
// ONE `search_gazetteer_batch` RPC resolves the whole list server-side — one
// round-trip, one plan, one pooled connection (TRIP-214). This replaces the old
// `Promise.all(items.map(rpc))`, which fired N concurrent search_gazetteer calls
// with no concurrency limit and could storm the shared connection pool on a
// long AI route. Returns an array aligned to `items`, each a (0- or 1-length)
// list so callers pick result[0] as before. The displayed/saved name stays the
// caller's — we supply geonameid + coords + the name_i18n snapshot.
export async function resolveCities(items, lang) {
  if (!Array.isArray(items) || items.length === 0) return [];
  const lk = normLang(lang);
  const { data, error } = await supabase.rpc('search_gazetteer_batch', {
    items: buildResolvePayload(items, lk),
    lang: lk,
  });
  if (error) return items.map(() => []);
  return expandBatchRows(data, items.length, lk);
}

// Reverse geocode lat/lon → the nearest gazetteer cities (TRIP-226, inhouse).
// Resolves coordinates to the `lim` closest cities in OUR GeoNames gazetteer
// (RPC nearest_cities), NOT LocationIQ. Each candidate is a full gazetteer city
// (geonameid + name_i18n{en,es,ru} + external_city_id), so a picked anchor then
// behaves like any searched city (localized names, stats dedup, hotels). We
// return an ARRAY of 2-3 candidates because the single closest point is often a
// suburb — the big city the user means may be the 2nd/3rd. `lang` localizes the
// display/subtitle; the name_i18n snapshot always carries all app locales.
// Returns [] on error (caller falls back to manual CityPicker input).
export async function nearbyCities(lat, lon, lang, lim = 3) {
  const lk = normLang(lang);
  const { data, error } = await supabase.rpc('nearest_cities', {
    _lat: lat, _lng: lon, _lim: lim, _lang: lk,
  });
  if (error) return [];
  return (data || []).map((g) => mapGazCity(g, lk));
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
  const { data, error } = await invokeFn('geoLocationiq', {
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
