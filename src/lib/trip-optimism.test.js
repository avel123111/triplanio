// Tests for the canonical optimistic-mutation seam (optimism epic, Stage 0):
// withOptimism (the useMutation lifecycle) + swapOptimisticRow (reconcile-from-row).
//
// The whole point of the seam is a set of behaviours that every hand-rolled copy
// got subtly wrong. Each is pinned here, and the load-bearing one — cancelQueries
// BEFORE the optimistic patch — has its own guard so the flicker bug can't return
// silently. No React, no Supabase: withOptimism is a pure options builder over a
// query client, so a tiny fake client is all it needs.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  withOptimism,
  swapOptimisticRow,
  TRIP_CONTENT_KEY,
  TRIP_SHELL_KEY,
} from './trip-data.js';

const k = (key) => JSON.stringify(key);

// Minimal QueryClient stand-in: a keyed store + the three methods the seam uses.
// Records cancelQueries calls (in order) so a test can prove cancel-before-patch.
function makeQC(seed = {}) {
  const store = new Map(Object.entries(seed).map(([key, val]) => [key, val]));
  const events = [];
  return {
    events,
    get: (key) => store.get(k(key)),
    async cancelQueries({ queryKey }) { events.push(`cancel:${k(queryKey)}`); },
    getQueryData: (key) => store.get(k(key)),
    setQueryData: (key, updater) => {
      events.push(`set:${k(key)}`);
      const prev = store.get(k(key));
      store.set(k(key), typeof updater === 'function' ? updater(prev) : updater);
    },
  };
}

const TRIP = 't1';
const CONTENT = TRIP_CONTENT_KEY(TRIP);
const SHELL = TRIP_SHELL_KEY(TRIP);

test('add: optimistic tmp row appears, then reconciles to the returned real row', async () => {
  const qc = makeQC({ [k(CONTENT)]: { hotels: [{ id: 'h1' }] } });
  const life = withOptimism(qc, { tripId: TRIP, kind: 'hotels', op: 'add' });

  const ctx = await life.onMutate({ row: { id: 'tmp-x', name: 'Hilton' } });
  assert.deepEqual(qc.get(CONTENT).hotels.map(r => r.id), ['h1', 'tmp-x'], 'tmp row shown immediately');

  life.onSuccess([{ id: 'real-9', name: 'Hilton' }], { row: { id: 'tmp-x' } }, ctx);
  assert.deepEqual(qc.get(CONTENT).hotels.map(r => r.id), ['h1', 'real-9'], 'tmp swapped for real id in place');
});

test('add: cancelQueries runs BEFORE the optimistic patch (flicker guard)', async () => {
  const qc = makeQC({ [k(CONTENT)]: { hotels: [] } });
  const life = withOptimism(qc, { tripId: TRIP, kind: 'hotels', op: 'add' });

  await life.onMutate({ row: { id: 'tmp-x' } });

  const cancelIdx = qc.events.indexOf(`cancel:${k(CONTENT)}`);
  const setIdx = qc.events.indexOf(`set:${k(CONTENT)}`);
  assert.ok(cancelIdx >= 0, 'cancelQueries was called for the content key');
  assert.ok(setIdx >= 0 && cancelIdx < setIdx, 'cancel happens before the cache is patched');
});

test('add: onError restores the pre-mutation snapshot and calls the caller toast', async () => {
  const qc = makeQC({ [k(CONTENT)]: { hotels: [{ id: 'h1' }] } });
  let toasted = null;
  const life = withOptimism(qc, { tripId: TRIP, kind: 'hotels', op: 'add', onError: (e) => { toasted = e; } });

  const ctx = await life.onMutate({ row: { id: 'tmp-x' } });
  assert.equal(qc.get(CONTENT).hotels.length, 2, 'tmp row present while in flight');

  const err = new Error('write_rejected');
  life.onError(err, { row: { id: 'tmp-x' } }, ctx);
  assert.deepEqual(qc.get(CONTENT).hotels.map(r => r.id), ['h1'], 'rolled back to the snapshot, tmp gone');
  assert.equal(toasted, err, 'the error reached the call-site toast');
});

