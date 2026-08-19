// Pure, Vite-free tests for the i18n degrade path (TRIP-441, issue 141555014).
// Imports ONLY settleNamespace.js — no React/jsdom/glob — so `node --test` runs it.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { settleNamespace } from './settleNamespace.js';

test('rejected chunk → empty namespace', async () => {
  const load = () => Promise.reject(new Error('404'));
  assert.deepEqual(await settleNamespace('ru', 'trip', load), ['trip', {}]);
});

test('resolve→undefined → empty namespace', async () => {
  const load = async () => undefined;
  assert.deepEqual(await settleNamespace('ru', 'trip', load), ['trip', {}]);
});

test('default export → record', async () => {
  const load = async () => ({ default: { a: '1' } });
  assert.deepEqual(await settleNamespace('ru', 'trip', load), ['trip', { a: '1' }]);
});
