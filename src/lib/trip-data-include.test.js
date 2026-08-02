// Guards the TRIP-277 regression: the trip screen and the route editor share
// ONE React Query cache entry per key, so both must request the same `include`.
// The editor asked for `['content']` while the trip asked for
// `['content','budget']` — getTripDetails omits the budget keys entirely when
// 'budget' isn't requested — so entering the editor overwrote the shared entry
// with a budget-less payload and the budget widget rendered blank until reload.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { TRIP_CONTENT_INCLUDE, TRIP_SHELL_INCLUDE } from './trip-data.js';

// The pages reading a shared trip key. Resolved off this file, not the cwd.
const PAGES = ['TripView.jsx', 'TripStructureEdit.jsx'];
const readPage = (page) => readFileSync(new URL(`../pages/${page}`, import.meta.url), 'utf8');

test('each key keeps exactly one payload shape', () => {
  assert.deepEqual(TRIP_SHELL_INCLUDE, ['shell']);
  // Dropping 'budget' here blanks the budget widget on Overview and Budget.
  assert.deepEqual(TRIP_CONTENT_INCLUDE, ['content', 'budget']);
});

test('no page inlines its own include for a shared trip key', () => {
  for (const page of PAGES) {
    const src = readPage(page);
    assert.deepEqual(
      src.match(/include:\s*\[[^\]]*\]/g) || [],
      [],
      `${page} inlines an include array; import TRIP_SHELL_INCLUDE / `
        + 'TRIP_CONTENT_INCLUDE instead so the shared cache entry keeps one shape',
    );
    assert.ok(
      src.includes('TRIP_CONTENT_INCLUDE') && src.includes('TRIP_SHELL_INCLUDE'),
      `${page} should fetch both trip keys through the shared include constants`,
    );
  }
});
