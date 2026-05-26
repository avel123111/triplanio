export function getTripCountryNames(cities = [], fmtCountry, t) {
  const countries = [];
  const seen = new Set();

  for (const city of cities || []) {
    const key = city.country_code || city.country;
    if (!key || seen.has(key)) continue;
    seen.add(key);
    countries.push(city.country_code ? fmtCountry(city.country_code, city.country) : city.country);
  }

  if (countries.length === 0) return '';
  if (countries.length <= 2) return countries.join(', ');
  return t('trips.country_count', { count: countries.length });
}