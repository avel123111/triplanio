import { test } from 'node:test';
import assert from 'node:assert/strict';
import { statusOf, loadErrorKind, queryGateKind } from './loadStateClassify.js';

// supabase-js shapes: FunctionsHttpError carries the Response as `.context`
// (so `.context.status` is the code); FunctionsFetchError (network/offline)
// carries the raw fetch error → no `.context.status`.
const httpErr = (status) => Object.assign(new Error('http'), { context: { status } });
const fetchErr = () => Object.assign(new Error('Failed to fetch'), { name: 'FunctionsFetchError', context: new TypeError('Failed to fetch') });

// ── statusOf ──────────────────────────────────────────────────────────────────
test('statusOf: reads numeric .context.status, else null', () => {
  assert.equal(statusOf(httpErr(403)), 403);
  assert.equal(statusOf(fetchErr()), null);
  assert.equal(statusOf(undefined), null);
});

// ── loadErrorKind ─────────────────────────────────────────────────────────────
test('loadErrorKind: status → screen kind', () => {
  assert.equal(loadErrorKind(null), null);
  assert.equal(loadErrorKind(httpErr(401)), 'auth'); // fetch-layer already retried → dead session
  assert.equal(loadErrorKind(httpErr(403)), 'access');
  assert.equal(loadErrorKind(httpErr(404)), 'access');
  assert.equal(loadErrorKind(httpErr(500)), 'temporary');
  assert.equal(loadErrorKind(fetchErr()), 'temporary'); // network → recoverable
});

// ── queryGateKind: the offline-pause regression this fix exists for ───────────
test('queryGateKind: OFFLINE paused query with no data → temporary (NOT access)', () => {
  // This is the exact React Query state when you open a screen while offline:
  // networkMode:"online" pauses the query → it never fetches, never throws.
  assert.equal(
    queryGateKind({ isPending: true, fetchStatus: 'paused', error: undefined, hasData: false }),
    'temporary',
  );
});

test('queryGateKind: still fetching / disabled → loading', () => {
  assert.equal(queryGateKind({ isPending: true, fetchStatus: 'fetching', error: undefined, hasData: false }), 'loading');
  // disabled query (e.g. content before shell resolves): pending + idle, no data
  assert.equal(queryGateKind({ isPending: true, fetchStatus: 'idle', error: undefined, hasData: false }), 'loading');
});

test('queryGateKind: usable/cached data → ok even if a background load failed or paused', () => {
  assert.equal(queryGateKind({ isPending: false, fetchStatus: 'idle', error: undefined, hasData: true }), 'ok');
  assert.equal(queryGateKind({ isPending: false, fetchStatus: 'paused', error: fetchErr(), hasData: true }), 'ok');
});

test('queryGateKind: auth error wins even over cached data (dead session must redirect)', () => {
  assert.equal(queryGateKind({ isPending: false, fetchStatus: 'idle', error: httpErr(401), hasData: true }), 'auth');
  assert.equal(queryGateKind({ isPending: false, fetchStatus: 'idle', error: httpErr(401), hasData: false }), 'auth');
});

test('queryGateKind: thrown access/temporary errors classify when no data', () => {
  assert.equal(queryGateKind({ isPending: false, fetchStatus: 'idle', error: httpErr(403), hasData: false }), 'access');
  assert.equal(queryGateKind({ isPending: false, fetchStatus: 'idle', error: httpErr(500), hasData: false }), 'temporary');
});

test('queryGateKind: settled with no data and no error → access (genuine empty/no-trip)', () => {
  assert.equal(queryGateKind({ isPending: false, fetchStatus: 'idle', error: undefined, hasData: false }), 'access');
});
