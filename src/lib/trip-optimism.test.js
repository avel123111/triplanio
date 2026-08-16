// Tests for the canonical optimistic-mutation seam (optimism epic).
//   withOptimism   — the useMutation lifecycle (cancel → snapshot → patch →
//                    reconcile-from-row → rollback), toast hooks
//   tripContentBinding — binding for the {kind:[...]} trip-content cache
//   listBinding    — binding for a bare-array cache at one key (documents, …)
//
// The whole point of the seam is a set of behaviours every hand-rolled copy got
// subtly wrong. Each is pinned here, and the load-bearing one — cancelQueries
// BEFORE the optimistic patch — has its own guard so the flicker bug can't come
// back silently. No React, no Supabase: the seam is a pure options builder over
// a query client, so a tiny fake client is all it needs.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  withOptimism,
  runOptimism,
  tripContentBinding,
  listBinding,
  swapOptimisticRow,
  TRIP_CONTENT_KEY,
  TRIP_SHELL_KEY,
} from './trip-data.js';

const k = (key) => JSON.stringify(key);

// Minimal QueryClient stand-in: a keyed store + the methods the seam uses.
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
const DOCS = ['trip-docs', TRIP];

// ─── trip-content binding ─────────────────────────────────────────────────────

test('trip-content add: tmp row appears, then reconciles to the returned real row', async () => {
  const qc = makeQC({ [k(CONTENT)]: { hotels: [{ id: 'h1' }] } });
  const life = withOptimism(tripContentBinding(qc, TRIP, 'hotels'), { op: 'add' });

  const ctx = await life.onMutate({ row: { id: 'tmp-x', name: 'Hilton' } });
  assert.deepEqual(qc.get(CONTENT).hotels.map(r => r.id), ['h1', 'tmp-x'], 'tmp row shown immediately');

  life.onSuccess([{ id: 'real-9', name: 'Hilton' }], { row: { id: 'tmp-x' } }, ctx);
  assert.deepEqual(qc.get(CONTENT).hotels.map(r => r.id), ['h1', 'real-9'], 'tmp swapped for real id in place');
});

test('cancelQueries runs BEFORE the optimistic patch (flicker guard)', async () => {
  const qc = makeQC({ [k(CONTENT)]: { hotels: [] } });
  const life = withOptimism(tripContentBinding(qc, TRIP, 'hotels'), { op: 'add' });

  await life.onMutate({ row: { id: 'tmp-x' } });

  const cancelIdx = qc.events.indexOf(`cancel:${k(CONTENT)}`);
  const setIdx = qc.events.indexOf(`set:${k(CONTENT)}`);
  assert.ok(cancelIdx >= 0, 'cancelQueries was called for the content key');
  assert.ok(setIdx >= 0 && cancelIdx < setIdx, 'cancel happens before the cache is patched');
});

test('trip-content add: onError restores the snapshot and calls the caller toast', async () => {
  const qc = makeQC({ [k(CONTENT)]: { hotels: [{ id: 'h1' }] } });
  let toasted = null;
  const life = withOptimism(tripContentBinding(qc, TRIP, 'hotels'), { op: 'add', onError: (e) => { toasted = e; } });

  const ctx = await life.onMutate({ row: { id: 'tmp-x' } });
  assert.equal(qc.get(CONTENT).hotels.length, 2, 'tmp row present while in flight');

  const err = new Error('write_rejected');
  life.onError(err, { row: { id: 'tmp-x' } }, ctx);
  assert.deepEqual(qc.get(CONTENT).hotels.map(r => r.id), ['h1'], 'rolled back to the snapshot, tmp gone');
  assert.equal(toasted, err, 'the error reached the call-site toast');
});

