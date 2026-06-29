/**
 * Trip "city" / "country" identity + counting — the single source of truth.
 *
 * A trip's headline city/country numbers AND the city list shown on the trips
 * card must be identical everywhere (Overview stat row, trip header, editor
 * header, trips card, map stepper, public trip). To guarantee that, every count
 * AND every "which cities" label flows through the helpers here.
 *
 * Two rules, applied in this order:
 *   1. Scope = TRANSIT cities only. The start anchor, the end anchor and
 *      waypoints (pass-through points with no stay) are NOT destinations and
 *      never count. Identity is the `kind` field: only `kind === 'transit'`.
 *   2. Dedup repeats by CITY identity. The same physical city visited twice —
 *      e.g. flying out of Madrid and returning to Madrid, or Moscow entered
 *      twice — counts once. Identity is the GeoNames `geonameid` (TRIP-146): a
 *      stable, language-independent key that also fixes same-city-two-external-ids
 *      fragmentation for free. Legacy rows without a geonameid fall back to
 *      `name` (the English snapshot `name_i18n.en`, else the `city_name_en`
 *      column) lowercased+trimmed + `country_code`; raw `external_city_id` is
 *      only a last resort for a nameless row (it is NOT the primary key: the same
 *      city can carry different external ids across two picks). Country identity
 *      is the ISO `country_code`.
 */

/**
 * Localized display name of a city visit (TRIP-146/TRIP-65). The per-visit
 * `name_i18n` snapshot (en/es/ru) is the source of truth; `city_name_en` is the
 * fallback when the active locale is absent. The `city_name` DB column was
 * dropped in Phase 6, so it is NOT a source here — `city_name` survives only as
 * the in-memory display slot that `localizeVisits` writes INTO (below).
 */
export function cityLabel(v, lang) {
  if (!v) return '';
  const l = String(lang || 'en').slice(0, 2).toLowerCase();
  const i = v.name_i18n || {};
  return i[l] || i.en || v.city_name_en || '';
}

/**
 * Map fetched visits so each carries a localized `city_name` derived from its
 * snapshot. Applied once at each data-load seam so every downstream consumer
 * (~all trip/stats screens) reads the localized name without per-site changes,
 * and switching UI language re-localizes live. Non-mutating; unchanged rows are
 * returned as-is. A visit with no resolvable label (empty `cityLabel`) keeps its
 * existing `city_name` — we never overwrite a name with an empty string.
 */
export function localizeVisits(visits, lang) {
  if (!Array.isArray(visits)) return [];
  return visits.map((v) => {
    const label = cityLabel(v, lang);
    return v && label && label !== v.city_name ? { ...v, city_name: label } : v;
  });
}

/** A real destination: a city stay, not an anchor or a pass-through waypoint. */
export function isTransitVisit(v) {
  return !!v && v.kind === 'transit';
}

/** Filter a visit list down to transit destinations only. */
export function transitVisits(visits = []) {
  return Array.isArray(visits) ? visits.filter(isTransitVisit) : [];
}

/**
 * Canonical city identity key (TRIP-146). Priority:
 *   1. `gn:<geonameid>` — GeoNames identity, strongest + language-independent.
 *   2. `<name>|<cc>`    — legacy fallback for rows still missing a geonameid.
 *                         name = English snapshot first (stable across UI locale),
 *                         then the `city_name_en` column. NOT `city_name` (that DB
 *                         column was dropped in Phase 6; it is only a display slot).
 *   3. `id:<external_city_id>` — last resort for a nameless row.
 * Returns null when a visit has no usable identity (ignored by counts/labels).
 */
export function cityKey(v) {
  if (!v) return null;
  if (v.geonameid != null && v.geonameid !== '') return `gn:${v.geonameid}`;
  const name = String(v.name_i18n?.en || v.city_name_en || '')
    .trim().toLowerCase();
  if (name) {
    const cc = (v.country_code || '').trim().toLowerCase();
    return `${name}|${cc}`;
  }
  if (v.external_city_id) return `id:${v.external_city_id}`;
  return null;
}

/**
 * The trip's unique transit cities: one representative visit (first occurrence)
 * per "city + country", in the input order. This single deduped set backs BOTH
 * the city count and the city-name label so they can never disagree.
 */
export function uniqueTransitCities(visits = []) {
  const seen = new Set();
  const out = [];
  for (const v of transitVisits(visits)) {
    const key = cityKey(v);
    if (!key || seen.has(key)) continue;
    seen.add(key);
    out.push(v);
  }
  return out;
}

/** Number of unique transit cities (anchors/waypoints excluded, repeats deduped). */
export function uniqueCityCount(visits = []) {
  return uniqueTransitCities(visits).length;
}

/**
 * Number of unique countries across the trip's transit cities (by ISO
 * country_code). Anchors and waypoints are excluded.
 */
export function uniqueCountryCount(visits = []) {
  const codes = new Set();
  for (const v of transitVisits(visits)) {
    const cc = (v?.country_code || '').trim().toLowerCase();
    if (cc) codes.add(cc);
  }
  return codes.size;
}
