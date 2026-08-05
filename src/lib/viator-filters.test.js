// Unit tests for the Viator activity filter contract. Run: npm test (node --test)
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { applyForkFilters } from './forkFilter.js';
import { BASE_ACTIVITY_FILTERS, VIATOR_FILTER_SPEC, applyActivityFilters } from './viator-filters.js';

const POOL = [
  { code: 'a1', title: 'Sagrada Familia skip-the-line', desc: 'Guided tour', fromPrice: 45, reviewCount: 1200, freeCancellation: true },
  { code: 'a2', title: 'Park Güell ticket', desc: 'Entry to the monumental zone', fromPrice: 18, reviewCount: 300, freeCancellation: false },
  { code: 'a3', title: 'Flamenco show', desc: 'Evening at a tablao in the gothic quarter', fromPrice: null, reviewCount: null, freeCancellation: true },
];

test('base filters show the whole pool in Viator relevance order', () => {
  assert.deepEqual(applyActivityFilters(POOL, BASE_ACTIVITY_FILTERS).map((a) => a.code), ['a1', 'a2', 'a3']);
});

// TRIP-293: the no-match state's "Сбросить" resets to BASE_ACTIVITY_FILTERS. If a
// knob the list filters on were missing from the base, reset would leave it active
// and the button would look dead — which is exactly the bug this test locks down.
test('BASE_ACTIVITY_FILTERS carries a cleared slot for every knob the spec reads', () => {
  const knobs = ['text', 'min', 'max', 'sortBy', ...Object.keys(VIATOR_FILTER_SPEC.flags)];
  for (const k of knobs) assert.ok(k in BASE_ACTIVITY_FILTERS, `missing "${k}" in BASE_ACTIVITY_FILTERS`);
  // …and the base must actually be neutral, not just present.
  const active = { text: 'flamenco', min: 20, max: 50, sortBy: 'price', freeCancel: true };
  assert.ok(applyActivityFilters(POOL, active).length < POOL.length, 'fixture must be filterable');
  assert.equal(applyActivityFilters(POOL, { ...active, ...BASE_ACTIVITY_FILTERS }).length, POOL.length);
});

test('text search spans title + description', () => {
  assert.deepEqual(applyActivityFilters(POOL, { text: 'sagrada' }).map((a) => a.code), ['a1']);
  assert.deepEqual(applyActivityFilters(POOL, { text: 'gothic' }).map((a) => a.code), ['a3']); // desc only
  assert.equal(applyActivityFilters(POOL, { text: 'kayak' }).length, 0);
});

test('price bounds read fromPrice; activities without a price hide while filtering', () => {
  assert.deepEqual(applyActivityFilters(POOL, { min: 20 }).map((a) => a.code), ['a1']);
  assert.deepEqual(applyActivityFilters(POOL, { max: 20 }).map((a) => a.code), ['a2']);
  assert.ok(!applyActivityFilters(POOL, { min: 1 }).some((a) => a.code === 'a3'));
});

test('freeCancel keeps only free-cancellation activities, and only when on', () => {
  assert.deepEqual(applyActivityFilters(POOL, { freeCancel: true }).map((a) => a.code), ['a1', 'a3']);
  assert.equal(applyActivityFilters(POOL, { freeCancel: false }).length, 3);
});

test('sort price ↑ / reviews ↓ (unknowns last); recommended keeps pool order', () => {
  assert.deepEqual(applyActivityFilters(POOL, { sortBy: 'price' }).map((a) => a.code), ['a2', 'a1', 'a3']);
  assert.deepEqual(applyActivityFilters(POOL, { sortBy: 'reviews' }).map((a) => a.code), ['a1', 'a2', 'a3']);
  assert.deepEqual(applyActivityFilters(POOL, { sortBy: 'recommended' }).map((a) => a.code), ['a1', 'a2', 'a3']);
});

test('applyActivityFilters is applyForkFilters bound to the Viator spec', () => {
  const f = { text: 'a', freeCancel: true, sortBy: 'price' };
  assert.deepEqual(applyActivityFilters(POOL, f), applyForkFilters(POOL, f, VIATOR_FILTER_SPEC));
});

test('empty / garbage input is safe', () => {
  assert.deepEqual(applyActivityFilters(null, { text: 'x' }), []);
  assert.deepEqual(applyActivityFilters(undefined, undefined), []);
  assert.equal(applyActivityFilters([{ code: 'x' }], BASE_ACTIVITY_FILTERS).length, 1);
});
