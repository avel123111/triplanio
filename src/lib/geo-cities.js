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
// `{ city_name, name_en, country_code }`.
//
// TRIP-159: we send BOTH names — `q` = the localized name (user's language),
// `q_en` = the English name — and the RPC tries localized first, English as
// fallback. The gazetteer has native alt-names on all languages, so the
// user-language name resolves the widest (esp. Cyrillic towns the AI
// mis-transliterates into a non-matching English form); the English name still
// rescues small foreign towns that lack a localized alt-name. `cc` keeps the
// server-side same-country preference. `lk` is the normalized app locale used
// for both free-text (string) inputs and objects.
export function buildResolvePayload(items, lk) {
  return items.map((it) => {
    const isStr = typeof it === 'string';
    const nameEn = isStr ? '' : (it.name_en || it.city_name_en || '').trim();
    const cc = isStr ? '' : (it.country_code || '').trim().toUpperCase();
    // `it.q` = passthrough for an already-shaped query object (rare caller).
    const q = isStr ? it : (it.city_name || it.q || '');
    return { q, q_en: nameEn, cc, lang: lk };
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
