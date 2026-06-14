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
  const { data, error } = await supabase.functions.invoke('geoLocationiq', {
    body: { action, ...body },
  });
  if (error) return [];
  return data?.results || [];
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

  const POPULATED = new Set([
    'city', 'town', 'village', 'hamlet', 'suburb', 'neighbourhood',
    'municipality', 'locality', 'administrative', 'island', 'islet',
    'state', 'county', 'region', 'province',
  ]);

  const seen = new Set();
  return data
    .filter(d => POPULATED.has(d.type) || d.class === 'place' || d.class === 'boundary')
    .map(d => {
      const a = d.address || {};
      const name =
        a.city || a.town || a.village || a.hamlet || a.suburb ||
        a.neighbourhood || a.municipality || a.locality || a.county ||
        a.state || d.name || d.display_name.split(',')[0];
      return {
        external_city_id: String(d.place_id),
        city_name: name,
        country: a.country || '',
        country_code: (a.country_code || '').toUpperCase(),
        latitude: parseFloat(d.lat),
        longitude: parseFloat(d.lon),
        display_name: d.display_name,
        _importance: d.importance || 0,
      };
    })
    .filter(c => {
      const key = `${c.city_name}|${c.country_code}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    })
    .sort((a, b) => b._importance - a._importance)
    .slice(0, 12);
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

// Country code → emoji flag
export function countryFlag(code) {
  if (!code || code.length !== 2) return '🌍';
  const cc = code.toUpperCase();
  return String.fromCodePoint(...[...cc].map(c => 0x1f1a5 + c.charCodeAt(0)));
}
