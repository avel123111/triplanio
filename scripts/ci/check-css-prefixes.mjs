#!/usr/bin/env node
/**
 * CI guard 2m (TRIP-321 Ф0) — a new CSS class-name prefix is a new namespace,
 * and a new namespace needs Pavel's explicit approval.
 *
 * The defect this exists to stop: every screen used to arrive from its own
 * HTML mockup carrying a PRIVATE family of classes (`bgt-*`, `ncal-*`,
 * `chat-*`, …) that re-declares the buttons, rows and tiles the neighbouring
 * screens already have. That is how the app ended up with ~300 namespaces and
 * ~30% of all CSS being re-declarations of the same dozen shapes (TRIP-321
 * audit). Guard 2l closed the inline-style channel; this closes the CSS one.
 *
 * WHAT IT COMPARES. The set of class-name PREFIXES, not counts and not
 * selector text. The prefix of `.bgt-exrow` is `bgt`; of `.btn--ai` — `btn`;
 * a dashless class (`.grow`, `.spin`) is its own prefix. HEAD prefixes come
 * from the CSS files this PR touched; the ceiling is the prefix set of ALL
 * CSS files on the PR base (`git show BASE_REF:<path>`) — global, so moving a
 * family between files, extending an existing family (`.acct-newthing`) and
 * deleting families are all free. Only a prefix name that exists NOWHERE on
 * the base branch is flagged. There is deliberately no committed baseline
 * (see 2l: a ceiling the PR can edit is not a ceiling), and deliberately no
 * keying on selector text — the radius fence died of that (TRIP-321: screen
 * collapses rename selectors in bulk, a text-keyed ratchet blocks exactly the
 * clean-up it was built to protect).
 *
 * Collapsing screens (TRIP-321 Ф3) only ever SHRINKS the set → always green.
 *
 * ESCAPE. A genuinely new family (e.g. the layout primitives of TRIP-321 Ф2)
 * ships with a marker in an ordinary CSS comment in the same PR, visible in
 * the diff at review time — that visibility IS the approval flow:
 *
 *     prefix-exempt: row — примитивы раскладки TRIP-321 Ф2, апрув Pavel
 *
 * Same idiom as `// i18n-ignore` (2d), `-- ddl-guard: allow-destructive`
 * (2b), `design-token-exempt` (2k), `inline-style-exempt` (2l). One marker
 * per prefix; the reason and the approval belong in the marker text.
 *
 * Deliberately dumb: comments and string bodies are blanked, declaration
 * bodies are skipped by a brace walk (so `url(x.png)` and `.5px` never read as
 * classes), classes are a regex over the remaining selector text. No
 * specificity, no cascade — it measures the smell (a new namespace), not
 * correctness. Known blind spot: native CSS nesting (`.a { .b {} }`) — the
 * repo has none, and the day it does this walk must recurse into rule bodies
 * too. What it does and does not catch is written down as executable tests in
 * check-css-prefixes.test.mjs.
 *
 * Env: BASE_REF (default origin/dev). Unresolvable ref → skipped, not
 * guessed. Exit: 0 ok, 1 violation, 2 internal error.
 */
import { execFileSync } from 'node:child_process';
import { readFileSync, existsSync } from 'node:fs';

const BASE_REF = process.env.BASE_REF || 'origin/dev';
const EXEMPT = 'prefix-exempt';
const SCANNED = /\.css$/;

const unknown = process.argv.slice(2).filter((a) => a !== '--');
if (unknown.length) {
  console.error(`::error::check-css-prefixes: unknown flag ${unknown.join(' ')}.`);
  console.error('  There is no baseline to refresh: the ceiling is the base branch.');
  process.exit(2);
}

const git = (args) =>
  execFileSync('git', args, { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024, stdio: ['ignore', 'pipe', 'pipe'] });

/* ------------------------------- scanning -------------------------------- */

/**
 * Blank the bodies of block comments AND of strings, preserving length so
 * nothing shifts. A brace or a dot inside text is not structure, and reading
 * it as structure breaks the guard in both directions: `content: "{"` derails
 * the brace walk so everything after it in the file goes unscanned (a silent
 * green), and `[data-icon=".x"]` reads as a class (a silent red).
 */
function mask(src) {
  const out = src.split('');
  for (let i = 0; i < src.length; i++) {
    if (src[i] === '/' && src[i + 1] === '*') {
      const end = src.indexOf('*/', i + 2);
      const stop = end === -1 ? src.length : end + 2;
      for (; i < stop; i++) if (src[i] !== '\n') out[i] = ' ';
      i--;
    } else if (src[i] === '"' || src[i] === "'") {
      const quote = src[i++];
      // An unterminated string ends at the newline, the way CSS parses it —
      // one typo must not blank the rest of the file.
      while (i < src.length && src[i] !== quote && src[i] !== '\n') {
        if (src[i] === '\\' && src[i + 1] && src[i + 1] !== '\n') out[i++] = ' ';
        out[i++] = ' ';
      }
    }
  }
  return out.join('');
}

/** `.bgt-exrow` → `bgt`; `.btn--ai` → `btn`; `.tm__row` → `tm`; `.grow` → `grow`. */
const prefixOf = (cls) => cls.split(/--|__|-/, 1)[0] || cls;

