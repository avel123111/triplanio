// The identity ladder every people-showing surface shares (TRIP-334).
//
// This behaviour has no screenshot and no CI guard: check:design, the inline
// ratchet and the prefix guard all look at style, and a wrong NAME renders
// perfectly. The regression it locks down is what shipped to prod — an invited
// member who then deleted their account rendered as a bare "-", because the
// members screen carried its own copy of this ladder that knew nothing about
// anonymized accounts.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { resolveAuthor, resolveMembers, resolveOwnerName } from './resolveAuthor.js';

const DELETED = 'Удалённый аккаунт';
const opts = { deletedLabel: DELETED, fallback: DELETED };

// ── anonymized accounts — the TRIP-334 class ─────────────────────────────────

// anonymize_my_account scrubs users.full_name AND trip_members.user_full_name /
// invite_email, so EVERY rung below the profile is blank. The label must come
// from the profile alone, whatever the membership status.
for (const status of ['active', 'pending', 'declined']) {
  test(`deleted account (status ${status}) → label, never a placeholder`, () => {
    const m = { id: 'm1', user_id: 'u1', status, role: 'admin', user_full_name: null, invite_email: null };
    const who = resolveAuthor({
      userId: 'u1',
      nameSnapshot: m.user_full_name,
      profiles: { u1: { id: 'u1', full_name: '', avatar_url: '', email: '', is_deleted: true } },
      members: [m],
      ...opts,
    });
    assert.equal(who.name, DELETED);
    assert.equal(who.deleted, true);
    // The exact prod symptom: displayName()'s "-" leaking onto the screen.
    assert.notEqual(who.name, '-');
  });
}

test('deleted account never shows an email line', () => {
  // Belt AND braces: the backend blanks a deleted user's email (toProfile), and
  // the resolver refuses to print one even if a stale snapshot survives.
  const m = { id: 'm1', user_id: 'u1', status: 'pending', user_full_name: 'Илья', invite_email: 'ilya@example.com' };
  const who = resolveAuthor({
    userId: 'u1',
    nameSnapshot: m.user_full_name,
    profiles: { u1: { id: 'u1', full_name: '', avatar_url: '', email: '', is_deleted: true } },
    members: [m],
    ...opts,
  });
  assert.equal(who.name, DELETED);
  assert.equal(who.email, '');
});

test('a deleted profile wins over the name snapshot on the row', () => {
  // Order matters: the snapshot rung must not resurrect a scrubbed identity.
  const who = resolveAuthor({
    userId: 'u1',
    nameSnapshot: 'Илья',
    profiles: { u1: { id: 'u1', full_name: '', avatar_url: '', email: '', is_deleted: true } },
    members: [],
    ...opts,
  });
  assert.equal(who.name, DELETED);
});

// ── colour seed is STABLE per identity, never the display name ────────────────

test('seed is the account id, not the name — one colour across naming states', () => {
  // Same person, three different labels they might render under. The avatar
  // colour must not change, so the seed must be the same for all three.
  const named = resolveAuthor({
    userId: 'u1', profiles: { u1: { id: 'u1', full_name: 'Pavel', email: 'p@e.com', is_deleted: false } }, ...opts,
  });
  const noName = resolveAuthor({
    userId: 'u1', profiles: { u1: { id: 'u1', full_name: '', email: 'p@e.com', is_deleted: false } }, ...opts,
  });
  assert.equal(named.seed, 'u1');
  assert.equal(noName.seed, 'u1');
  assert.equal(named.seed, noName.seed);
  // The names themselves differ — proving the seed is decoupled from the label.
  assert.notEqual(named.name, noName.name);
});

test('deleted account keeps the account id as its seed', () => {
  const who = resolveAuthor({
    userId: 'u1',
    profiles: { u1: { id: 'u1', full_name: '', avatar_url: '', email: '', is_deleted: true } },
    ...opts,
  });
  assert.equal(who.seed, 'u1');
});

test('an unregistered invite seeds off the membership row, not the label', () => {
  const m = { id: 'm7', user_id: null, status: 'pending', user_full_name: '', invite_email: 'newcomer@example.com' };
  const who = resolveAuthor({ userId: null, nameSnapshot: '', member: m, profiles: {}, members: [m], ...opts });
  assert.equal(who.seed, 'm7');
});

// ── the ordinary rungs still resolve as before ───────────────────────────────

test('live profile wins: name from the account, email underneath', () => {
  const m = { id: 'm1', user_id: 'u1', status: 'active', user_full_name: 'Старое Имя' };
  const who = resolveAuthor({
    userId: 'u1',
    nameSnapshot: m.user_full_name,
    profiles: { u1: { id: 'u1', full_name: 'Pavel Moskovkin', avatar_url: 'a.png', email: 'p@example.com', is_deleted: false } },
    members: [m],
    ...opts,
  });
  assert.equal(who.name, 'Pavel Moskovkin');
  assert.equal(who.email, 'p@example.com');
  assert.equal(who.photo, 'a.png');
  assert.equal(who.deleted, false);
});

test('invite address wins over the account address as the email line', () => {
  const m = { id: 'm1', user_id: 'u1', status: 'pending', user_full_name: 'Ilia', invite_email: 'invited@example.com' };
  const who = resolveAuthor({
    userId: 'u1',
    nameSnapshot: m.user_full_name,
    profiles: { u1: { id: 'u1', full_name: 'Ilia', avatar_url: '', email: 'account@example.com', is_deleted: false } },
    members: [m],
    ...opts,
  });
  assert.equal(who.email, 'invited@example.com');
});

