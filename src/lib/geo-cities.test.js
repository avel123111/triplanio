// Unit tests for the city-shaping helpers behind resolveCities (TRIP-214).
// Run: npm test  (node --test)
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mapGazCity, buildResolvePayload, expandBatchRows } from './geo-cities.js';

test('mapGazCity: name_i18n snapshot drives the localized name, en fallback', () => {
  const row = {
    geonameid: 3117735, display: 'Madrid', subtitle: 'Comunidad de Madrid, España',
    country_code: 'es', lat: 40.4, lng: -3.7,
    name_i18n: { en: 'Madrid', es: 'Madrid', ru: 'Мадрид' },
  };
  const ru = mapGazCity(row, 'ru');
  assert.equal(ru.city_name, 'Мадрид');
  assert.equal(ru.city_name_en, 'Madrid');
  assert.equal(ru.external_city_id, '3117735');
  assert.equal(ru.country_code, 'ES'); // upper-cased
  assert.equal(ru.country, null);      // never carried
  assert.equal(ru.latitude, 40.4);
  assert.equal(ru.display_name, 'Comunidad de Madrid, España');
});

test('mapGazCity: missing name_i18n falls back to display', () => {
  const c = mapGazCity({ geonameid: 1, display: 'Foo', country_code: 'fr', lat: 1, lng: 2 }, 'ru');
  assert.equal(c.city_name, 'Foo');
  assert.equal(c.city_name_en, 'Foo');
});

test('buildResolvePayload: object → English query + cc filter', () => {
  const p = buildResolvePayload(
    [{ city_name: 'Рим', city_name_en: 'Rome', country_code: 'it' }],
    'ru',
  );
  assert.deepEqual(p, [{ q: 'Rome', cc: 'IT', lang: 'en' }]);
});

test('buildResolvePayload: object without English name → app-locale query, no cc', () => {
  const p = buildResolvePayload([{ city_name: 'Барселона' }], 'ru');
  assert.deepEqual(p, [{ q: 'Барселона', cc: '', lang: 'ru' }]);
});

test('buildResolvePayload: plain string → free-text query in app locale', () => {
  assert.deepEqual(buildResolvePayload(['Porto, PT'], 'es'), [{ q: 'Porto, PT', cc: '', lang: 'es' }]);
});

test('expandBatchRows: 1-based ord maps to aligned 0-based slots', () => {
  // Input of 3 items; RPC returned best for ord 1 and 3, ord 2 had no match.
  const rows = [
    { ord: 1, geonameid: 11, display: 'A', country_code: 'us', lat: 1, lng: 1, name_i18n: { en: 'A' } },
    { ord: 3, geonameid: 33, display: 'C', country_code: 'de', lat: 3, lng: 3, name_i18n: { en: 'C' } },
  ];
  const out = expandBatchRows(rows, 3, 'en');
  assert.equal(out.length, 3);
  assert.equal(out[0][0].geonameid, 11);
  assert.deepEqual(out[1], []);           // unmatched input → empty list
  assert.equal(out[2][0].geonameid, 33);
});

test('expandBatchRows: out-of-range ord is ignored, null rows → all empty', () => {
  assert.deepEqual(expandBatchRows([{ ord: 9, geonameid: 1 }], 2, 'en'), [[], []]);
  assert.deepEqual(expandBatchRows(null, 2, 'en'), [[], []]);
});
