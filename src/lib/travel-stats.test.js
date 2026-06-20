import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  pointYear, availableYears, filterByYear, pointType,
  countCities, countCountries, countContinents, countTrips,
  worldExplored, countriesList, citiesList, continentsBreakdown,
  tripsByYear, daysInTrips, favoriteCity, favoriteCountry, longestTrip,
  WORLD_COUNTRIES, dominantTone, TONE, TONE_RANK,
} from './travel-stats.js';

// trip A (2024): Madrid, Barcelona (ES) + return Madrid (dedup) → 2 cities, 1 country
// trip B (2025): Paris (FR), Rome (IT) → 2 cities, 2 countries
// custom: Tokyo (JP) 2023
const pts = [
  { kind: 'trip', trip_id: 'A', city_name: 'Madrid', country_code: 'ES', lat: 40.4, lng: -3.7, start_date: '2024-03-01', end_date: '2024-03-04' },
  { kind: 'trip', trip_id: 'A', city_name: 'Barcelona', country_code: 'ES', lat: 41.4, lng: 2.2, start_date: '2024-03-04', end_date: '2024-03-08' },
  { kind: 'trip', trip_id: 'A', city_name: 'Madrid', country_code: 'ES', lat: 40.4, lng: -3.7, start_date: '2024-03-08', end_date: '2024-03-09' },
  { kind: 'trip', trip_id: 'B', city_name: 'Paris', country_code: 'FR', lat: 48.8, lng: 2.3, start_date: '2025-06-01', end_date: '2025-06-05' },
  { kind: 'trip', trip_id: 'B', city_name: 'Rome', country_code: 'IT', lat: 41.9, lng: 12.5, start_date: '2025-06-05', end_date: '2025-06-09' },
  { kind: 'custom', trip_id: null, city_name: 'Tokyo', country_code: 'JP', lat: 35.7, lng: 139.7, start_date: '2023-10-10', end_date: '2023-10-20' },
];
const trips = { A: { title: 'Spain' }, B: { title: 'Italy & France' } };

test('counts match trip-cities dedup (city+country)', () => {
  assert.equal(countCities(pts), 5);      // Madrid×2 → 1, +Barcelona, Paris, Rome, Tokyo
  assert.equal(countCountries(pts), 4);   // ES, FR, IT, JP
  assert.equal(countContinents(pts), 2);  // EU, AS
  assert.equal(countTrips(pts), 2);
});

test('world explored uses 195 denominator', () => {
  const w = worldExplored(pts);
  assert.equal(w.total, WORLD_COUNTRIES);
  assert.equal(w.visited, 4);
  assert.equal(w.pct, Math.round((4 / 195) * 100));
});

test('pointType buckets', () => {
  const today = new Date('2025-01-01');
  assert.equal(pointType(pts[5], today), 'manual');
  assert.equal(pointType(pts[0], today), 'trip');
  assert.equal(pointType({ kind: 'trip', start_date: '2026-01-01' }, today), 'future');
});

test('dominantTone — "most real" wins, tokens bound', () => {
  const today = new Date('2025-01-01');
  // trip beats manual beats future at the same place
  assert.equal(dominantTone([{ kind: 'custom' }, pts[0]]), 'trip');
  assert.equal(dominantTone([{ kind: 'custom' }, { kind: 'trip', start_date: '2099-01-01' }]), 'manual');
  assert.equal(dominantTone([{ kind: 'trip', start_date: '2099-01-01' }]), 'future', `today=${today.toISOString()}`);
  assert.equal(dominantTone([]), 'trip');
  assert.equal(TONE_RANK.trip < TONE_RANK.manual && TONE_RANK.manual < TONE_RANK.future, true);
  assert.equal(TONE.trip, 'hsl(var(--primary))');
  assert.equal(TONE.manual, 'hsl(var(--primary))');
  assert.equal(TONE.future, 'var(--ev-activity)');
});

test('year filter', () => {
  assert.deepEqual(availableYears(pts), [2025, 2024, 2023]);
  assert.equal(countTrips(filterByYear(pts, 2024)), 1);
  assert.equal(countCities(filterByYear(pts, 2025)), 2);
  assert.equal(countCities(filterByYear(pts, 'all')), 5);
});

test('records', () => {
  assert.equal(pointYear(pts[0]), 2024);
  // trip A spans 2024-03-01..2024-03-09 = 9 days; trip B 2025-06-01..06-09 = 9 days → 18
  assert.equal(daysInTrips(pts), 18);
  const fc = favoriteCity(pts);
  assert.equal(fc.city_name, 'Madrid');
  assert.equal(fc.count, 2);
  assert.equal(favoriteCountry(pts).code, 'ES');
  const lt = longestTrip(pts, trips);
  assert.equal(lt.cities, 2); // both trips have 2 unique cities; first max wins
  assert.deepEqual(tripsByYear(pts), { 2024: 1, 2025: 1 });
});

test('lists + continents breakdown', () => {
  assert.equal(countriesList(pts)[0].code, 'ES');
  assert.equal(citiesList(pts)[0].city_name, 'Madrid');
  assert.deepEqual(continentsBreakdown(pts), { EU: 3, AS: 1 });
});
