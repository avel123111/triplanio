// Unit tests for the built-in cover gradients (TRIP-107).
// Run: npm test  (node --test)
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  TRIP_GRADIENTS,
  getGradientById,
  coverGradientCss,
  DEFAULT_GRADIENT_ID,
} from './trip-gradients.js';

const DEFAULT_CSS = getGradientById(DEFAULT_GRADIENT_ID).css;

test('getGradientById resolves a known id and rejects unknown/empty', () => {
  assert.equal(getGradientById('gradient_5')?.id, 'gradient_5');
  assert.equal(getGradientById('nope'), null);
  assert.equal(getGradientById(''), null);
  assert.equal(getGradientById(null), null);
});

test('coverGradientCss returns the chosen gradient css', () => {
  const g = getGradientById('gradient_9');
  assert.equal(coverGradientCss('gradient_9'), g.css);
});

test('coverGradientCss falls back to the default for null/empty/unknown ids', () => {
  // Copies and legacy trips have no stored gradient → must get the default,
  // never an ad-hoc/procedural one (no such fallback exists anymore).
  assert.equal(coverGradientCss(null), DEFAULT_CSS);
  assert.equal(coverGradientCss(''), DEFAULT_CSS);
  assert.equal(coverGradientCss(undefined), DEFAULT_CSS);
  assert.equal(coverGradientCss('gradient_999'), DEFAULT_CSS);
});

test('coverGradientCss never returns a procedural/hsl gradient', () => {
  for (const id of [null, '', 'x', ...TRIP_GRADIENTS.map((g) => g.id)]) {
    assert.match(coverGradientCss(id), /^linear-gradient\(/);
    assert.doesNotMatch(coverGradientCss(id), /hsl\(/);
  }
});

test('DEFAULT_GRADIENT_ID is a member of the built-in set', () => {
  assert.ok(TRIP_GRADIENTS.some((g) => g.id === DEFAULT_GRADIENT_ID));
});
