import { test } from 'node:test';
import assert from 'node:assert/strict';
import { statusOf, loadErrorKind, queryGateKind, gateStubProps } from './loadStateClassify.js';

// supabase-js shapes: FunctionsHttpError carries the Response as `.context`
// (so `.context.status` is the code); FunctionsFetchError (network/offline)
// carries the raw fetch error → no `.context.status`.
const httpErr = (status) => Object.assign(new Error('http'), { context: { status } });
const fetchErr = () => Object.assign(new Error('Failed to fetch'), { name: 'FunctionsFetchError', context: new TypeError('Failed to fetch') });
// PostgREST direct-call shapes (.from()/.rpc()): PostgrestError carries a `.code`
// (SQLSTATE / PostgREST code) and NO `.context`. Auth/Storage carry `.status`.
const pgErr = (code) => Object.assign(new Error('pg'), { code, details: null, hint: null });
const statusErr = (status) => Object.assign(new Error('auth'), { status });

// ── statusOf ──────────────────────────────────────────────────────────────────
test('statusOf: reads numeric .context.status, else null', () => {
  assert.equal(statusOf(httpErr(403)), 403);
  assert.equal(statusOf(fetchErr()), null);
  assert.equal(statusOf(undefined), null);
});

test('statusOf: transport-agnostic — PostgREST codes + direct .status (TRIP-208)', () => {
  // RLS deny from a direct REST call must resolve to 403 (was null → mis-classified
  // as "temporary" before TRIP-208).
  assert.equal(statusOf(pgErr('42501')), 403);
  assert.equal(statusOf(pgErr('PGRST301')), 401); // JWT expired
  assert.equal(statusOf(pgErr('PGRST302')), 401); // anonymous/invalid JWT
  assert.equal(statusOf(statusErr(401)), 401);     // AuthError-style numeric status
  assert.equal(statusOf(statusErr(403)), 403);
});

// Full error-class matrix (TRIP-208 re-analysis): the code space is NOT binary.
// Every class must resolve to its own status, including the permanent-non-retryable
// ones (bad input) that Ф1 mis-bucketed as transient.
test('statusOf: permanent "not found" codes → 404 (incl. the 22P02 that Ф1 missed)', () => {
  assert.equal(statusOf(pgErr('PGRST116')), 404); // no rows on direct .single()
  assert.equal(statusOf(pgErr('22P02')), 404);    // invalid uuid/int/enum text — the reported bug
  assert.equal(statusOf(pgErr('22003')), 404);    // numeric out of range
  assert.equal(statusOf(pgErr('22007')), 404);    // invalid datetime format
});

test('statusOf: genuinely transient / our-bug codes stay null → temporary', () => {
  assert.equal(statusOf(pgErr('57014')), null); // statement timeout → retry
  assert.equal(statusOf(pgErr('40001')), null); // serialization failure/deadlock → retry
  assert.equal(statusOf(pgErr('53300')), null); // too many connections → retry
  assert.equal(statusOf(pgErr('42P01')), null); // undefined_table (our bug) → temporary + Sentry
  assert.equal(statusOf(pgErr('23505')), null); // unique_violation (write-path) → temporary here
});

test('loadErrorKind: direct PostgREST classifies like edge, per class (TRIP-208)', () => {
  assert.equal(loadErrorKind(pgErr('42501')), 'access');      // RLS deny → no-access screen
  assert.equal(loadErrorKind(pgErr('PGRST301')), 'auth');     // dead session → login
  assert.equal(loadErrorKind(pgErr('PGRST116')), 'not_found'); // no such row → not found
  assert.equal(loadErrorKind(pgErr('22P02')), 'not_found');   // bad id → not found, NOT "temporary"
  assert.equal(loadErrorKind(pgErr('57014')), 'temporary');   // timeout → retry
});

