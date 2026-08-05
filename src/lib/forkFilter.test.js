// Unit tests for the shared fork-list filter engine. Run: npm test (node --test)
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { BASE_FORK_FILTERS, applyForkFilters, byNumberAsc, byNumberDesc } from './forkFilter.js';

// A minimal two-field list: text from `name`, price from `cost`, one boolean flag.
const SPEC = {
  text: (x) => `${x.name || ''} ${x.note || ''}`,
  price: (x) => (typeof x.cost === 'number' ? x.cost : null),
  flags: { onlyFree: (x) => !!x.free },
  sorts: {
    price: byNumberAsc((x) => x.cost),
    rank: byNumberDesc((x) => x.rank),
  },
};

const POOL = [
  { name: 'Alpha', note: 'city centre', cost: 50, rank: 10, free: true },
  { name: 'Beta', note: 'near the port', cost: 10, rank: 30, free: false },
  { name: 'Gamma', note: 'ALPHA district', cost: null, rank: 20, free: true },
];

test('base filters are a no-op: every item survives, order preserved', () => {
  const out = applyForkFilters(POOL, BASE_FORK_FILTERS, SPEC);
  assert.deepEqual(out.map((x) => x.name), ['Alpha', 'Beta', 'Gamma']);
});

// The regression guard for TRIP-293: "reset" restores BASE_*_FILTERS wholesale,
// so a filter key that is missing from the base would stay active after a reset.
// Any list's base must therefore filter nothing out.
test('base filters leave the pool untouched even when every knob has a value slot', () => {
  const base = { ...BASE_FORK_FILTERS, onlyFree: false };
  assert.equal(applyForkFilters(POOL, base, SPEC).length, POOL.length);
});

test('text spans every field of spec.text, case-insensitive, trimmed', () => {
  assert.deepEqual(applyForkFilters(POOL, { text: '  ALPHA ' }, SPEC).map((x) => x.name), ['Alpha', 'Gamma']);
  assert.deepEqual(applyForkFilters(POOL, { text: 'port' }, SPEC).map((x) => x.name), ['Beta']);
  assert.equal(applyForkFilters(POOL, { text: 'nothing here' }, SPEC).length, 0);
});

test('price bounds apply in both directions; items without a price hide while filtering', () => {
  assert.deepEqual(applyForkFilters(POOL, { min: 20 }, SPEC).map((x) => x.name), ['Alpha']);
  assert.deepEqual(applyForkFilters(POOL, { max: 20 }, SPEC).map((x) => x.name), ['Beta']);
  assert.deepEqual(applyForkFilters(POOL, { min: 10, max: 50 }, SPEC).map((x) => x.name), ['Alpha', 'Beta']);
  // Gamma (cost: null) is only visible while NO price bound is set.
  assert.ok(applyForkFilters(POOL, {}, SPEC).some((x) => x.name === 'Gamma'));
});

test('boolean flags filter only when switched on', () => {
  assert.deepEqual(applyForkFilters(POOL, { onlyFree: true }, SPEC).map((x) => x.name), ['Alpha', 'Gamma']);
  assert.equal(applyForkFilters(POOL, { onlyFree: false }, SPEC).length, 3);
});

test('filters combine (text AND flag AND price)', () => {
  assert.deepEqual(
    applyForkFilters(POOL, { text: 'alpha', onlyFree: true, max: 60 }, SPEC).map((x) => x.name),
    ['Alpha'], // Gamma matches text+flag but has no price
  );
});

test('sort: unknown key and "recommended" keep pool order; comparators put unknowns last', () => {
  assert.deepEqual(applyForkFilters(POOL, { sortBy: 'recommended' }, SPEC).map((x) => x.name), ['Alpha', 'Beta', 'Gamma']);
  assert.deepEqual(applyForkFilters(POOL, { sortBy: 'nope' }, SPEC).map((x) => x.name), ['Alpha', 'Beta', 'Gamma']);
  assert.deepEqual(applyForkFilters(POOL, { sortBy: 'price' }, SPEC).map((x) => x.name), ['Beta', 'Alpha', 'Gamma']);
  assert.deepEqual(applyForkFilters(POOL, { sortBy: 'rank' }, SPEC).map((x) => x.name), ['Beta', 'Gamma', 'Alpha']);
});

test('sort is stable and NaN-free when several items have no value at all', () => {
  const blanks = [{ name: 'X' }, { name: 'Y' }, { name: 'Z', cost: 5, rank: 5 }];
  assert.deepEqual(applyForkFilters(blanks, { sortBy: 'price' }, SPEC).map((x) => x.name), ['Z', 'X', 'Y']);
  assert.deepEqual(applyForkFilters(blanks, { sortBy: 'rank' }, SPEC).map((x) => x.name), ['Z', 'X', 'Y']);
});

test('input array is never mutated', () => {
  const snapshot = POOL.map((x) => x.name);
  applyForkFilters(POOL, { sortBy: 'price' }, SPEC);
  assert.deepEqual(POOL.map((x) => x.name), snapshot);
});

test('empty / garbage input is safe', () => {
  assert.deepEqual(applyForkFilters(null, { text: 'x' }, SPEC), []);
  assert.deepEqual(applyForkFilters(undefined, undefined, undefined), []);
  assert.equal(applyForkFilters(POOL, undefined, {}).length, 3); // no spec → nothing to filter on
});
