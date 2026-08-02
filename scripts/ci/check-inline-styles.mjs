#!/usr/bin/env node
/**
 * CI guard 2l (TRIP-282) — inline styles may not grow, and may not repeat.
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
 * The fix is one element- or context-scoped rule on the existing class
 * (`button.x { … }`) — a rule on an existing class needs no approval; a new
 * class NAME does (rule #6).
 *
 * WHAT IT COMPARES. Only the files this PR touched, against the SAME files on
 * the PR base (`git show BASE_REF:<path>`), exactly as guards 2d/2g/2k do.
 * There is deliberately no committed baseline: the first cut of this guard kept
 * per-file ceilings in `scripts/ci/inline-style-baseline.json`, and since the PR
 * could edit that file, the "ratchet" could be raised by hand, reset by deleting
 * it, and skipped entirely for new files. All three shipped green. The ceiling
 * has to live somewhere the PR cannot reach, and that is the base branch.
 * (Guard 2k says the same in one line: "a count alone is bypassable".)
 *
 * Two rules, per touched file:
 *
 *   R1 (ratchet)  The number of inline style objects may not exceed the number
 *                 on the base branch. A file ADDED in this PR has a base of 0 —
 *                 new code does not get to be born dirty (that is precisely how
 *                 ManualPlanner.jsx arrived with 145 of them, TRIP-321).
 *   R2 (repeats)  No group of MIN_CLUSTER+ byte-identical inline objects that
 *                 was not already that large on the base. Existing groups are
 *                 grandfathered and may only shrink. R2 exists because R1 alone
 *                 misses the actual defect: turning five unique inlines into
 *                 five copies of one does not change the count.
 *
 * ESCAPE. Some inline styles cannot become a class because the value comes from
 * data (`width` from a percentage, a category colour). Mark the line:
 *
 *     <i style={{ width: pct(r) }}/>  // inline-style-exempt: ширина из данных
 *
 * Same idiom as `// i18n-ignore` (2d), `-- ddl-guard: allow-destructive` (2b),
 * `design-token-exempt` (2k): visible in the diff, carries its reason next to
 * the code. The marker is read on any line the style spans, or the line right
 * after it. Splitting an existing component into a new file is the one case
 * where a pile of these is legitimate — say so in the reasons.
 *
 * Deliberately dumb: a regex over source text with comments blanked out, no
 * parse. It measures the smell (hand-written repetition), not correctness.
 *
 * Tested end to end in check-inline-styles.test.mjs — including all three
 * bypasses above, which is what the first cut lacked.
 *
 * Env: BASE_REF (default origin/dev). Unresolvable ref → skipped, not guessed.
 * Exit: 0 ok, 1 violation, 2 internal error.
 */
import { execFileSync } from 'node:child_process';
import { readFileSync, existsSync } from 'node:fs';

const BASE_REF = process.env.BASE_REF || 'origin/dev';
const MIN_CLUSTER = 3;
const EXEMPT = 'inline-style-exempt';
const SCANNED = /\.(jsx|tsx|js)$/;

// `style={{ … }}` — an inline OBJECT LITERAL. `style={someVar}` is not counted:
// a named object is already a shared thing, which is the direction we want.
const INLINE = /style=\{\{[\s\S]*?\}\}/g;

const unknown = process.argv.slice(2).filter((a) => a !== '--');
if (unknown.length) {
  console.error(`::error::check-inline-styles: unknown flag ${unknown.join(' ')}.`);
  console.error('  There is no --write and no baseline to refresh: the ceiling is the base branch.');
  process.exit(2);
}

const git = (args) =>
  execFileSync('git', args, { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024, stdio: ['ignore', 'pipe', 'ignore'] });

/* ------------------------------- scanning -------------------------------- */

/** Blank out comments, preserving length and newlines so offsets stay valid.
 *  `//` is ignored when preceded by `:` so that `https://…` inside a string is
 *  not read as the start of a comment. */
function blankComments(src) {
  const out = src.split('');
  for (let i = 0; i < src.length; i++) {
    if (src[i] === '/' && src[i + 1] === '/' && src[i - 1] !== ':') {
      while (i < src.length && src[i] !== '\n') out[i++] = ' ';
    } else if (src[i] === '/' && src[i + 1] === '*') {
      const end = src.indexOf('*/', i + 2);
      const stop = end === -1 ? src.length : end + 2;
      for (; i < stop; i++) if (src[i] !== '\n') out[i] = ' ';
      i--;
    }
  }
  return out.join('');
}

