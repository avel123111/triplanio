// Unit tests for the single source of truth for city/country counting.
// Run: npm test  (node --test)
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { uniqueCityCount, uniqueCountryCount, uniqueCountryCodes, transitVisits, isTransitVisit, uniqueTransitCities, cityLabel, localizeVisits, transitSpan } from './trip-cities.js';

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

test('uniqueCountryCodes: lowercase ISO, first-occurrence order, transit only', () => {
  // Ряд флагов карточки трипа. DE живёт только на якорях, ES — на waypoint'е
  // Badajoz И на транзитном Мадриде: waypoint не должен «протаскивать» страну
  // вперёд, поэтому порядок PT → ES (по первому ТРАНЗИТНОМУ городу).
  assert.deepEqual(uniqueCountryCodes(VISITS), ['pt', 'es']);
});

test('uniqueCountryCodes: same set as the country COUNT, empty input safe', () => {
  assert.equal(uniqueCountryCodes(VISITS).length, uniqueCountryCount(VISITS));
  assert.deepEqual(uniqueCountryCodes([]), []);
  assert.deepEqual(uniqueCountryCodes(null), []);
  // Регистр/пробелы кода — одна страна, один флаг (файл флага lowercase).
  assert.deepEqual(uniqueCountryCodes([
    { kind: 'transit', city_name: 'Madrid',    country_code: 'ES', external_city_id: 'es-madrid' },
    { kind: 'transit', city_name: 'Barcelona', country_code: ' es ', external_city_id: 'es-bcn' },
    { kind: 'transit', city_name: 'Nowhere',   country_code: '',   external_city_id: 'x' },
  ]), ['es']);
});

test('counts ignore anchors/waypoints entirely', () => {
  const anchorsOnly = VISITS.filter((v) => v.kind !== 'transit');
  assert.equal(uniqueCityCount(anchorsOnly), 0);
  assert.equal(uniqueCountryCount(anchorsOnly), 0);
});

test('same city + country with DIFFERENT external_city_id counts once', () => {
  // Real prod case (trip b40704dd): Moscow entered twice, two different
  // external ids. By "city + country" it is one city — header and trips card
  // must agree.
  const v = [
    { id: 'm1', kind: 'transit', city_name_en: 'Moscow', country_code: 'RU', external_city_id: '195713348' },
    { id: 'm2', kind: 'transit', city_name_en: 'Moscow', country_code: 'RU', external_city_id: '196017222' },
  ];
  assert.equal(uniqueCityCount(v), 1);
  assert.equal(uniqueTransitCities(v).length, 1);
  assert.equal(uniqueCountryCount(v), 1);
});

test('uniqueTransitCities backs both count and label from one set', () => {
  const reps = uniqueTransitCities(VISITS);
  assert.equal(reps.length, uniqueCityCount(VISITS)); // same set drives both
  assert.deepEqual(reps.map((v) => v.city_name), ['Lisbon', 'Porto', 'Madrid']);
});

test('dedup falls back to name+country_code when no external_city_id', () => {
  const v = [
    { id: 'x1', kind: 'transit', city_name_en: 'Rome', country_code: 'IT' },
    { id: 'x2', kind: 'transit', city_name_en: 'rome', country_code: 'IT' }, // same city, different case
  ];
  assert.equal(uniqueCityCount(v), 1);
  assert.equal(uniqueCountryCount(v), 1);
});

test('geonameid is the primary identity: same geonameid counts once', () => {
  // TRIP-146: same physical city, two picks with DIFFERENT localized names and
  // external ids, but the same GeoNames id -> one city.
  const v = [
    { id: 'g1', kind: 'transit', city_name: 'Москва', country_code: 'RU', geonameid: 524901, external_city_id: '195713348' },
    { id: 'g2', kind: 'transit', city_name: 'Moscow', country_code: 'RU', geonameid: 524901, external_city_id: '196017222' },
  ];
  assert.equal(uniqueCityCount(v), 1);
  assert.equal(uniqueTransitCities(v).length, 1);
});

test('geonameid takes priority over name: different geonameid = different city', () => {
  // Two same-named cities with distinct GeoNames ids must NOT collapse.
  const v = [
    { id: 'p1', kind: 'transit', city_name: 'Springfield', country_code: 'US', geonameid: 4250542 },
    { id: 'p2', kind: 'transit', city_name: 'Springfield', country_code: 'US', geonameid: 4951788 },
  ];
  assert.equal(uniqueCityCount(v), 2);
});

test('legacy rows without geonameid still dedup by name+country', () => {
  // Mixed: a geonameid-less pair falls back to name|cc (Phase 5 backfill tail).
  const v = [
    { id: 'l1', kind: 'transit', city_name_en: 'Rome', country_code: 'IT' },
    { id: 'l2', kind: 'transit', city_name_en: 'rome', country_code: 'IT' },
  ];
  assert.equal(uniqueCityCount(v), 1);
});

