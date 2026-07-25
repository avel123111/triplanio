import test from 'node:test';
import assert from 'node:assert/strict';
import { mergeIncomingMessage } from './chat-merge.js';

const real = { id: 'r1', user_id: 'u1', text: 'hi' };

test('replaces the sender own in-flight placeholder', () => {
  const out = mergeIncomingMessage([{ id: 'opt-1', user_id: 'u1', text: 'hi', __pending: true }], real);
  assert.deepEqual(out.map((m) => m.id), ['r1']);
});

test('keeps a FAILED placeholder — its text is only held there', () => {
  const failed = { id: 'opt-1', user_id: 'u1', text: 'lost?', __failed: true };
  const out = mergeIncomingMessage([failed], real);
  assert.deepEqual(out.map((m) => m.id), ['opt-1', 'r1']);
});

test('leaves another user in-flight placeholder alone', () => {
  const other = { id: 'opt-2', user_id: 'u2', text: 'mine', __pending: true };
  const out = mergeIncomingMessage([other], real);
  assert.deepEqual(out.map((m) => m.id), ['opt-2', 'r1']);
});

test('ignores a redelivered row', () => {
  const out = mergeIncomingMessage([real], real);
  assert.equal(out.length, 1);
});