// Grouping at-rules: their block holds RULES, so the walk must step inside.
// Anything else with a block (@keyframes, @font-face, @page, @property) holds
// declarations and no class selectors, and is skipped whole.
const NESTS = /^@(media|supports|container|layer|scope|starting-style)/i;

// `\.` inside a class name is an escaped dot, not the start of the next class.
const CLASS = /(?<!\\)\.(-?[A-Za-z_][\w-]*)/g;

/**
 * Class names from selector positions only. A brace walk keeps declaration
 * bodies (where `url(x.png)`, `rgba(0,.5,…)` live) out of the selector text.
 */
function classesOf(src) {
  const css = mask(src ?? '');
  const found = new Set();
  let i = 0;
  (function walk(top) {
    let selStart = i;
    while (i < css.length) {
      const ch = css[i];
      if (ch === '}') {
        i++;
        // A stray `}` at the top level is junk (browsers ignore it); treating
        // it as the end of the file would leave the rest unscanned.
        if (!top) return;
        selStart = i;
        continue;
      }
      // `@import …;`, `@charset …;`, `@layer a, b;` — a statement, not the
      // prelude of the rule that follows it.
      if (ch === ';') { i++; selStart = i; continue; }
      if (ch !== '{') { i++; continue; }
      const selector = css.slice(selStart, i).trim();
      i++;
      if (NESTS.test(selector)) {
        walk(false);
      } else {
        let depth = 0;
        while (i < css.length) {
          if (css[i] === '{') depth++;
          else if (css[i] === '}') { if (depth === 0) break; depth--; }
          i++;
        }
        i++; // consume the closing }
        if (!selector.startsWith('@')) {
          for (const m of selector.matchAll(CLASS)) found.add(m[1]);
        }
      }
      selStart = i;
    }
  })(true);
  return found;
}

/** `prefix-exempt: <prefix> — reason` markers, read from raw text (they live in comments). */
function exemptsOf(src) {
  const out = new Set();
  for (const m of (src ?? '').matchAll(new RegExp(`${EXEMPT}:\\s*([A-Za-z_][\\w]*)`, 'g'))) out.add(m[1]);
  return out;
}

/* --------------------------- what this PR touched ------------------------- */

try {
  git(['rev-parse', '--verify', `${BASE_REF}^{commit}`]);
} catch {
  console.log(`check-css-prefixes: BASE_REF ${BASE_REF} not resolvable — skipped (shallow clone / fresh fork).`);
  process.exit(0);
}

// Pathspecs and file reads resolve from cwd; from a subdirectory the guard
// would find nothing and "nothing to check" must never masquerade as "clean".
process.chdir(git(['rev-parse', '--show-toplevel']).trim());

let touched;
try {
  touched = git(['diff', '--name-status', '--find-renames', `${BASE_REF}...HEAD`, '--', 'src/'])
    .split('\n')
    .filter(Boolean)
    .map((line) => {
      const [status, a, b] = line.split('\t');
      if (status.startsWith('D')) return null;
      return status.startsWith('R') ? b : a;
    })
    .filter((p) => p && SCANNED.test(p));
} catch (e) {
  console.error(`::error::check-css-prefixes: cannot diff against ${BASE_REF}: ${e.stderr || e.message}`);
  process.exit(2);
}

if (!touched.length) {
  console.log(`check-css-prefixes: no CSS touched against ${BASE_REF} — nothing to check`);
  process.exit(0);
}

/* -------------------- the ceiling: every prefix on the base --------------- */

const basePrefixes = new Set();
for (const path of git(['ls-tree', '-r', '--name-only', BASE_REF, '--', 'src/'])
  .split('\n')
  .filter((p) => SCANNED.test(p))) {
  for (const cls of classesOf(git(['show', `${BASE_REF}:${path}`]))) basePrefixes.add(prefixOf(cls));
}

/* -------------------------------- verdict --------------------------------- */

const offenders = new Map(); // prefix -> [{file, example}]
const exempted = new Set();

for (const file of touched) {
  if (!existsSync(file)) continue; // deleted between HEAD and the worktree
  const src = readFileSync(file, 'utf8');
  for (const p of exemptsOf(src)) exempted.add(p);
  for (const cls of classesOf(src)) {
    const p = prefixOf(cls);
    if (basePrefixes.has(p)) continue;
    if (!offenders.has(p)) offenders.set(p, []);
    const list = offenders.get(p);
    if (!list.some((o) => o.file === file)) list.push({ file, example: cls });
  }
}
for (const p of exempted) offenders.delete(p);

if (offenders.size) {
  console.error('::error::check-css-prefixes: new CSS namespace(s) — a new prefix needs Pavel\'s approval (rule #6)');
  for (const [p, sites] of offenders) {
    console.error(`  ✗ new prefix "${p}" (e.g. .${sites[0].example} in ${sites.map((s) => s.file).join(', ')})`);
  }
  console.error('    → reuse an existing namespace / the design system (src/design/index.jsx);');
  console.error(`      a genuinely new, approved family ships with /* ${EXEMPT}: <prefix> — причина + апрув */ in the same PR.`);
  process.exit(1);
}

console.log(`check-css-prefixes: ${touched.length} CSS file(s) checked against ${BASE_REF} — no new namespaces`);
process.exit(0);
