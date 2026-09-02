import { strict as assert } from 'node:assert';
import test from 'node:test';
import { REDIRECT_ID_KEY, stashRedirectId, takeRedirectId } from './analyticsRedirectId.js';

/** A sessionStorage-shaped fake over a Map. */
function fakeStorage() {
  const m = new Map();
  return {
    setItem: (k, v) => m.set(k, String(v)),
    getItem: (k) => (m.has(k) ? m.get(k) : null),
    removeItem: (k) => m.delete(k),
    _size: () => m.size,
  };
}

test('round-trip: stashed id comes back once', () => {
  const s = fakeStorage();
  stashRedirectId(s, 'anon-A');
  assert.equal(takeRedirectId(s), 'anon-A');
});

test('one-shot: a second take is null and the key is cleared', () => {
  const s = fakeStorage();
  stashRedirectId(s, 'anon-A');
  takeRedirectId(s);
  assert.equal(takeRedirectId(s), null, 'a stale id must not bootstrap a later boot onto the wrong person');
  assert.equal(s._size(), 0, 'take removes the key');
});

test('take on empty storage is null', () => {
  assert.equal(takeRedirectId(fakeStorage()), null);
});

test('stash is a no-op on a missing id or missing storage', () => {
  const s = fakeStorage();
  stashRedirectId(s, null);
  stashRedirectId(s, undefined);
  stashRedirectId(s, '');
  assert.equal(s._size(), 0);
  assert.doesNotThrow(() => stashRedirectId(null, 'anon-A'));
});

test('a refusing storage (private mode / ITP) is swallowed, never thrown', () => {
  const throwing = {
    setItem: () => { throw new Error('QuotaExceeded'); },
    getItem: () => { throw new Error('SecurityError'); },
    removeItem: () => { throw new Error('SecurityError'); },
  };
  assert.doesNotThrow(() => stashRedirectId(throwing, 'anon-A'));
  assert.equal(takeRedirectId(throwing), null);
});

test('the key has its own namespace, not the mark stash', () => {
  assert.equal(REDIRECT_ID_KEY, 'tp-analytics-did');
  assert.notEqual(REDIRECT_ID_KEY, 'tp-signup-attribution');
});
