// Unit tests for the writeRows primitive (TRIP-66).
// Run: npm test  (node --test)
//
// writeRows is the single contract "did the write actually land?". A raw
// supabase mutation swallows both a real { error } and a silent 0-row RLS
// reject; these tests lock the behaviour so a future refactor can't quietly
// bring the swallow back.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { writeRows } from './trip-data.js';

// Minimal fake of a PostgREST builder: writeRows only calls `.select()`, which
// resolves to `{ data, error }`. `.select()` returns the builder-as-thenable.
function fakeBuilder({ data = null, error = null } = {}) {
  return { select: () => Promise.resolve({ data, error }) };
}

test('resolves with rows on a successful write', async () => {
  const rows = await writeRows(fakeBuilder({ data: [{ id: 'a' }] }));
  assert.deepEqual(rows, [{ id: 'a' }]);
});

test('throws the original error when the builder returns { error }', async () => {
  const err = new Error('network down');
  await assert.rejects(
    () => writeRows(fakeBuilder({ error: err })),
    (e) => e === err,
  );
});

test('insert/update: 0 affected rows is a silent RLS reject → throws write_rejected', async () => {
  // expectRow defaults to true. Empty array = PostgREST hid the row (expired
  // session / removed from trip). Must NOT look like success.
  await assert.rejects(
    () => writeRows(fakeBuilder({ data: [] })),
    (e) => e.message === 'write_rejected',
  );
  await assert.rejects(
    () => writeRows(fakeBuilder({ data: null })),
    (e) => e.message === 'write_rejected',
  );
});

test('delete (expectRow:false): 0 affected rows is benign → resolves, no throw', async () => {
  // A row already deleted by another member is not an error for a delete.
  const rows = await writeRows(fakeBuilder({ data: [] }), { expectRow: false });
  assert.deepEqual(rows, []);
});

test('delete (expectRow:false): still throws on a real error', async () => {
  const err = new Error('boom');
  await assert.rejects(
    () => writeRows(fakeBuilder({ error: err }), { expectRow: false }),
    (e) => e === err,
  );
});