test('no real name: the address becomes the NAME and is not repeated below', () => {
  // Otherwise the row reads "Invited / invited@example.com" with the same text
  // twice — the duplication each screen used to guard by hand.
  const m = { id: 'm1', user_id: null, status: 'pending', user_full_name: '', invite_email: 'invited@example.com' };
  const who = resolveAuthor({
    userId: 'u2',
    nameSnapshot: '',
    profiles: {},
    members: [{ ...m, user_id: 'u2' }],
    ...opts,
  });
  assert.equal(who.name, 'Invited');
  assert.equal(who.email, '');
});

// ── invites to people WITHOUT an account — the row has no user_id at all ─────

test('invite to an unregistered address: name from the address, not a fallback', () => {
  // inviteTripMember writes user_id: null when the address has no users row,
  // so there is no id to look the membership snapshot up BY — the row itself
  // has to be handed over. Otherwise the ladder falls through to `fallback`,
  // which on the member screens is the "deleted account" label: an ordinary
  // pending invite would read as a deleted person.
  const m = { id: 'm1', user_id: null, status: 'pending', user_full_name: '', invite_email: 'newcomer@example.com' };
  const who = resolveAuthor({
    userId: m.user_id,
    nameSnapshot: m.user_full_name,
    member: m,
    profiles: {},
    members: [m],
    ...opts,
  });
  assert.equal(who.name, 'Newcomer');
  assert.equal(who.deleted, false);
  assert.equal(who.email, ''); // the address IS the name — never printed twice
});

test('declined invite to an unregistered address resolves the same way', () => {
  const m = { id: 'm2', user_id: null, status: 'declined', user_full_name: '', invite_email: 'newcomer@example.com' };
  const who = resolveAuthor({ userId: null, nameSnapshot: '', member: m, profiles: {}, members: [m], ...opts });
  assert.equal(who.name, 'Newcomer');
});

test('offline placeholder resolves from its name snapshot alone', () => {
  // addOfflineTripMember writes user_id: null + a name, no address at all.
  const who = resolveAuthor({
    userId: null,
    nameSnapshot: 'Бабушка',
    profiles: {},
    members: [],
    ...opts,
  });
  assert.equal(who.name, 'Бабушка');
  assert.equal(who.email, '');
  assert.equal(who.deleted, false);
});

test('unresolvable row falls back to the caller label, not "?" or "-"', () => {
  const who = resolveAuthor({ userId: 'ghost', profiles: {}, members: [], ...opts });
  assert.equal(who.name, DELETED);
  assert.equal(who.email, '');
});

// ── the AI assistant — a constant branch, never a fetched profile ────────────

test('bot id resolves to the bot name + kind:ai, with no fetch', () => {
  const who = resolveAuthor({
    userId: 'bot-uuid',
    botId: 'bot-uuid',
    botName: 'Triplanio',
    // Even if a stale row or profile leaked in, the bot branch wins first.
    nameSnapshot: 'stale',
    profiles: { 'bot-uuid': { id: 'bot-uuid', full_name: 'X', is_deleted: true } },
    ...opts,
  });
  assert.equal(who.name, 'Triplanio');
  assert.equal(who.kind, 'ai');
  assert.equal(who.photo, null);
  assert.equal(who.deleted, false);
});

test('bot branch is inert for a non-bot author', () => {
  const who = resolveAuthor({
    userId: 'u1',
    botId: 'bot-uuid',
    botName: 'Triplanio',
    profiles: { u1: { id: 'u1', full_name: 'Pavel', avatar_url: 'a.png', email: 'p@e.com', is_deleted: false } },
    ...opts,
  });
  assert.equal(who.name, 'Pavel');
  assert.equal(who.kind, undefined);
});

test('no botId means the bot branch never fires', () => {
  const who = resolveAuthor({ userId: 'bot-uuid', botName: 'Triplanio', profiles: {}, members: [], ...opts });
  assert.equal(who.name, DELETED); // falls through to the caller fallback
  assert.notEqual(who.kind, 'ai');
});

// ── resolveOwnerName — one helper for the "PRO by {owner}" copy ───────────────

test('resolveOwnerName resolves the owner through the live profile', () => {
  const name = resolveOwnerName({
    trip: { created_by: 'o1' },
    members: [{ id: 'm1', user_id: 'o1', role: 'owner', user_full_name: 'Snapshot' }],
    profiles: { o1: { id: 'o1', full_name: 'Live Owner', email: 'o@e.com', is_deleted: false } },
    ...opts,
  });
  assert.equal(name, 'Live Owner');
});

test('resolveOwnerName falls back to the snapshot with no profiles', () => {
  const name = resolveOwnerName({
    trip: { created_by: 'o1' },
    members: [{ id: 'm1', user_id: 'o1', role: 'owner', user_full_name: 'Snapshot Owner' }],
  });
  assert.equal(name, 'Snapshot Owner');
});

test('resolveOwnerName returns empty string when there is no owner', () => {
  assert.equal(resolveOwnerName({ trip: {}, members: [] }), '');
  assert.equal(resolveOwnerName(), '');
});

test('resolveMembers keeps id + role and carries the resolved identity', () => {
  const members = [{ id: 'm1', user_id: 'u1', role: 'admin', status: 'pending', user_full_name: null, invite_email: null }];
  const [row] = resolveMembers(members, {
    profiles: { u1: { id: 'u1', full_name: '', avatar_url: '', email: '', is_deleted: true } },
    deletedLabel: DELETED,
  });
  assert.equal(row.id, 'm1');
  assert.equal(row.role, 'admin');
  assert.equal(row.name, DELETED);
});
