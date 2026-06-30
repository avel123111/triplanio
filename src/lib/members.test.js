import { test } from 'node:test';
import assert from 'node:assert/strict';
import { resolveMyRole, withOwnerRow, countTripMembers } from './members.js';

const OWNER = 'owner-uuid';
const trip = { id: 't1', created_by: OWNER };
const ownerUser = { id: OWNER };

// ── resolveMyRole — created_by ALWAYS wins (TRIP-143) ─────────────────────────

test('resolveMyRole: creator is owner even with a stray viewer member row', () => {
  // The exact bug: creator was invited + accepted, leaving a viewer row.
  const members = [{ user_id: OWNER, role: 'viewer', status: 'active' }];
  assert.equal(resolveMyRole(members, trip, ownerUser), 'owner');
});

test('resolveMyRole: creator is owner with no member row at all', () => {
  assert.equal(resolveMyRole([], trip, ownerUser), 'owner');
});

test('resolveMyRole: a real admin member is admin', () => {
  const members = [{ user_id: 'u2', role: 'admin', status: 'active' }];
  assert.equal(resolveMyRole(members, trip, { id: 'u2' }), 'admin');
});

test('resolveMyRole: a viewer member is viewer', () => {
  const members = [{ user_id: 'u3', role: 'viewer', status: 'active' }];
  assert.equal(resolveMyRole(members, trip, { id: 'u3' }), 'viewer');
});

test('resolveMyRole: a stranger with no row defaults to viewer', () => {
  assert.equal(resolveMyRole([], trip, { id: 'nobody' }), 'viewer');
});

// ── withOwnerRow — single owner, stray creator row dropped (TRIP-143) ─────────

test('withOwnerRow: drops stray creator row and prepends one owner', () => {
  const members = [
    { id: 'm1', user_id: OWNER, role: 'viewer', status: 'active' },
    { id: 'm2', user_id: 'u2', role: 'admin', status: 'active' },
  ];
  const out = withOwnerRow(members, OWNER);
  const owners = out.filter((m) => m.role === 'owner');
  assert.equal(owners.length, 1, 'exactly one owner row');
  assert.equal(owners[0].user_id, OWNER);
  // The creator must NOT also appear as a viewer.
  assert.ok(!out.some((m) => m.user_id === OWNER && m.role === 'viewer'));
  // Other members are preserved.
  assert.ok(out.some((m) => m.id === 'm2' && m.role === 'admin'));
});

test('withOwnerRow: synthesizes the owner when the creator has no row', () => {
  const out = withOwnerRow([{ user_id: 'u2', role: 'viewer', status: 'active' }], OWNER);
  assert.equal(out.filter((m) => m.role === 'owner').length, 1);
  assert.equal(out[0].user_id, OWNER, 'owner is first');
});

test('withOwnerRow: no ownerId → list returned unchanged', () => {
  const members = [{ user_id: 'u2', role: 'viewer', status: 'active' }];
  assert.deepEqual(withOwnerRow(members, ''), members);
});

test('countTripMembers: creator with a stray viewer row counts once', () => {
  const members = [
    { user_id: OWNER, role: 'viewer', status: 'active' },
    { user_id: 'u2', role: 'admin', status: 'active' },
  ];
  assert.equal(countTripMembers(members, OWNER), 2);
});

test('countTripMembers: creator with no row is still counted', () => {
  assert.equal(countTripMembers([{ user_id: 'u2', role: 'viewer', status: 'active' }], OWNER), 2);
});
