#!/usr/bin/env node
/**
 * CI guard 2l (TRIP-282) — inline-style ratchet.
 *
 * The defect this exists to stop: a call site hand-writes the declarations an
 * existing CSS class should own (`style={{ border: 'none', padding: 0 }}`, a
 * button reset, an icon-tile tint). One such write is survivable; the damage is
 * that the NEXT person reads it as the local convention and copies it. Then the
 * element is forked — touch one copy and the others silently drift. That is
 * exactly how the account screen ended up with the same row declared under
 * three namespaces and a 31px-instead-of-18px card (TRIP-282).
 *
 * A repeated inline next to an existing class is evidence the CLASS is broken.
 * The fix is always one element- or context-scoped rule on the existing class
 * (`button.x { … }`, `.card > .x:only-child { … }`) — which is a rule on an
 * existing class, so it needs no approval; a new class NAME does (rule #6).
 *
 * Two invariants, both mechanical:
 *
 *   R1 (ratchet)   Per-file inline-object count may never EXCEED the committed
 *                  baseline. Files absent from the baseline get a ceiling of 0,
 *                  so new files start clean. The baseline is only ever lowered.
 *   R2 (clusters)  A file may not introduce a NEW group of ≥ MIN_CLUSTER
 *                  byte-identical inline objects. Groups already at or above
 *                  that size in the baseline are grandfathered at their current
 *                  size and may only shrink.
 *
 * Deliberately dumb: a regex over JSX text, no parse. It measures the smell
 * (hand-written repetition), not correctness — a one-off inline for a genuinely
 * unique value stays legal, it just counts against the file's ceiling.
 *
 * Refresh the baseline after a cleanup:
 *     node scripts/ci/check-inline-styles.mjs --write
 *
 * `--write` is NOT an escape hatch. It refuses to raise any existing ceiling,
 * and it refuses to admit a file — new or old — that carries a repeated group.
 * A brand-new file with genuinely one-off inlines is admitted, but only as a
 * visible `+` in the committed baseline, which a reviewer reads. (The first
 * cut let `--write` grandfather a new file at ANY count while the failure
 * message advised running it — the guard would have been theatre.)
 *
 * Renamed/moved file: fix the key in the baseline by hand. That is a one-line
 * diff a reviewer can see, which is the point — there is deliberately no
 * in-file marker and no allowlist to bury an exemption in.
 *
 * Exit: 0 ok, 1 violation, 2 internal error.
 */
import { readFileSync, writeFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = fileURLToPath(new URL('../..', import.meta.url));
const SRC = join(ROOT, 'src');
const BASELINE = join(ROOT, 'scripts/ci/inline-style-baseline.json');
const MIN_CLUSTER = 3;

const WRITE = process.argv.includes('--write');

// `style={{ … }}` — an inline OBJECT LITERAL. `style={someVar}` is not counted:
// a named object is already a shared thing, which is the direction we want.
const INLINE = /style=\{\{[\s\S]*?\}\}/g;

// `.sort()` is load-bearing: readdir order is filesystem-defined, and it decides
// the KEY ORDER of the baseline JSON. Without it the file re-shuffles between
// machines and every regeneration is a spurious diff.
function jsxFiles(dir) {
  return readdirSync(dir).sort().flatMap((entry) => {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) return jsxFiles(full);
    return /\.jsx$/.test(entry) ? [full] : [];
  });
}

const sum = (files) => Object.values(files).reduce((a, v) => a + v.count, 0);

/** Collapse numbers so `padding: 13px` and `padding: 14px` cluster together —
 *  the smell is the repeated SHAPE, not the exact value. Whitespace is DROPPED,
 *  not squeezed: squeezing left `{{ width: 1 }}` and `{{width:1}}` in different
 *  clusters, so a plain reformat would retire a grandfathered key and report the
 *  replacement as a brand-new repeat. */
const shape = (s) => s.replace(/\s+/g, '').replace(/-?\d+(\.\d+)?/g, 'N');