/** Collapse numbers so `padding: 13px` and `padding: 14px` cluster together —
 *  the smell is the repeated SHAPE, not the exact value. Whitespace is DROPPED,
 *  not squeezed, so a reformat does not read as a brand-new repeat. */
const shape = (s) => s.replace(/\s+/g, '').replace(/-?\d+(\.\d+)?/g, 'N');

/** Inline style objects in one file, minus the ones inside comments and the
 *  ones a nearby `inline-style-exempt: reason` accounts for. */
function scan(src) {
  if (!src) return { count: 0, clusters: {} };
  const masked = blankComments(src);
  const lineOf = (idx) => src.slice(0, idx).split('\n').length - 1;
  const lines = src.split('\n');

  const clusters = {};
  let count = 0;
  for (const m of masked.matchAll(INLINE)) {
    const from = lineOf(m.index);
    const to = lineOf(m.index + m[0].length);
    // The reason may sit on any line the style spans, or on the line after it.
    let exempt = false;
    for (let l = from; l <= to + 1 && l < lines.length; l++) {
      if (lines[l].includes(EXEMPT)) exempt = true;
    }
    if (exempt) continue;
    count++;
    const k = shape(m[0]);
    clusters[k] = (clusters[k] || 0) + 1;
  }
  return { count, clusters };
}

/* --------------------------- what this PR touched ------------------------- */

try {
  git(['rev-parse', '--verify', `${BASE_REF}^{commit}`]);
} catch {
  console.log(`check-inline-styles: BASE_REF ${BASE_REF} not resolvable — skipped (shallow clone / fresh fork).`);
  process.exit(0);
}

let touched;
try {
  // --find-renames so `git mv` of an untouched file is not read as "a brand-new
  // file full of inline styles" — that was a guaranteed red CI on a pure rename.
  touched = git(['diff', '--name-status', '--find-renames', `${BASE_REF}...HEAD`, '--', 'src/'])
    .split('\n')
    .filter(Boolean)
    .map((line) => {
      const [status, a, b] = line.split('\t');
      if (status.startsWith('R')) return { path: b, base: a };
      if (status.startsWith('D')) return null;
      return { path: a, base: status === 'A' ? null : a };
    })
    .filter((f) => f && SCANNED.test(f.path));
} catch (e) {
  console.error(`::error::check-inline-styles: cannot diff against ${BASE_REF}: ${e.message}`);
  process.exit(2);
}

const baseContent = (path) => {
  if (!path) return null;
  try {
    return git(['show', `${BASE_REF}:${path}`]);
  } catch {
    return null;
  }
};

/* -------------------------------- verdict --------------------------------- */

const errors = [];
let scanned = 0;

for (const file of touched) {
  if (!existsSync(file.path)) continue; // deleted between HEAD and the worktree
  const now = scan(readFileSync(file.path, 'utf8'));
  const was = scan(baseContent(file.base));
  scanned++;

  // R1 — the count ratchet.
  if (now.count > was.count) {
    errors.push(
      `${file.path}: ${now.count} inline style objects, ${file.base ? `${was.count} on ${BASE_REF}` : 'new file (base 0)'}` +
      '\n    → move the declarations into the class they belong to (one rule on the EXISTING' +
      '\n      class, e.g. `button.x {…}`). If the value comes from data and no class can own' +
      `\n      it, mark the line: // ${EXEMPT}: <reason>`,
    );
  }

  // R2 — no NEW repeated group; grandfathered ones may only shrink.
  for (const [k, n] of Object.entries(now.clusters)) {
    if (n < MIN_CLUSTER) continue;
    const before = was.clusters[k] ?? 0;
    if (before < MIN_CLUSTER) {
      errors.push(
        `${file.path}: ${n} identical inline styles — ${k.slice(0, 90)}` +
        '\n    → that repetition IS the defect: the class should own these declarations.',
      );
    } else if (n > before) {
      errors.push(`${file.path}: identical inline styles grew ${before} → ${n} — ${k.slice(0, 90)}`);
    }
  }
}

if (errors.length) {
  console.error('::error::check-inline-styles: inline styles grew — see rule #6 in CLAUDE.md');
  errors.forEach((e) => console.error(`  ✗ ${e}`));
  process.exit(1);
}

console.log(`check-inline-styles: ${scanned} changed file(s) checked against ${BASE_REF} — OK`);
process.exit(0);
