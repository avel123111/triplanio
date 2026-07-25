import test from 'node:test';
import assert from 'node:assert/strict';
import { mergeIncomingMessage } from './chat-merge.js';

const placeholder = (cid, extra = {}) => ({ id: cid, client_msg_id: cid, user_id: 'u1', text: 'hi', __pending: true, ...extra });
const server = (id, cid) => ({ id, client_msg_id: cid, user_id: 'u1', text: 'hi' });

test('settles the sender own placeholder in place', () => {
  const out = mergeIncomingMessage([placeholder('c1')], server('r1', 'c1'));
  assert.deepEqual(out.map((m) => m.id), ['r1']);
  assert.equal(out[0].__pending, undefined);
});

test('keeps position when the placeholder is not last', () => {
  const list = [placeholder('c1'), { id: 'other', user_id: 'u2', text: 'yo' }];
  const out = mergeIncomingMessage(list, server('r1', 'c1'));
  assert.deepEqual(out.map((m) => m.id), ['r1', 'other']);
});

test('two messages in flight both survive the first echo', () => {
  const list = [placeholder('c1'), placeholder('c2', { text: 'second' })];
  const out = mergeIncomingMessage(list, server('r1', 'c1'));
  assert.deepEqual(out.map((m) => m.id), ['r1', 'c2']);
});

test('a FAILED placeholder is settled by its own retry, not left behind', () => {
  const failed = placeholder('c1', { __pending: false, __failed: true, text: 'lost?' });
  const out = mergeIncomingMessage([failed], server('r1', 'c1'));
  assert.deepEqual(out.map((m) => m.id), ['r1']);
  assert.equal(out[0].__failed, undefined);
});

test('leaves another user in-flight placeholder alone', () => {
  const other = { id: 'c9', client_msg_id: 'c9', user_id: 'u2', text: 'mine', __pending: true };
  const out = mergeIncomingMessage([other], server('r1', 'c1'));
  assert.deepEqual(out.map((m) => m.id), ['c9', 'r1']);
});

test('an UPDATE of a held row replaces it in place', () => {
  const held = { id: 'r1', user_id: 'u1', text: 'hi', ai_status: 'queued' };
  const out = mergeIncomingMessage([held], { ...held, ai_status: 'done' });
  assert.equal(out.length, 1);
  assert.equal(out[0].ai_status, 'done');
});

test('a redelivered row does not duplicate', () => {
  const row = server('r1', 'c1');
  assert.equal(mergeIncomingMessage([row], row).length, 1);
});
