import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createAuthRetryFetch } from './createAuthRetryFetch.js';

const EDGE = 'https://x.supabase.co/functions/v1/getTripDetails';
const AUTH = 'https://x.supabase.co/auth/v1/token?grant_type=refresh_token';
const res = (status) => new Response(null, { status });

// A fake client whose refreshSession returns a fresh token (or fails).
const clientWithToken = (token) => ({ auth: { refreshSession: async () => ({ data: { session: { access_token: token } }, error: null }) } });
const clientThatFails = () => ({ auth: { refreshSession: async () => ({ data: null, error: new Error('no session') }) } });

test('passes through a non-401 response without refreshing', async () => {
  let calls = 0;
  const f = createAuthRetryFetch(async () => { calls++; return res(200); }, () => { throw new Error('must not refresh'); });
  const out = await f(EDGE, {});
  assert.equal(out.status, 200);
  assert.equal(calls, 1);
});

test('401 → refresh once + retry once with the fresh token', async () => {
  const seen = [];
  const realFetch = async (_url, init) => {
    seen.push(new Headers(init?.headers).get('Authorization'));
    return res(seen.length === 1 ? 401 : 200); // first 401, retry 200
  };
  const f = createAuthRetryFetch(realFetch, () => clientWithToken('NEW'));
  const out = await f(EDGE, { headers: { Authorization: 'Bearer OLD' } });
  assert.equal(out.status, 200);
  assert.deepEqual(seen, ['Bearer OLD', 'Bearer NEW']); // retried with the refreshed token
});

test('does NOT intercept a 401 from the auth endpoint (no refresh→401→refresh loop)', async () => {
  let calls = 0;
  const f = createAuthRetryFetch(async () => { calls++; return res(401); }, () => { throw new Error('must not refresh'); });
  const out = await f(AUTH, {});
  assert.equal(out.status, 401);
  assert.equal(calls, 1); // single call, no retry
});

test('refresh fails → original 401 bubbles up (no retry)', async () => {
  let calls = 0;
  const f = createAuthRetryFetch(async () => { calls++; return res(401); }, () => clientThatFails());
  const out = await f(EDGE, {});
  assert.equal(out.status, 401);
  assert.equal(calls, 1); // refresh failed → request NOT replayed
});

test('persistent 401 retries exactly once (no infinite loop)', async () => {
  let calls = 0;
  const f = createAuthRetryFetch(async () => { calls++; return res(401); }, () => clientWithToken('NEW'));
  const out = await f(EDGE, {});
  assert.equal(out.status, 401);
  assert.equal(calls, 2); // original + one retry, then it gives up
});

test('single-flight: concurrent 401s share ONE refreshSession call', async () => {
  let refreshes = 0;
  const client = { auth: { refreshSession: async () => { refreshes++; await Promise.resolve(); return { data: { session: { access_token: 'NEW' } }, error: null }; } } };
  let n = 0;
  const realFetch = async () => { n++; return res(n <= 3 ? 401 : 200); }; // first three (the originals) 401, retries 200
  const f = createAuthRetryFetch(realFetch, () => client);
  const outs = await Promise.all([f(EDGE, {}), f(EDGE, {}), f(EDGE, {})]);
  assert.deepEqual(outs.map((o) => o.status), [200, 200, 200]);
  assert.equal(refreshes, 1); // three concurrent 401s → exactly one refresh
});
