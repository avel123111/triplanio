// Unit tests for the shared fork-pool merge. Run: npm test (node --test)
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mergeById } from './forkPool.js';

const byId = { getKey: (x) => x.id };

test('dedups across pages, first occurrence wins, order preserved', () => {
  const pages = [[{ id: 'a' }, { id: 'b' }], [{ id: 'b', dupe: true }, { id: 'c' }]];
  const { items, truncated } = mergeById(pages, byId);
  assert.deepEqual(items.map((x) => x.id), ['a', 'b', 'c']);
  assert.equal(items[1].dupe, undefined); // the earlier (higher-ranked) entry is kept
  assert.equal(truncated, false);
});

test('skips still-loading (undefined) pages and key-less / null entries', () => {
  const pages = [[{ id: 'a' }], undefined, null, [null, { noId: 1 }, { id: null }, { id: 'b' }]];
  assert.deepEqual(mergeById(pages, byId).items.map((x) => x.id), ['a', 'b']);
});

test('cap keeps the first N and flags truncated', () => {
  const page = Array.from({ length: 5 }, (_, i) => ({ id: `i${i}` }));
  const { items, truncated } = mergeById([page], { ...byId, cap: 3 });
  assert.deepEqual(items.map((x) => x.id), ['i0', 'i1', 'i2']);
  assert.equal(truncated, true);
});

test('no cap given → unbounded, never truncated', () => {
  const page = Array.from({ length: 400 }, (_, i) => ({ id: `i${i}` }));
  const { items, truncated } = mergeById([page], byId);
  assert.equal(items.length, 400);
  assert.equal(truncated, false);
});

test('a key that only duplicates does not consume cap room', () => {
  const pages = [[{ id: 'a' }, { id: 'a' }, { id: 'b' }]];
  const { items, truncated } = mergeById(pages, { ...byId, cap: 2 });
  assert.deepEqual(items.map((x) => x.id), ['a', 'b']);
  assert.equal(truncated, false);
});

test('keys are compared as strings (1 and "1" are the same item)', () => {
  const { items } = mergeById([[{ id: 1 }, { id: '1' }]], byId);
  assert.equal(items.length, 1);
});

test('empty / garbage input is safe', () => {
  assert.deepEqual(mergeById(null, byId), { items: [], truncated: false });
  assert.deepEqual(mergeById([], byId), { items: [], truncated: false });
  assert.deepEqual(mergeById(undefined, undefined), { items: [], truncated: false });
});
