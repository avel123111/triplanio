// Pins the OAuth `#access_token` strip (TRIP-407, 328.1) and that NOTHING in
// `search` is dropped along with it. `stripAuthHash` is what AuthContext uses in
// PR1 (address bar); `stripAuthHashFromUrl` / `stripAuthHashFromEvent` are
// groundwork for `analyticsUrl.js` (TRIP-330 / Часть 5) — tested here so their
// shape is pinned before that owner wires them in. All invisible in the UI, so
// it needs a test.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { stripAuthHash, stripAuthHashFromUrl, stripAuthHashFromEvent } from './authHash.js';

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

test('stripAuthHashFromUrl strips the fragment off an absolute URL, keeping origin+query', () => {
  assert.equal(
    stripAuthHashFromUrl(`https://triplanio.com/trips?t=share${TOKEN_HASH}`),
    'https://triplanio.com/trips?t=share',
  );
});

test('stripAuthHashFromUrl returns the input unchanged when there is no token', () => {
  assert.equal(
    stripAuthHashFromUrl('https://triplanio.com/trips#type=recovery'),
    'https://triplanio.com/trips#type=recovery',
  );
});

test('stripAuthHashFromUrl never throws on an unparseable value', () => {
  assert.equal(stripAuthHashFromUrl('not a url'), 'not a url');
  assert.equal(stripAuthHashFromUrl(undefined), undefined);
});

test('before_send strips the token from BOTH $current_url and $session_entry_url', () => {
  const event = {
    event: 'landing_viewed',
    properties: {
      $current_url: `https://triplanio.com/trips${TOKEN_HASH}`,
      $session_entry_url: `https://triplanio.com/trips?utm_source=g${TOKEN_HASH}`,
      other: 'left alone',
    },
  };
  const out = stripAuthHashFromEvent(event);
  assert.equal(out.properties.$current_url, 'https://triplanio.com/trips');
  assert.equal(out.properties.$session_entry_url, 'https://triplanio.com/trips?utm_source=g');
  assert.equal(out.properties.other, 'left alone');
});

test('before_send leaves a token-free event untouched and tolerates a null event', () => {
  const clean = { properties: { $current_url: 'https://triplanio.com/login' } };
  assert.equal(stripAuthHashFromEvent(clean).properties.$current_url, 'https://triplanio.com/login');
  assert.equal(stripAuthHashFromEvent(null), null);
});
