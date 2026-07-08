import { test } from 'node:test';
import assert from 'node:assert/strict';
import { retryQuery, retryDelay } from './query-client.js';

// Error shapes mirror loadStateClassify.test.js: edge FunctionsHttpError carries
// `.context.status`; direct PostgREST carries `.code`; network errors carry neither.
const httpErr = (status) => Object.assign(new Error('http'), { context: { status } });
const pgErr = (code) => Object.assign(new Error('pg'), { code });
const netErr = () => Object.assign(new Error('Failed to fetch'), { name: 'FunctionsFetchError' });

// ── retryQuery ──────────────────────────────────────────────────────────────────
test('retryQuery: permanent 4xx (except 429) is never retried', () => {
  for (const s of [400, 401, 403, 404, 422]) {
    assert.equal(retryQuery(0, httpErr(s)), false, `status ${s} must not retry`);
  }
  // Direct PostgREST RLS deny normalizes to 403 → no retry either.
  assert.equal(retryQuery(0, pgErr('42501')), false);
});

test('retryQuery: 429 and 5xx are retried up to 2 times', () => {
  for (const s of [429, 500, 502, 503]) {
    assert.equal(retryQuery(0, httpErr(s)), true, `status ${s} attempt 0 retries`);
    assert.equal(retryQuery(1, httpErr(s)), true, `status ${s} attempt 1 retries`);
    assert.equal(retryQuery(2, httpErr(s)), false, `status ${s} stops after 2`);
  }
});

test('retryQuery: no resolvable status (network/relay) is treated as transient', () => {
  assert.equal(retryQuery(0, netErr()), true);
  assert.equal(retryQuery(1, netErr()), true);
  assert.equal(retryQuery(2, netErr()), false);
});

// ── retryDelay ──────────────────────────────────────────────────────────────────
test('retryDelay: exponential growth, jittered, capped at ~15s', () => {
  // attempt 0 → ~1s, attempt 1 → ~2s, attempt 2 → ~4s (+ <=250ms jitter)
  assert.ok(retryDelay(0) >= 1000 && retryDelay(0) < 1250);
  assert.ok(retryDelay(1) >= 2000 && retryDelay(1) < 2250);
  assert.ok(retryDelay(2) >= 4000 && retryDelay(2) < 4250);
  // large attempt is capped at 15s base (+ jitter)
  assert.ok(retryDelay(20) >= 15000 && retryDelay(20) < 15250);
});
