// Pins the OAuth `#access_token` strip (TRIP-407, 328.1) and that NOTHING in
// `search` is dropped along with it — what AuthContext runs on the address bar.
// Invisible in the UI, so it needs a test.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { stripAuthHash } from './authHash.js';

const TOKEN_HASH = '#access_token=eyJ.abc&expires_in=3600&token_type=bearer';

test('stripAuthHash drops the whole fragment when it carries access_token', () => {
  assert.equal(stripAuthHash('/trips', '', TOKEN_HASH), '/trips');
});

test('stripAuthHash preserves the query, dropping only the fragment', () => {
  assert.equal(
    stripAuthHash('/trips', '?utm_source=google&t=share', TOKEN_HASH),
    '/trips?utm_source=google&t=share',
  );
});

test('stripAuthHash is a no-op (null) when the hash has no token', () => {
  assert.equal(stripAuthHash('/trips', '?a=1', '#type=recovery'), null);
  assert.equal(stripAuthHash('/trips', '', ''), null);
  assert.equal(stripAuthHash('/trips', '', undefined), null);
});
