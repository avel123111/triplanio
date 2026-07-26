// Guards the TRIP-277 regression: the AI booking parser used to carry three
// divergent copies of "is this value real?" - the hotel path checked for the
// literal "N/A", the single-leg transfer path checked nothing, and the
// multi-leg path used a bare `|| ''`. Transfers were therefore the ones that
// showed "N/A" in carrier / booking_reference / addresses.
//
// They are now one gate (`aiVal` in EventEditDialog.jsx). The failure mode is
// not "the gate is wrong" but "someone adds a second inline copy that drifts",
// so this test pins the literal to a single site rather than testing behaviour.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { join, relative } from 'node:path';

const SRC = fileURLToPath(new URL('..', import.meta.url));

function sourceFiles(dir) {
  return readdirSync(dir).flatMap((entry) => {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) return sourceFiles(full);
    return /\.jsx?$/.test(entry) && !/\.test\.js$/.test(entry) ? [full] : [];
  });
}

test('the "N/A" placeholder gate lives in exactly one place', () => {
  const sites = [];
  for (const file of sourceFiles(SRC)) {
    const lines = readFileSync(file, 'utf8').split('\n');
    lines.forEach((line, i) => {
      // Only count code, not the comments that explain the gate.
      if (/^\s*(\/\/|\*)/.test(line)) return;
      if (/['"]N\/A['"]/.test(line)) sites.push(`${relative(SRC, file)}:${i + 1}`);
    });
  }
  // Deliberately pinned by file, not by line — the point is "one site", and a
  // line number would make this fail on any unrelated edit above it.
  assert.equal(
    sites.length,
    1,
    'The "N/A" literal must stay inside the single `aiVal` gate; a second copy '
    + `is how the paths drifted apart before. Found ${sites.length} site(s):\n  `
    + `${sites.join('\n  ')}\nRoute the new check through \`aiVal\` instead.`,
  );
  assert.match(sites[0], /^components\/common\/EventEditDialog\.jsx:/);
});
