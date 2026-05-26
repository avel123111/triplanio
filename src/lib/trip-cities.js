/**
 * Count the unique cities in a list of CityVisit records.
 * A "duplicate" is the same physical city — e.g. flying out of Madrid
 * and coming back to Madrid should still count as 1 unique city.
 *
 * Identity is determined by (in order of preference):
 *   1. external_city_id  — when present, this is the canonical id
 *   2. city_name (lowercased & trimmed) + country_code — fallback
 */
export function uniqueCityCount(visits = []) {
  if (!Array.isArray(visits) || visits.length === 0) return 0;
  const keys = new Set();
  for (const v of visits) {
    if (!v) continue;
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