test('transitVisits / isTransitVisit filter correctly', () => {
  assert.equal(transitVisits(VISITS).length, 4); // 4 transit rows (incl. the repeat)
  assert.equal(isTransitVisit({ kind: 'transit' }), true);
  assert.equal(isTransitVisit({ kind: 'start' }), false);
  assert.equal(isTransitVisit(null), false);
});

test('cityLabel: localized snapshot first, then en, then city_name_en', () => {
  const v = { name_i18n: { en: 'Moscow', es: 'Moscú', ru: 'Москва' }, city_name_en: 'Moscow' };
  assert.equal(cityLabel(v, 'ru'), 'Москва');
  assert.equal(cityLabel(v, 'es'), 'Moscú');
  assert.equal(cityLabel(v, 'en'), 'Moscow');
  assert.equal(cityLabel(v, 'de'), 'Moscow');                       // no de -> en slot
  assert.equal(cityLabel({ name_i18n: {}, city_name_en: 'Rome' }, 'ru'), 'Rome'); // empty snapshot -> en col
  // Phase 6: the dropped `city_name` column is NOT a source — an object that
  // carries ONLY a legacy city_name resolves to '' (no ghost fallback).
  assert.equal(cityLabel({ city_name: 'Ghost' }, 'ru'), '');
  assert.equal(cityLabel(null, 'en'), '');
});

test('localizeVisits: rewrites city_name from the snapshot, non-mutating', () => {
  const src = [{ id: 'a', name_i18n: { en: 'Lisbon', ru: 'Лиссабон' }, city_name: 'Lisbon' }];
  const out = localizeVisits(src, 'ru');
  assert.equal(out[0].city_name, 'Лиссабон');
  assert.equal(src[0].city_name, 'Lisbon'); // original untouched
  assert.deepEqual(localizeVisits(null, 'en'), []);
});

test('localizeVisits: empty label never overwrites an existing city_name', () => {
  // A visit with no snapshot and no city_name_en yields an empty cityLabel —
  // its existing in-memory display name must survive, not get blanked.
  const src = [{ id: 'a', city_name: 'Kept' }];
  const out = localizeVisits(src, 'ru');
  assert.equal(out[0].city_name, 'Kept');
  assert.equal(out[0], src[0]); // unchanged row returned as-is (no clone)
});

test('empty / invalid input -> 0', () => {
  assert.equal(uniqueCityCount([]), 0);
  assert.equal(uniqueCityCount(undefined), 0);
  assert.equal(uniqueCountryCount(null), 0);
});

// ── transitSpan: что показывает кнопка «старт/финиш» ──────────────────────────
// Маршрут «из дома»: старт-якорь → пересадка ПО ДОРОГЕ → Лиссабон → пересадка
// ВНУТРИ маршрута → Порту → пересадка НА ОБРАТНОМ пути → финиш-якорь.
const SPAN_ROUTE = [
  { id: 'a0', kind: 'start' },
  { id: 'w0', kind: 'waypoint' },   // до первого transit — не маршрут
  { id: 'c1', kind: 'transit' },
  { id: 'w1', kind: 'waypoint' },   // внутри маршрута — часть его
  { id: 'c2', kind: 'transit' },
  { id: 'w2', kind: 'waypoint' },   // после последнего transit — не маршрут
  { id: 'a1', kind: 'end' },
];

test('transitSpan: отрезок от первого transit до последнего включительно', () => {
  assert.deepEqual(transitSpan(SPAN_ROUTE).map((v) => v.id), ['c1', 'w1', 'c2']);
});

test('transitSpan: якоря и внешние waypoint отрезаны с обеих сторон', () => {
  const ids = transitSpan(SPAN_ROUTE).map((v) => v.id);
  assert.equal(ids.includes('a0'), false);
  assert.equal(ids.includes('a1'), false);
  assert.equal(ids.includes('w0'), false); // ровно этого старый фильтр не делал
  assert.equal(ids.includes('w2'), false);
});

test('transitSpan: один город — сам себе отрезок', () => {
  const one = [{ id: 'a0', kind: 'start' }, { id: 'c1', kind: 'transit' }, { id: 'a1', kind: 'end' }];
  assert.deepEqual(transitSpan(one).map((v) => v.id), ['c1']);
});

test('transitSpan: без transit показывать нечего', () => {
  assert.deepEqual(transitSpan([{ id: 'a0', kind: 'start' }, { id: 'w0', kind: 'waypoint' }]), []);
  assert.deepEqual(transitSpan([]), []);
  assert.deepEqual(transitSpan(null), []);
});

test('transitSpan: не мутирует вход', () => {
  const src = SPAN_ROUTE.slice();
  transitSpan(src);
  assert.equal(src.length, SPAN_ROUTE.length);
});