function scan() {
  const out = {};
  for (const file of jsxFiles(SRC)) {
    const rel = relative(ROOT, file).split('\\').join('/'); // POSIX keys on every OS
    const hits = readFileSync(file, 'utf8').match(INLINE) || [];
    if (!hits.length) continue;
    const clusters = {};
    for (const h of hits) {
      const k = shape(h);
      clusters[k] = (clusters[k] || 0) + 1;
    }
    out[rel] = {
      count: hits.length,
      clusters: Object.fromEntries(
        Object.entries(clusters).filter(([, n]) => n >= MIN_CLUSTER).sort((a, b) => b[1] - a[1]),
      ),
    };
  }
  return out;
}

let current;
try {
  current = scan();
} catch (e) {
  console.error(`::error::check-inline-styles: cannot scan src/: ${e.message}`);
  process.exit(2);
}

if (WRITE) {
  let prev = null;
  try { prev = JSON.parse(readFileSync(BASELINE, 'utf8')).files || {}; } catch { /* first run: seed */ }

  if (prev) {
    const refused = [];
    for (const [f, now] of Object.entries(current)) {
      const was = prev[f];
      // An unknown file has a ceiling of 0 — same as in the check. Without this
      // `--write` silently blessed any new file at any count, and the failure
      // message pointed straight at it.
      if (was && now.count > was.count) refused.push(`${f}: count ${was.count} → ${now.count} (ceilings only go down)`);
      for (const [k, n] of Object.entries(now.clusters)) {
        const before = was?.clusters?.[k] ?? 0;
        if (n > before) {
          refused.push(`${f}: repeated inline ×${n}${before ? ` (was ${before})` : ' (new)'} — ${k.slice(0, 80)}`);
        }
      }
    }
    if (refused.length) {
      console.error('::error::check-inline-styles: --write is not an escape hatch. Fix the code, not the baseline:');
      refused.forEach((r) => console.error(`  ✗ ${r}`));
      console.error('\n  A repeat belongs in the class (one rule on the EXISTING class), not in this file.');
      process.exit(1);
    }
  }

  writeFileSync(BASELINE, JSON.stringify({
    note: 'CI guard 2l (TRIP-282). Ceilings only go DOWN. Regenerate with: node scripts/ci/check-inline-styles.mjs --write',
    files: current,
  }, null, 2) + '\n');
  console.log(`check-inline-styles: baseline written — ${Object.keys(current).length} files, ${sum(current)} inline objects`);
  process.exit(0);
}

let baseline;
try {
  baseline = JSON.parse(readFileSync(BASELINE, 'utf8')).files || {};
} catch (e) {
  console.error(`::error::check-inline-styles: baseline unreadable (${e.message}). Generate it with --write.`);
  process.exit(2);
}

const errors = [];

for (const [file, now] of Object.entries(current)) {
  const was = baseline[file];
  const ceiling = was ? was.count : 0;

  // R1 — the count ratchet.
  if (now.count > ceiling) {
    errors.push(
      `${file}: ${now.count} inline style objects, ceiling ${ceiling}` +
      (was ? '' : ' (file not in baseline — new files start at 0)') +
      '\n    → move the repeat into the class it belongs to (one rule on the EXISTING class,' +
      '\n      e.g. `button.x {…}` / `.card > .x:only-child {…}`) instead of adding another copy.',
    );
  }

  // R2 — no NEW repeated group, and grandfathered ones may only shrink.
  for (const [k, n] of Object.entries(now.clusters)) {
    const before = was?.clusters?.[k] ?? 0;
    if (before === 0) {
      errors.push(
        `${file}: new repeated inline ×${n} — ${k.slice(0, 90)}` +
        '\n    → that repetition IS the bug: the class should own these declarations.',
      );
    } else if (n > before) {
      errors.push(`${file}: repeated inline grew ${before} → ${n} — ${k.slice(0, 90)}`);
    }
  }
}

if (errors.length) {
  console.error('::error::check-inline-styles: inline styles grew — see rule #6 in CLAUDE.md');
  errors.forEach((e) => console.error(`  ✗ ${e}`));
  console.error('\n  If a cleanup legitimately LOWERED counts, refresh the baseline:');
  console.error('    node scripts/ci/check-inline-styles.mjs --write');
  process.exit(1);
}

console.log(`check-inline-styles: ${sum(current)} inline objects (ceiling ${sum(baseline)}) — OK`);
process.exit(0);
