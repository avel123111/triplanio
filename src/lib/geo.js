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
import { liqRetryDelayMs } from './geo-retry.js';

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
    const { data, error } = await supabase.functions.invoke('geoLocationiq', {
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

// Map one search_gazetteer RPC row → the app's city shape (TRIP-146). `geonameid`
// is the v2 identity key; `name_i18n` is the hot-path localized snapshot (en/es/ru)
// the caller bakes onto the visit at save time so trip/stats rendering never
// joins the gazetteer. Display name = snapshot for the active locale, falling
// back to the RPC's localized `display`. Country name is NOT carried — partner
// builders derive it from country_code (countryNameEn).
function mapGazCity(g, lk) {
  const i18n = g.name_i18n || {};
  return {
    geonameid: g.geonameid,
    external_city_id: g.geonameid != null ? String(g.geonameid) : null,
    city_name: i18n[lk] || g.display || '',
    city_name_en: i18n.en || g.display || '',
    name_i18n: i18n,
    country: null,
    country_code: (g.country_code || '').toUpperCase(),
    latitude: g.lat,
    longitude: g.lng,
    display_name: g.subtitle || '',
  };
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

// Batch-resolve many city names → geonameid via the gazetteer RPC (TRIP-146;
// replaces the LocationIQ edge path). `items` is an array of EITHER plain query
// strings OR objects `{ city_name, name_en, country, country_code }`. For objects
// we query by the English name (small towns that miss in Cyrillic resolve in
// English) and, when a country_code is given, keep only same-country matches.
// Returns an array aligned to `items`, each a refined list (best = [0]) so callers
// pick result[0] as before. The displayed/saved name stays the caller's — we
// supply geonameid + coords + the name_i18n snapshot.
export async function resolveCities(items, lang) {
  if (!Array.isArray(items) || items.length === 0) return [];
  const lk = normLang(lang);
  return Promise.all(items.map(async (it) => {
    const isStr = typeof it === 'string';
    const nameEn = isStr ? '' : (it.name_en || it.city_name_en || '').trim();
    const cc = isStr ? '' : (it.country_code || '').trim().toUpperCase();
    const q = isStr ? it : (nameEn || it.city_name || it.q || '');
    if (!q) return [];
    const { data, error } = await supabase.rpc('search_gazetteer', { q, lang: nameEn ? 'en' : lk, lim: 10 });
    if (error) return [];
    let rows = data || [];
    if (cc) {
      const inCc = rows.filter((g) => (g.country_code || '').toUpperCase() === cc);
      if (inCc.length) rows = inCc;
    }
    return rows.map((g) => mapGazCity(g, lk));
  }));
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
