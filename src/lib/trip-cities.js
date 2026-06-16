/**
 * Trip "city" / "country" identity + counting — the single source of truth.
 *
 * A trip's headline city/country counts must be identical everywhere they are
 * shown (Overview stat row, trip header, editor header, trips card, map stepper,
 * public trip). To guarantee that, every count flows through the helpers here.
 *
 * Two rules, applied in this order:
 *   1. Scope = TRANSIT cities only. The start anchor, the end anchor and
 *      waypoints (pass-through points with no stay) are NOT destinations and
 *      never count. Identity is the `kind` field: only `kind === 'transit'`.
 *   2. Dedup repeats. The same physical city visited twice — e.g. flying out of
 *      Madrid and returning to Madrid — counts once. City identity is, in order
 *      of preference: external_city_id, else city_name (lowercased+trimmed) +
 *      country_code. Country identity is the ISO country_code.
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
 * Count the unique transit cities in a list of CityVisit records.
 * Anchors (start/end) and waypoints are excluded; repeated visits to the same
 * city count once.
 */
export function uniqueCityCount(visits = []) {
  const transit = transitVisits(visits);
  if (transit.length === 0) return 0;
  const keys = new Set();
  for (const v of transit) {
    if (v.external_city_id) {
      keys.add(`id:${v.external_city_id}`);
    } else if (v.city_name) {
      const name = String(v.city_name).trim().toLowerCase();
      const cc = (v.country_code || '').toLowerCase();
      keys.add(`name:${name}|${cc}`);
    }
  }
  return keys.size;
}

/**
 * Count the unique countries across a trip's transit cities (by ISO
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
