// Guards the TRIP-277 regression: `@keyframes aispin` animates `transform`, and
// its implicit `from` is the element's own computed transform. So an element
// that both carries `.spin` AND positions itself with a transform (typically
// `translateY(-50%)` centring) has its centring REPLACED by the rotation — the
// spinner slides half its height every turn instead of turning in place.
// The fix is always the same: wrap it, so the wrapper positions and the inner
// element spins. This test fails if the two ever land on one element again.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';

const SRC = fileURLToPath(new URL('..', import.meta.url));

function jsxFiles(dir) {
  return readdirSync(dir).flatMap((entry) => {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) return jsxFiles(full);
    return /\.jsx?$/.test(entry) ? [full] : [];
  });
}

// A single JSX element: from `<` up to the closing `>` of its opening tag.
const ELEMENT = /<[A-Za-z][^>]*>/g;

test('no element both spins and positions itself with a transform', () => {
  const offenders = [];
  for (const file of jsxFiles(SRC)) {
    const src = readFileSync(file, 'utf8');
    for (const el of src.match(ELEMENT) || []) {
      const spins = /className=(["'`])[^"'`]*\bspin\b[^"'`]*\1/.test(el);
      if (spins && /transform:/.test(el)) {
        offenders.push(`${file.slice(SRC.length)}: ${el.slice(0, 110)}`);
      }
    }
  }
  assert.deepEqual(
    offenders,
    [],
    '`.spin` sits on an element that also sets `transform` — the aispin keyframe '
      + 'replaces that transform. Wrap it: wrapper positions, inner element spins.\n'
      + offenders.join('\n'),
  );
});
