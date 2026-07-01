// Unit tests for the geocode retry-delay policy (TRIP-59). Run: npm test (node --test)
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  liqRetryDelayMs,
  LIQ_RETRY_JITTER_MS,
  LIQ_RETRY_BASE_FLOOR_MS,
  LIQ_RETRY_MAX_MS,
} from './geo-retry.js';

// Build a fake FunctionsHttpError whose .context is a Response-like object.
function errWithRetryAfter(value) {
  const headers = { get: (name) => (name === 'Retry-After' && value != null ? value : null) };
  return { context: { headers } };
}

test('honors Retry-After seconds as the floor', () => {
  // rand=0 → delay is exactly the floor; Retry-After: 2 → 2000ms.
  assert.equal(liqRetryDelayMs(errWithRetryAfter('2'), () => 0), 2000);
  // rand=1 → floor + full jitter window.
  assert.equal(liqRetryDelayMs(errWithRetryAfter('2'), () => 1), 2000 + LIQ_RETRY_JITTER_MS);
});

test('caps a pathological Retry-After at LIQ_RETRY_MAX_MS', () => {
  assert.equal(liqRetryDelayMs(errWithRetryAfter('99999'), () => 0), LIQ_RETRY_MAX_MS);
});

test('falls back to the base floor when no Retry-After header (e.g. 502)', () => {
  assert.equal(liqRetryDelayMs(errWithRetryAfter(null), () => 0), LIQ_RETRY_BASE_FLOOR_MS);
});

test('falls back to the base floor on a non-numeric / HTTP-date Retry-After', () => {
  assert.equal(liqRetryDelayMs(errWithRetryAfter('Wed, 21 Oct 2026 07:28:00 GMT'), () => 0), LIQ_RETRY_BASE_FLOOR_MS);
});

test('ignores zero / negative Retry-After and uses the base floor', () => {
  assert.equal(liqRetryDelayMs(errWithRetryAfter('0'), () => 0), LIQ_RETRY_BASE_FLOOR_MS);
  assert.equal(liqRetryDelayMs(errWithRetryAfter('-5'), () => 0), LIQ_RETRY_BASE_FLOOR_MS);
});

test('survives a malformed error with no context (network error)', () => {
  assert.equal(liqRetryDelayMs(undefined, () => 0), LIQ_RETRY_BASE_FLOOR_MS);
  assert.equal(liqRetryDelayMs({}, () => 0), LIQ_RETRY_BASE_FLOOR_MS);
});

test('always returns a delay within [floor, floor + jitter)', () => {
  for (const r of [0, 0.5, 0.999]) {
    const d = liqRetryDelayMs(errWithRetryAfter('1'), () => r);
    assert.ok(d >= 1000 && d < 1000 + LIQ_RETRY_JITTER_MS, `delay ${d} out of range`);
  }
});
