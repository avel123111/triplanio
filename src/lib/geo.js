// Search cities via OSM Nominatim (no API key required)
// Returns: { external_city_id, city_name, country, country_code, latitude, longitude, timezone }
// We use a public, no-key approach with Nominatim for location and timeapi.io for timezone lookup as fallback.
// Since timeapi.io may be unreliable, we approximate timezone by longitude when needed.

const NOMINATIM = 'https://nominatim.openstreetmap.org/search';

export async function searchCities(query, lang) {
  if (!query || query.length < 2) return [];
  // No featureType filter - Nominatim's city filter is too restrictive and misses
  // many resort towns / villages / suburbs (e.g. Maspalomas).
  // We request more results and filter to populated places client-side.
  // Caller passes the app language so city/country names come back localized.
  const acceptLang = lang
    || (typeof navigator !== 'undefined' && navigator.language)
    || 'en';
  const url =
    `${NOMINATIM}?q=${encodeURIComponent(query)}&format=json&addressdetails=1&limit=20&accept-language=${encodeURIComponent(acceptLang)}`;
  const res = await fetch(url, { headers: { 'Accept': 'application/json' } });
  if (!res.ok) return [];
  const data = await res.json();

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

// Resolve IANA timezone from lat/lon via Open-Meteo (free, no key)
export async function getTimezone(lat, lon) {
  const url = `https://api.open-meteo.com/v1/forecast?latitude=${lat}&longitude=${lon}&timezone=auto&forecast_days=1`;
  try {
    const res = await fetch(url);
    if (!res.ok) return 'UTC';
    const data = await res.json();
    return data.timezone || 'UTC';
  } catch {
    return 'UTC';
  }
}

// Reverse geocode lat/lon → city object (Nominatim reverse, no key needed)
// `lang` = app locale so the detected city/country come back localized
// (matches searchCities). Falls back to the browser language, then 'en'.
export async function reverseGeocode(lat, lon, lang) {
  try {
    const acceptLang = lang
      || (typeof navigator !== 'undefined' && navigator.language)
      || 'en';
    const url = `https://nominatim.openstreetmap.org/reverse?lat=${lat}&lon=${lon}&format=json&addressdetails=1&accept-language=${encodeURIComponent(acceptLang)}`;
    const res = await fetch(url, { headers: { 'Accept': 'application/json' } });
    if (!res.ok) return null;
    const d = await res.json();
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
  } catch {
    return null;
  }
}

// Country code → emoji flag
export function countryFlag(code) {
  if (!code || code.length !== 2) return '🌍';
  const cc = code.toUpperCase();
  return String.fromCodePoint(...[...cc].map(c => 0x1f1a5 + c.charCodeAt(0)));
}