// Unit tests for the single source of truth for city/country counting.
// Run: npm test  (node --test)
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { uniqueCityCount, uniqueCountryCount, transitVisits, isTransitVisit } from './trip-cities.js';

// A trip: home anchor (start) → Lisbon → Porto → a pass-through waypoint →
// Madrid → back to Lisbon → home anchor (end). Anchors + waypoint must not
// count; the repeated Lisbon counts once.
const VISITS = [
  { id: 'a0', kind: 'start',    city_name: 'Berlin', country_code: 'DE', external_city_id: 'de-berlin' },
  { id: 'c1', kind: 'transit',  city_name: 'Lisbon', country_code: 'PT', external_city_id: 'pt-lisbon' },
  { id: 'c2', kind: 'transit',  city_name: 'Porto',  country_code: 'PT', external_city_id: 'pt-porto' },
  { id: 'w1', kind: 'waypoint', city_name: 'Badajoz', country_code: 'ES', external_city_id: 'es-badajoz' },
  { id: 'c3', kind: 'transit',  city_name: 'Madrid', country_code: 'ES', external_city_id: 'es-madrid' },
  { id: 'c4', kind: 'transit',  city_name: 'Lisbon', country_code: 'PT', external_city_id: 'pt-lisbon' }, // repeat
  { id: 'a1', kind: 'end',      city_name: 'Berlin', country_code: 'DE', external_city_id: 'de-berlin' },
];

test('uniqueCityCount: transit only, repeats deduped', () => {
  // Lisbon, Porto, Madrid (Lisbon repeat dedup'd; Berlin anchors + Badajoz waypoint excluded)
  assert.equal(uniqueCityCount(VISITS), 3);
});

test('uniqueCountryCount: countries of transit cities only', () => {
  // PT + ES (DE belongs only to the anchors -> excluded)
  assert.equal(uniqueCountryCount(VISITS), 2);
});

test('counts ignore anchors/waypoints entirely', () => {
  const anchorsOnly = VISITS.filter((v) => v.kind !== 'transit');
  assert.equal(uniqueCityCount(anchorsOnly), 0);
  assert.equal(uniqueCountryCount(anchorsOnly), 0);
});

test('dedup falls back to name+country_code when no external_city_id', () => {
  const v = [
    { id: 'x1', kind: 'transit', city_name: 'Rome', country_code: 'IT' },
    { id: 'x2', kind: 'transit', city_name: 'rome', country_code: 'IT' }, // same city, different case
  ];
  assert.equal(uniqueCityCount(v), 1);
  assert.equal(uniqueCountryCount(v), 1);
});

test('transitVisits / isTransitVisit filter correctly', () => {
  assert.equal(transitVisits(VISITS).length, 4); // 4 transit rows (incl. the repeat)
  assert.equal(isTransitVisit({ kind: 'transit' }), true);
  assert.equal(isTransitVisit({ kind: 'start' }), false);
  assert.equal(isTransitVisit(null), false);
});

test('empty / invalid input -> 0', () => {
  assert.equal(uniqueCityCount([]), 0);
  assert.equal(uniqueCityCount(undefined), 0);
  assert.equal(uniqueCountryCount(null), 0);
});