test('update: optimistic partial patch, then authoritative merge from the returned row', async () => {
  const qc = makeQC({ [k(CONTENT)]: { activities: [{ id: 'a1', title: 'Old', notes: 'keep' }] } });
  const life = withOptimism(qc, { tripId: TRIP, kind: 'activities', op: 'update' });

  const ctx = await life.onMutate({ row: { id: 'a1', title: 'New' } });
  assert.equal(qc.get(CONTENT).activities[0].title, 'New', 'optimistic field applied');
  assert.equal(qc.get(CONTENT).activities[0].notes, 'keep', 'untouched fields preserved (partial patch)');

  life.onSuccess([{ id: 'a1', title: 'New', notes: 'keep', server_stamp: 42 }], { row: { id: 'a1' } }, ctx);
  assert.equal(qc.get(CONTENT).activities[0].server_stamp, 42, 'server-authoritative row merged in');
});

test('remove: drops the row on mutate, restores it on error, no reconcile on success', async () => {
  const qc = makeQC({ [k(CONTENT)]: { services: [{ id: 's1' }, { id: 's2' }] } });
  const life = withOptimism(qc, { tripId: TRIP, kind: 'services', op: 'remove' });

  const ctx = await life.onMutate({ id: 's1' });
  assert.deepEqual(qc.get(CONTENT).services.map(r => r.id), ['s2'], 'row removed optimistically');

  // Success path must NOT touch the cache again (nothing to reconcile on a delete).
  const before = qc.events.length;
  life.onSuccess([], { id: 's1' }, ctx);
  assert.equal(qc.events.length, before, 'no cache writes on delete success');

  life.onError(new Error('boom'), { id: 's1' }, ctx);
  assert.deepEqual(qc.get(CONTENT).services.map(r => r.id), ['s1', 's2'], 'delete rolled back');
});

test('cityVisits: mutation touches AND rolls back both content and shell', async () => {
  const qc = makeQC({
    [k(CONTENT)]: { cityVisits: [{ id: 'c1' }] },
    [k(SHELL)]: { cityVisits: [{ id: 'c1' }] },
  });
  const life = withOptimism(qc, { tripId: TRIP, kind: 'cityVisits', op: 'add' });

  const ctx = await life.onMutate({ row: { id: 'tmp-c' } });
  assert.equal(qc.get(CONTENT).cityVisits.length, 2, 'content got the tmp city');
  assert.equal(qc.get(SHELL).cityVisits.length, 2, 'shell got the tmp city too');
  assert.ok(qc.events.includes(`cancel:${k(SHELL)}`), 'shell refetch cancelled as well');

  life.onError(new Error('nope'), { row: { id: 'tmp-c' } }, ctx);
  assert.deepEqual(qc.get(CONTENT).cityVisits.map(r => r.id), ['c1'], 'content rolled back');
  assert.deepEqual(qc.get(SHELL).cityVisits.map(r => r.id), ['c1'], 'shell rolled back');
});

test('swapOptimisticRow: appends the real row if the tmp row was already clobbered', () => {
  const qc = makeQC({ [k(CONTENT)]: { hotels: [{ id: 'h1' }] } }); // tmp-x already gone
  swapOptimisticRow(qc, TRIP, 'hotels', 'tmp-x', { id: 'real-9' });
  assert.deepEqual(qc.get(CONTENT).hotels.map(r => r.id), ['h1', 'real-9'], 'real row not lost when tmp missing');

  // Idempotent: a second reconcile must not duplicate the real row.
  swapOptimisticRow(qc, TRIP, 'hotels', 'tmp-x', { id: 'real-9' });
  assert.deepEqual(qc.get(CONTENT).hotels.map(r => r.id), ['h1', 'real-9'], 'no duplicate on repeat');
});

test('reconcile:false leaves the optimistic row untouched on success (opt-out)', async () => {
  const qc = makeQC({ [k(CONTENT)]: { hotels: [] } });
  const life = withOptimism(qc, { tripId: TRIP, kind: 'hotels', op: 'add', reconcile: false });

  const ctx = await life.onMutate({ row: { id: 'tmp-x' } });
  life.onSuccess([{ id: 'real-9' }], { row: { id: 'tmp-x' } }, ctx);
  assert.deepEqual(qc.get(CONTENT).hotels.map(r => r.id), ['tmp-x'], 'tmp kept when reconcile is opted out');
});