test('update: optimistic partial patch, then authoritative merge from the returned row', async () => {
  const qc = makeQC({ [k(CONTENT)]: { activities: [{ id: 'a1', title: 'Old', notes: 'keep' }] } });
  const life = withOptimism(tripContentBinding(qc, TRIP, 'activities'), { op: 'update' });

  const ctx = await life.onMutate({ row: { id: 'a1', title: 'New' } });
  assert.equal(qc.get(CONTENT).activities[0].title, 'New', 'optimistic field applied');
  assert.equal(qc.get(CONTENT).activities[0].notes, 'keep', 'untouched fields preserved (partial patch)');

  life.onSuccess([{ id: 'a1', title: 'New', notes: 'keep', server_stamp: 42 }], { row: { id: 'a1' } }, ctx);
  assert.equal(qc.get(CONTENT).activities[0].server_stamp, 42, 'server-authoritative row merged in');
});

test('remove: drops the row on mutate, restores it on error, no reconcile on success', async () => {
  const qc = makeQC({ [k(CONTENT)]: { services: [{ id: 's1' }, { id: 's2' }] } });
  const life = withOptimism(tripContentBinding(qc, TRIP, 'services'), { op: 'remove' });

  const ctx = await life.onMutate({ id: 's1' });
  assert.deepEqual(qc.get(CONTENT).services.map(r => r.id), ['s2'], 'row removed optimistically');

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
  const life = withOptimism(tripContentBinding(qc, TRIP, 'cityVisits'), { op: 'add' });

  const ctx = await life.onMutate({ row: { id: 'tmp-c' } });
  assert.equal(qc.get(CONTENT).cityVisits.length, 2, 'content got the tmp city');
  assert.equal(qc.get(SHELL).cityVisits.length, 2, 'shell got the tmp city too');
  assert.ok(qc.events.includes(`cancel:${k(SHELL)}`), 'shell refetch cancelled as well');

  life.onError(new Error('nope'), { row: { id: 'tmp-c' } }, ctx);
  assert.deepEqual(qc.get(CONTENT).cityVisits.map(r => r.id), ['c1'], 'content rolled back');
  assert.deepEqual(qc.get(SHELL).cityVisits.map(r => r.id), ['c1'], 'shell rolled back');
});

test('onSuccess hook fires with (data, vars) for the confirm toast', async () => {
  const qc = makeQC({ [k(CONTENT)]: { hotels: [] } });
  let got = null;
  const life = withOptimism(tripContentBinding(qc, TRIP, 'hotels'), {
    op: 'add', onSuccess: (data, vars) => { got = { data, vars }; },
  });
  const ctx = await life.onMutate({ row: { id: 'tmp-x' } });
  life.onSuccess([{ id: 'real-9' }], { row: { id: 'tmp-x' } }, ctx);
  assert.deepEqual(got.data, [{ id: 'real-9' }], 'success toast hook saw the returned row');
  assert.equal(got.vars.row.id, 'tmp-x', 'success toast hook saw the vars');
});

// ─── flat-array (list) binding — the documents cache ──────────────────────────

test('list add: prepends (newest-first) then reconciles tmp→real at the top', async () => {
  const qc = makeQC({ [k(DOCS)]: [{ id: 'd1' }, { id: 'd2' }] });
  const life = withOptimism(listBinding(qc, DOCS, { addTo: 'start' }), { op: 'add' });

  const ctx = await life.onMutate({ row: { id: 'tmp-x', title: 'Booking' } });
  assert.deepEqual(qc.get(DOCS).map(r => r.id), ['tmp-x', 'd1', 'd2'], 'new doc prepended');

  life.onSuccess([{ id: 'real-9', title: 'Booking' }], { row: { id: 'tmp-x' } }, ctx);
  assert.deepEqual(qc.get(DOCS).map(r => r.id), ['real-9', 'd1', 'd2'], 'tmp swapped for real at the top');
});

test('list remove: drops on mutate, restores on error', async () => {
  const qc = makeQC({ [k(DOCS)]: [{ id: 'd1' }, { id: 'd2' }] });
  let toasted = false;
  const life = withOptimism(listBinding(qc, DOCS, { addTo: 'start' }), { op: 'remove', onError: () => { toasted = true; } });

  const ctx = await life.onMutate({ id: 'd1' });
  assert.deepEqual(qc.get(DOCS).map(r => r.id), ['d2'], 'doc removed optimistically');
  assert.ok(qc.events.includes(`cancel:${k(DOCS)}`), 'docs refetch cancelled first');

  life.onError(new Error('nope'), { id: 'd1' }, ctx);
  assert.deepEqual(qc.get(DOCS).map(r => r.id), ['d1', 'd2'], 'delete rolled back');
  assert.ok(toasted, 'error toast fired');
});

