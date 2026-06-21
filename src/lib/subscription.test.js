import test from 'node:test';
import assert from 'node:assert/strict';
import { isProActive } from './subscription.js';

// Drift guard (T6): the FE Pro predicate MUST stay identical to the canonical SQL
// source is_user_pro (migration 0055) — the same formula the edge functions now
// resolve via RPC. Cross-runtime import isn't possible (Vite/JS vs Postgres), so
// this truth table locks the FE mirror to the SQL semantics:
//   pro := subscription_status='pro' AND end_date IS NOT NULL AND end_date > now()
//   null / missing end_date = NOT pro.
// If you change the SQL formula, change isProActive AND this test together.
const future = new Date(Date.now() + 86_400_000).toISOString();
const past = new Date(Date.now() - 86_400_000).toISOString();

test('isProActive: pro + future end → true', () => {
  assert.equal(isProActive({ subscription_status: 'pro', subscription_end_date: future }), true);
});

test('isProActive: pro + null end → false (mirrors SQL: null end_date is NOT pro)', () => {
  assert.equal(isProActive({ subscription_status: 'pro', subscription_end_date: null }), false);
});

test('isProActive: pro + past end → false', () => {
  assert.equal(isProActive({ subscription_status: 'pro', subscription_end_date: past }), false);
});

test('isProActive: free status → false', () => {
  assert.equal(isProActive({ subscription_status: 'free', subscription_end_date: future }), false);
});

test('isProActive: missing user → false', () => {
  assert.equal(isProActive(null), false);
  assert.equal(isProActive(undefined), false);
});
