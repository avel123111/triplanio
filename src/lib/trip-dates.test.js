// formatDateRange — THE app-wide rule for joining two dates into a range.
// Regression guard for TRIP-230: the map lens (and three more screens) each had
// their own join and printed "12 июл – 12 июл" for start/finish nodes and
// 0-night layovers. Run: npm test (node --test)
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { formatDateRange } from './trip-dates.js';

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
