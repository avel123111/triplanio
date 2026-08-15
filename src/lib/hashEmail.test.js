// Pins the enhanced-conversion hash (TRIP-407 PR6): the digest must match a known
// SHA-256 vector, the address must be normalised (trim + lowercase) the way Google
// matches on, and — the whole point — the RAW email must never appear in the
// output. All invisible at runtime, so it needs a test.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { hashEmail } from './hashEmail.js';

// SHA-256('test@example.com') — a fixed, independently-verifiable vector.
const KNOWN = '973dfe463ec85785f5f95af5ba3906eedb2d931c24e69824a89ea65dba4e813b';

test('hashes a known email to its documented SHA-256 hex', async () => {
  assert.equal(await hashEmail('test@example.com'), KNOWN);
});

test('normalises (trim + lowercase) before hashing, as Google matches on', async () => {
  assert.equal(await hashEmail('  TEST@Example.COM '), KNOWN);
  assert.equal(await hashEmail('Test@Example.Com'), KNOWN);
});

test('the raw email never appears in the output — only the digest', async () => {
  const out = await hashEmail('secret.user@example.com');
  assert.match(out, /^[0-9a-f]{64}$/); // pure hex, fixed length
  assert.ok(!out.includes('secret.user'));
  assert.ok(!out.includes('@'));
  assert.ok(!out.includes('example.com'));
});

test('different addresses hash to different digests', async () => {
  assert.notEqual(await hashEmail('a@example.com'), await hashEmail('b@example.com'));
});
