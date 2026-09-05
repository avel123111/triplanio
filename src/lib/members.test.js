import { test } from 'node:test';
import assert from 'node:assert/strict';
import { resolveMyRole, sortMembers, countTripMembers } from './members.js';

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

// ── sortMembers — owner → admin → active → offline → pending (TRIP-517) ───────
// The owner is a real trip_members row now, so this only ORDERS the list.

test('sortMembers: owner first, then admin, then active viewer', () => {
  const members = [
    { id: 'v', user_id: 'u3', role: 'viewer', status: 'active' },
    { id: 'a', user_id: 'u2', role: 'admin', status: 'active' },
    { id: 'o', user_id: OWNER, role: 'owner', status: 'active' },
  ];
  assert.deepEqual(sortMembers(members).map((m) => m.id), ['o', 'a', 'v']);
});

test('sortMembers: offline before pending, both after active', () => {
  const members = [
    { id: 'p', role: 'viewer', status: 'pending' },
    { id: 'off', role: 'viewer', status: 'offline' },
    { id: 'act', role: 'viewer', status: 'active' },
    { id: 'o', role: 'owner', status: 'active' },
  ];
  assert.deepEqual(sortMembers(members).map((m) => m.id), ['o', 'act', 'off', 'p']);
});

test('sortMembers: stable within a rank (keeps input order)', () => {
  const members = [
    { id: 'a1', role: 'admin', status: 'active' },
    { id: 'a2', role: 'admin', status: 'active' },
  ];
  assert.deepEqual(sortMembers(members).map((m) => m.id), ['a1', 'a2']);
});

test('sortMembers: empty / missing input is safe', () => {
  assert.deepEqual(sortMembers([]), []);
  assert.deepEqual(sortMembers(), []);
});

test('countTripMembers: counts owner + active + offline, excludes pending', () => {
  const members = [
    { user_id: OWNER, role: 'owner', status: 'active' },
    { user_id: 'u2', role: 'admin', status: 'active' },
    { user_id: 'u3', role: 'viewer', status: 'offline' },
    { user_id: 'u4', role: 'viewer', status: 'pending' },
  ];
  assert.equal(countTripMembers(members), 3);
});

test('countTripMembers: solo trip is just the owner row', () => {
  assert.equal(countTripMembers([{ user_id: OWNER, role: 'owner', status: 'active' }]), 1);
});
