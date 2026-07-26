// TRIP-277: date, date+time and time are picked with ONE element — the
// <DateTimeInput> trigger opening our own panel. Native `<input type="date">`
// and `<input type="time">` hand the job to the OS widget, which is why the app
// used to show a different picker per screen (and an OS clock inside our own
// calendar popover). This test fails if a native one comes back.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';

const SRC = fileURLToPath(new URL('..', import.meta.url));

function jsxFiles(dir) {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) return jsxFiles(full);
    return /\.jsx?$/.test(entry.name) && !/\.test\.jsx?$/.test(entry.name) ? [full] : [];
  });
}

const NATIVE = /type=(["'])(date|time|datetime-local)\1/g;

test('no native date/time input is left in src', () => {
  const offenders = [];
  for (const file of jsxFiles(SRC)) {
    const src = readFileSync(file, 'utf8');
    for (const hit of src.match(NATIVE) || []) {
      offenders.push(`${file.slice(SRC.length)}: ${hit}`);
    }
  }
  assert.deepEqual(
    offenders,
    [],
    'Native date/time input found — use <DateTimeInput mode="date|datetime|time"> '
      + 'so every screen opens the same panel.\n' + offenders.join('\n'),
  );
});
