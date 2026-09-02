// identifyUser is browser-only (it drives the live PostHog singleton), so its
// contract is pinned by reading the source — same rule as posthog.test.js. The
// contract that MUST NOT silently regress: identify rides readiness, not consent
// (TRIP-502). The old `isPersisting()` gate meant only cookie-accepters were ever
// identified, which broke the funnel/retention/engagement for the ad traffic.
import { strict as assert } from 'node:assert';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const SRC = readFileSync(new URL('./analytics.js', import.meta.url), 'utf8');

test('identifyUser gates on isReady(), not persistence (TRIP-502)', () => {
  const fn = SRC.match(/export function identifyUser[\s\S]*?\n}/)?.[0];
  assert.ok(fn, 'identifyUser must exist');
  assert.match(fn, /mayIdentify\(uid,\s*isReady\(\)\)/,
    'identify must ride isReady so anon→uid stitches without cookie consent');
  assert.doesNotMatch(fn, /isPersisting/,
    'the isPersisting gate only ever identified cookie-accepters — do not bring it back');
});
