// Unit tests for the adaptive calm-camera duration. Run: npm test (node --test)
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { calmDuration } from './calmDuration.js';

test('calmDuration: grows with |Δzoom| so big jumps take longer', () => {
  const small = calmDuration({ dZoom: 1 });
  const big = calmDuration({ dZoom: 9 });
  assert.ok(big > small, 'a 9-level zoom must animate longer than a 1-level one');
  // symmetric in direction (zoom in vs out)
  assert.equal(calmDuration({ dZoom: 4 }), calmDuration({ dZoom: -4 }));
});

test('calmDuration: clamped to a sane range', () => {
  assert.ok(calmDuration({ dZoom: 0 }) >= 420);
  assert.ok(calmDuration({ dZoom: 100, screens: 100 }) <= 3000);
});

test('calmDuration: center pans add a little, capped', () => {
  assert.ok(calmDuration({ dZoom: 1, screens: 3 }) > calmDuration({ dZoom: 1, screens: 0 }));
  // screens contribution is capped (5) — 6 and 50 screens cost the same
  assert.equal(calmDuration({ dZoom: 1, screens: 6 }), calmDuration({ dZoom: 1, screens: 50 }));
});
