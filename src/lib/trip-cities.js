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
 *   2. Dedup repeats by CITY + COUNTRY. The same physical city visited twice —
 *      e.g. flying out of Madrid and returning to Madrid, or Moscow entered
 *      twice with two different external_city_id — counts once. Identity is
 *      `city_name` (lowercased+trimmed) + `country_code`. external_city_id is
 *      deliberately NOT used: the same city can carry different external ids
 *      across two picks, which would wrongly inflate the count. Country
 *      identity is the ISO `country_code`.
 */

/** A real destination: a city stay, not an anchor or a pass-through waypoint. */
export function isTransitVisit(v) {
  return !!v && v.kind === 'transit';
}

/** Filter a visit list down to transit destinations only. */
export function transitVisits(visits = []) {
  return Array.isArray(visits) ? visits.filter(isTransitVisit) : [];
}

/**
 * Canonical city identity key: "city + country". Returns null when a visit has
 * no usable name (so it's ignored by counts/labels). external_city_id is only
 * a last-resort fallback for the rare nameless row.
 */
export function cityKey(v) {
  if (!v) return null;
  if (v.city_name) {
    const name = String(v.city_name).trim().toLowerCase();
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
