import test from 'node:test';
import assert from 'node:assert/strict';
import { normalizeExternalUrl, hostnameFromUrl } from './booking-platforms.js';

// This function is the ONLY thing standing between a stored URL and an <a href>:
// React 18 does not block `javascript:` URLs (its check is a dev-only warning),
// and the app's CSP has no script-src. The tests below are the executable form of
// the "do not improve this" comment in the source — they fail the moment someone
// teaches it to pass through URLs that already carry a scheme (TRIP-281).

test('a foreign scheme is defused, not passed through', () => {
  for (const hostile of [
    'javascript:alert(1)',
    'JavaScript:alert(1)',
    '  javascript:alert(1)  ',
    'data:text/html,<script>alert(1)</script>',
    'vbscript:msgbox(1)',
    'file:///etc/passwd',
  ]) {
    // Prepending pushes the hostile scheme INSIDE the host, so what the browser
    // sees is an https navigation — never something it executes. Asserting the
    // https prefix is the whole invariant: nothing else can survive it.
    const out = normalizeExternalUrl(hostile);
    assert.ok(out.startsWith('https://'), `${hostile} -> ${out}`);
  }
});

test('scheme-splitting tricks do not survive either', () => {
  // Browsers strip tabs/newlines inside a URL before parsing the scheme, so a
  // pass-through check on the raw string could be fooled. Prepending cannot be.
  for (const hostile of ['java\nscript:alert(1)', 'java\tscript:alert(1)']) {
    const out = normalizeExternalUrl(hostile);
    assert.ok(out.startsWith('https://'), `${JSON.stringify(hostile)} -> ${out}`);
  }
});

test('a real link is left alone', () => {
  assert.equal(normalizeExternalUrl('https://booking.com/x?a=1'), 'https://booking.com/x?a=1');
  assert.equal(normalizeExternalUrl('http://booking.com'), 'http://booking.com');
  assert.equal(normalizeExternalUrl('HTTPS://Booking.com'), 'HTTPS://Booking.com');
});

test('a scheme-less link becomes absolute, not relative', () => {
  // Without this, "booking.com/x" would navigate inside our own app (TRIP-230).
  assert.equal(normalizeExternalUrl('booking.com/x'), 'https://booking.com/x');
  // A protocol-relative link still reaches that host (browsers collapse the extra
  // slashes), so this is an ordinary outbound link — which is all `link_url` ever
  // was. The DB CHECK pins the SCHEME to http(s); it never vouches for the host.
  assert.equal(normalizeExternalUrl('//evil.com'), 'https:////evil.com');
});

test('nothing in, nothing out', () => {
  for (const empty of ['', '   ', null, undefined, 42, {}]) {
    assert.equal(normalizeExternalUrl(empty), null);
  }
});

test('hostnameFromUrl drops www and survives junk', () => {
  assert.equal(hostnameFromUrl('https://www.booking.com/x'), 'booking.com');
  assert.equal(hostnameFromUrl('booking.com'), 'booking.com');
  assert.equal(hostnameFromUrl('not a url'), null);
});