test('list binding never patches a not-yet-loaded cache (old === undefined)', async () => {
  const qc = makeQC({}); // DOCS key absent → query not loaded
  const life = withOptimism(listBinding(qc, DOCS, { addTo: 'start' }), { op: 'add' });
  await life.onMutate({ row: { id: 'tmp-x' } });
  assert.equal(qc.get(DOCS), undefined, 'no phantom one-item list written before the real fetch');
});

// ─── swapOptimisticRow direct (trip-content) ──────────────────────────────────

// ─── runOptimism (imperative path, for survive-unmount create/delete) ─────────

test('runOptimism add: cancel→patch→run→reconcile, resolves the write result', async () => {
  const qc = makeQC({ [k(CONTENT)]: { hotels: [{ id: 'h1' }] } });
  let confirmed = false;
  const data = await runOptimism(tripContentBinding(qc, TRIP, 'hotels'), {
    op: 'add',
    vars: { row: { id: 'tmp-x', name: 'Hilton' } },
    run: async () => ({ id: 'real-9', name: 'Hilton' }),
    onSuccess: () => { confirmed = true; },
  });
  assert.deepEqual(qc.get(CONTENT).hotels.map(r => r.id), ['h1', 'real-9'], 'tmp swapped for the returned row');
  assert.deepEqual(data, { id: 'real-9', name: 'Hilton' }, 'resolves the write result');
  assert.ok(confirmed, 'onSuccess fired');
  const cancelIdx = qc.events.indexOf(`cancel:${k(CONTENT)}`);
  const setIdx = qc.events.indexOf(`set:${k(CONTENT)}`);
  assert.ok(cancelIdx >= 0 && cancelIdx < setIdx, 'cancel ran before the optimistic patch');
});

test('runOptimism add: run rejects → rollback + onError, and re-throws', async () => {
  const qc = makeQC({ [k(CONTENT)]: { hotels: [{ id: 'h1' }] } });
  let caught = null;
  await assert.rejects(
    runOptimism(tripContentBinding(qc, TRIP, 'hotels'), {
      op: 'add',
      vars: { row: { id: 'tmp-x' } },
      run: async () => { throw new Error('refused'); },
      onError: (e) => { caught = e; },
    }),
    /refused/,
  );
  assert.deepEqual(qc.get(CONTENT).hotels.map(r => r.id), ['h1'], 'optimistic row rolled back');
  assert.equal(caught?.message, 'refused', 'onError saw the error');
});

test('runOptimism remove: patches out on run, no reconcile on success', async () => {
  const qc = makeQC({ [k(CONTENT)]: { transfers: [{ id: 't1' }, { id: 't2' }] } });
  await runOptimism(tripContentBinding(qc, TRIP, 'transfers'), {
    op: 'remove',
    vars: { id: 't1' },
    run: async () => undefined, // delete returns nothing
  });
  assert.deepEqual(qc.get(CONTENT).transfers.map(r => r.id), ['t2'], 'row removed and stays removed');
});

test('swapOptimisticRow: appends the real row if the tmp row was already clobbered', () => {
  const qc = makeQC({ [k(CONTENT)]: { hotels: [{ id: 'h1' }] } }); // tmp-x already gone
  swapOptimisticRow(qc, TRIP, 'hotels', 'tmp-x', { id: 'real-9' });
  assert.deepEqual(qc.get(CONTENT).hotels.map(r => r.id), ['h1', 'real-9'], 'real row not lost when tmp missing');

  swapOptimisticRow(qc, TRIP, 'hotels', 'tmp-x', { id: 'real-9' }); // idempotent
  assert.deepEqual(qc.get(CONTENT).hotels.map(r => r.id), ['h1', 'real-9'], 'no duplicate on repeat');
});
