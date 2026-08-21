// formatDateRange — THE app-wide rule for joining two dates into a range.
// Regression guard for TRIP-230: the map lens (and three more screens) each had
// their own join and printed "12 июл – 12 июл" for start/finish nodes and
// 0-night layovers. Run: npm test (node --test)
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { formatDateRange, countdownParts } from './trip-dates.js';

// Stand-in for a screen's own single-date formatter (day + short month).
const fmtDM = (iso) => {
  const d = new Date(iso);
  return `${d.getUTCDate()} ${['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'][d.getUTCMonth()]}`;
};

test('a real range keeps both ends', () => {
  assert.equal(formatDateRange('2026-07-12', '2026-07-16', fmtDM), '12 Jul – 16 Jul');
});

test('both ends on the same day collapse to ONE date', () => {
  assert.equal(formatDateRange('2026-07-12', '2026-07-12', fmtDM), '12 Jul');
});

test('ends that RENDER the same collapse, even if the raw values differ', () => {
  // Same calendar day, different times — a 0-night layover as stored.
  assert.equal(formatDateRange('2026-07-12T08:00:00Z', '2026-07-12T23:30:00Z', fmtDM), '12 Jul');
});

test('one known end renders alone, not as a half-empty range', () => {
  assert.equal(formatDateRange('2026-07-12', null, fmtDM), '12 Jul');
  assert.equal(formatDateRange(null, '2026-07-16', fmtDM), '16 Jul');
});

test('no dates at all render as an empty string', () => {
  assert.equal(formatDateRange(null, null, fmtDM), '');
  assert.equal(formatDateRange('', '', fmtDM), '');
});

test('the separator is overridable without touching the collapse rule', () => {
  assert.equal(formatDateRange('2026-07-12', '2026-07-16', fmtDM, ' - '), '12 Jul - 16 Jul');
  assert.equal(formatDateRange('2026-07-12', '2026-07-12', fmtDM, ' - '), '12 Jul');
});

// ── countdownParts — плитки отсчёта героя главной ──────────────────────────────
test('countdownParts splits an interval into d/h/m tiles', () => {
  // 2 дня 3 часа 4 минуты (+59 сек — секунды отбрасываются вниз)
  const ms = ((2 * 24 + 3) * 60 + 4) * 60_000 + 59_000;
  assert.deepEqual(countdownParts(ms), { d: 2, h: 3, m: 4 });
});

test('countdownParts clamps a started trip to zeros, never negatives', () => {
  assert.deepEqual(countdownParts(0), { d: 0, h: 0, m: 0 });
  assert.deepEqual(countdownParts(-5_000), { d: 0, h: 0, m: 0 });
});

test('countdownParts: under an hour → minutes only', () => {
  assert.deepEqual(countdownParts(59 * 60_000), { d: 0, h: 0, m: 59 });
});