// ── loadErrorKind ─────────────────────────────────────────────────────────────
test('loadErrorKind: status → screen kind (404 and 403 are split)', () => {
  assert.equal(loadErrorKind(null), null);
  assert.equal(loadErrorKind(httpErr(401)), 'auth'); // fetch-layer already retried → dead session
  assert.equal(loadErrorKind(httpErr(403)), 'access');    // permission wall
  assert.equal(loadErrorKind(httpErr(404)), 'not_found'); // missing / broken link — NOT "no access"
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

test('queryGateKind: thrown errors classify per class when no data', () => {
  assert.equal(queryGateKind({ isPending: false, fetchStatus: 'idle', error: httpErr(403), hasData: false }), 'access');
  assert.equal(queryGateKind({ isPending: false, fetchStatus: 'idle', error: httpErr(404), hasData: false }), 'not_found');
  assert.equal(queryGateKind({ isPending: false, fetchStatus: 'idle', error: pgErr('22P02'), hasData: false }), 'not_found');
  assert.equal(queryGateKind({ isPending: false, fetchStatus: 'idle', error: httpErr(500), hasData: false }), 'temporary');
});

test('queryGateKind: settled empty with no error → ok by DEFAULT (fail-safe, TRIP-220)', () => {
  // The prod bug: a zero-trip user's trips-list query settles with [] (no error),
  // so hasData=false. The OLD default read that as 'access' and showed the trip-
  // level "Нет доступа к этому путешествию" screen on /trips. The default is now
  // the fail-safe 'ok' — a real deny never arrives as a settled-empty success
  // (it's a thrown 403/404, classified above), so empty is only ever benign. A
  // new collection screen that forgets to think about this degrades to a harmless
  // empty state, never to a false denial.
  assert.equal(queryGateKind({ isPending: false, fetchStatus: 'idle', error: undefined, hasData: false }), 'ok');
  // The default must NOT swallow real errors or the loading/paused states.
  assert.equal(queryGateKind({ isPending: false, fetchStatus: 'idle', error: httpErr(403), hasData: false }), 'access');
  assert.equal(queryGateKind({ isPending: false, fetchStatus: 'idle', error: httpErr(500), hasData: false }), 'temporary');
  assert.equal(queryGateKind({ isPending: true, fetchStatus: 'fetching', error: undefined, hasData: false }), 'loading');
  assert.equal(queryGateKind({ isPending: true, fetchStatus: 'paused', error: undefined, hasData: false }), 'temporary');
});

test('queryGateKind: single-resource opt-in (emptyIsOk:false) → settled-empty = access', () => {
  // A specific trip fetched by id that comes back empty means "you can't see it".
  // Single-resource screens (TripView/editor shell+content) pass emptyIsOk:false
  // to keep that defensive guard over the thrown-error path.
  assert.equal(queryGateKind({ isPending: false, fetchStatus: 'idle', error: undefined, hasData: false, emptyIsOk: false }), 'access');
  // The opt-in still must not override auth/error/loading/paused.
  assert.equal(queryGateKind({ isPending: false, fetchStatus: 'idle', error: httpErr(500), hasData: false, emptyIsOk: false }), 'temporary');
  assert.equal(queryGateKind({ isPending: true, fetchStatus: 'paused', error: undefined, hasData: false, emptyIsOk: false }), 'temporary');
});

// ── gateStubProps: one source for the error-screen look ───────────────────────
test('gateStubProps: each kind maps to its own icon/tone/copy', () => {
  assert.deepEqual(gateStubProps('not_found'), { icon: 'search', tone: 'brand', title: 'sys.not_found_title', body: 'sys.not_found_body' });
  assert.deepEqual(gateStubProps('access'), { icon: 'lock', tone: 'warm', title: 'sys.no_access_title', body: 'sys.no_access_body' });
  // temporary (and any fallback) → the "couldn't load, retry" stub
  assert.equal(gateStubProps('temporary').title, 'sys.load_error_title');
  assert.equal(gateStubProps('anything-else').icon, 'warning');
});
