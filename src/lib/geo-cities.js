// Pure city-shaping helpers for the GeoNames gazetteer path (TRIP-146/214).
// Extracted from geo.js so they can be unit-tested directly: geo.js imports the
// `@/api/supabaseClient` alias, which the `node --test` runner can't resolve, so
// anything living there is untestable. Nothing here touches the network.

// Map one search_gazetteer(_batch) RPC row → the app's city shape. `geonameid`
// is the v2 identity key; `name_i18n` is the hot-path localized snapshot
// (en/es/ru) the caller bakes onto the visit at save time so trip/stats
// rendering never joins the gazetteer. Display name = snapshot for the active
// locale, falling back to the RPC's localized `display`. Country name is NOT
// carried — partner builders derive it from country_code (countryNameEn).
export function mapGazCity(g, lk) {
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

// Build the `search_gazetteer_batch` payload aligned to `items` (array order is
// the RPC's `ord`). `items` entries are EITHER plain query strings OR objects
// `{ city_name, name_en, country_code }`. For objects we query by the English
// name (small towns that miss in Cyrillic resolve in English) and, when present,
// filter to same-country matches server-side via `cc`. `lk` is the normalized
// app locale used for the free-text (string) queries.
export function buildResolvePayload(items, lk) {
  return items.map((it) => {
    const isStr = typeof it === 'string';
    const nameEn = isStr ? '' : (it.name_en || it.city_name_en || '').trim();
    const cc = isStr ? '' : (it.country_code || '').trim().toUpperCase();
    const q = isStr ? it : (nameEn || it.city_name || it.q || '');
    return { q, cc, lang: nameEn ? 'en' : lk };
  });
}

// Re-expand the batch RPC rows (one best match per input, aligned by 1-based
// `ord`, missing rows for empty/unmatched inputs) into an array aligned to the
// original `count` inputs — each a 0- or 1-length list so callers keep picking
// result[0], exactly as the old per-item resolveCities returned.
export function expandBatchRows(rows, count, lk) {
  const out = Array.from({ length: count }, () => []);
  for (const g of rows || []) {
    const idx = (Number(g.ord) | 0) - 1;
    if (idx < count && idx >= 0) out[idx] = [mapGazCity(g, lk)];
  }
  return out;
}
