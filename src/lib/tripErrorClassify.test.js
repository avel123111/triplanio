import { test } from 'node:test';
import assert from 'node:assert/strict';
import { TripAuthError, statusOf, tripErrorKind, tripGateKind } from './tripErrorClassify.js';

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

// ── tripErrorKind ─────────────────────────────────────────────────────────────
test('tripErrorKind: status → screen kind', () => {
  assert.equal(tripErrorKind(null), null);
  assert.equal(tripErrorKind(new TripAuthError()), 'auth');
  assert.equal(tripErrorKind(httpErr(401)), 'auth');
  assert.equal(tripErrorKind(httpErr(403)), 'access');
  assert.equal(tripErrorKind(httpErr(404)), 'access');
  assert.equal(tripErrorKind(httpErr(500)), 'temporary');
  assert.equal(tripErrorKind(fetchErr()), 'temporary'); // network → recoverable
});

// ── tripGateKind: the offline-pause regression this fix exists for ────────────
test('tripGateKind: OFFLINE paused query with no data → temporary (NOT access)', () => {
  // This is the exact React Query state when you open a trip while offline:
  // networkMode:"online" pauses the query → it never fetches, never throws.
  assert.equal(
    tripGateKind({ isPending: true, fetchStatus: 'paused', error: undefined, hasData: false }),
    'temporary',
  );
});

test('tripGateKind: still fetching / disabled → loading', () => {
  assert.equal(tripGateKind({ isPending: true, fetchStatus: 'fetching', error: undefined, hasData: false }), 'loading');
  // disabled query (e.g. content before shell resolves): pending + idle, no data
  assert.equal(tripGateKind({ isPending: true, fetchStatus: 'idle', error: undefined, hasData: false }), 'loading');
});

test('tripGateKind: usable/cached data → ok even if a background load failed or paused', () => {
  assert.equal(tripGateKind({ isPending: false, fetchStatus: 'idle', error: undefined, hasData: true }), 'ok');
  assert.equal(tripGateKind({ isPending: false, fetchStatus: 'paused', error: fetchErr(), hasData: true }), 'ok');
});

test('tripGateKind: auth error wins even over cached data (dead session must redirect)', () => {
  assert.equal(tripGateKind({ isPending: false, fetchStatus: 'idle', error: new TripAuthError(), hasData: true }), 'auth');
  assert.equal(tripGateKind({ isPending: false, fetchStatus: 'idle', error: httpErr(401), hasData: false }), 'auth');
});

test('tripGateKind: thrown access/temporary errors classify when no data', () => {
  assert.equal(tripGateKind({ isPending: false, fetchStatus: 'idle', error: httpErr(403), hasData: false }), 'access');
  assert.equal(tripGateKind({ isPending: false, fetchStatus: 'idle', error: httpErr(500), hasData: false }), 'temporary');
});

test('tripGateKind: settled with no data and no error → access (genuine empty/no-trip)', () => {
  assert.equal(tripGateKind({ isPending: false, fetchStatus: 'idle', error: undefined, hasData: false }), 'access');
});
