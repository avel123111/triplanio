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
import { invokeFn } from '@/lib/invokeFn';
import { liqRetryDelayMs } from './geo-retry.js';
import { mapGazCity, buildResolvePayload, expandBatchRows } from './geo-cities.js';

// Thin call into the geoLocationiq edge proxy. Returns the LocationIQ result
// array (Nominatim-shaped) or [] on any error.
async function liq(action, body) {
  // ONE retry on an invoke error (TRIP-59). LocationIQ free is ~2 req/s; when the
  // shared budget is spent the geoLocationiq edge returns 429 + Retry-After (or a
  // 502 on an upstream error), surfacing here as `error`. Without a retry that
  // becomes [] → empty search dropdown / unresolved (red) cities. A genuine
  // no-match returns a 200 with an empty array (no error) → NOT retried.
  //
  // Why one Retry-After-honoring + jittered retry, not the old fixed [0,600,1200]
  // triple: the edge ALREADY waits its own token budget (and fair-queues) before
  // degrading, so stacking fixed client waits double-counts the delay, and an
  // identical schedule across clients synchronizes the herd. 401 (stale token) is
  // handled one layer down by the client's auth-retry fetch (TRIP-56), so it never
  // reaches here. Batch resolveCities does NOT use liq() — it degrades as a 200 and
  // is deliberately not retried.
  for (let attempt = 0; attempt < 2; attempt++) {
    const { data, error } = await invokeFn('geoLocationiq', {
      body: { action, ...body },
    });
    if (!error) return data?.results || [];
    if (attempt === 0) await new Promise((r) => setTimeout(r, liqRetryDelayMs(error)));
  }
  return [];
}

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
