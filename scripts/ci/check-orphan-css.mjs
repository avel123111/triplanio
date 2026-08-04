#!/usr/bin/env node
/**
 * CI guard 2n (TRIP-321 Ф14.11) — you may not leave a rule pointing at a class
 * you just stopped emitting.
 *
 * THE DEFECT. Unification moves markup onto a shared class. The private rules of
 * the old name stay in the stylesheet, now matching nothing — and whatever they
 * held goes with them, silently. Found four times in ONE PR: a status dot
 * rendered 0×0, transfer-chip icons doubled from 12 to 24px, a cookie-banner
 * button stopped wrapping, budget chips changed typographic tier. Lint,
 * typecheck, build and guards 2k/2l/2m were all green.
 *
 * It is invisible on purpose: the diff shows the line you ADDED, never the rule
 * left off-screen in another file. Nothing in the toolchain links a class name
 * in markup to a selector in CSS, so "no longer emitted" is not an error
 * anywhere — it is silence. This guard is the only thing that reads both sides.
 *
 * WHAT IT ASKS, precisely one question per class:
 *
 *     this name was a LITERAL in the markup on the base branch,
 *     it is a literal nowhere in the markup on HEAD,
 *     and a CSS rule for it still exists on HEAD.
 *
 * That triple is the defect and nothing else is. Two consequences worth knowing:
 *
 *   · A composed name (`sev--${level}`, `dl-ftag--${kind}`) was never a literal,
 *     so it can never be reported. That is what keeps this guard quiet — a scan
 *     of "declared but not found" drowns in those; this one cannot see them.
 *   · A modifier declared ahead of its first call (a parity step of the gap
 *     scale) is not reported either: it was not in the base markup. Half-ladder
 *     hygiene is a different problem, and it is written down where it belongs.
 *
 * REMOVING the rule together with the usage is the correct edit and passes. So
 * does moving the declaration onto the class that survives — which is the point:
 * the object gets declared once, not re-homed under a private name.
 *
 * ESCAPE. A class can be emitted by something this repo cannot see (a third
 * party widget, a CMS payload). Say so in the stylesheet, next to the rule:
 *
 *     /* orphan-exempt: vpill — ставит виджет платёжной формы *​/
 *
 * Same idiom as `i18n-ignore` (2d), `inline-style-exempt` (2l),
 * `prefix-exempt` (2m): visible in the diff, carrying its reason.
 *
 * Deliberately dumb: text, not a parse. Candidates are the identifiers on the
 * REMOVED lines of the markup diff, intersected with the class names declared on
 * HEAD — no attempt to understand JSX. What it does and does not catch is
 * written down as executable tests, in check-orphan-css.test.mjs.
 *
 * Env: BASE_REF (default origin/dev). Unresolvable ref → skipped, not guessed.
 * Exit: 0 ok, 1 violation, 2 internal error.
 */
import { execFileSync } from 'node:child_process';
import { readFileSync, existsSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';

const BASE_REF = process.env.BASE_REF || 'origin/dev';
const EXEMPT = 'orphan-exempt';
const MARKUP = /\.(jsx|tsx|js|ts|html)$/;
const ROOTS = ['src', 'public', 'index.html'];

const unknown = process.argv.slice(2).filter((a) => a !== '--');
if (unknown.length) {
  console.error(`::error::check-orphan-css: unknown flag ${unknown.join(' ')}.`);
  console.error(`  There is nothing to refresh: the ceiling is the base branch. To allow one class,`);
  console.error(`  put \`${EXEMPT}: <class> — reason\` in the stylesheet next to the rule.`);
  process.exit(2);
}

const git = (args) =>
  execFileSync('git', args, { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024, stdio: ['ignore', 'pipe', 'pipe'] });

/* -------------------------------- reading --------------------------------- */

/** Blank out /* … *​/ preserving length and newlines, so offsets and line
 *  numbers stay valid. Not cosmetic: this repo's CSS comments quote JSX, so they
 *  contain `{` and `}`. Skip this and a rule regex desynchronises for the rest
 *  of the file — every rule after the first such comment becomes invisible, and
 *  the guard reports a clean tree. That is not hypothetical; it is why this
 *  scan had to be written twice. */
function blankComments(css) {
  const out = css.split('');
  for (let i = 0; i < css.length; i++) {
    if (css[i] === '/' && css[i + 1] === '*') {
      const end = css.indexOf('*/', i + 2);
      const stop = end === -1 ? css.length : end + 2;
      for (; i < stop; i++) if (css[i] !== '\n') out[i] = ' ';
      i--;
    }
  }
  return out.join('');
}

function walk(root, hit) {
  if (!existsSync(root)) return;
  if (statSync(root).isFile()) return hit(root);
  for (const e of readdirSync(root, { withFileTypes: true })) {
    if (e.name === 'node_modules' || e.name.startsWith('.')) continue;
    walk(join(root, e.name), hit);
  }
}

const files = { css: [], markup: [] };
const collect = () => {
  files.css.length = files.markup.length = 0;
  for (const r of ROOTS)
    walk(r, (p) => {
      if (p.endsWith('.css')) files.css.push(p);
      else if (MARKUP.test(p)) files.markup.push(p);
    });
};

/** Every class name a selector mentions, with the first place it is written.
 *  Rules nested in `@media` are reached because the split is innermost-first:
 *  `[^{}]+\{[^{}]*\}` cannot span a brace, so it lands on the inner rule. */
function classesInCss(paths) {
  const where = new Map(); // class → "file:line"
  const exempt = new Set();
  for (const path of paths) {
    const raw = readFileSync(path, 'utf8');
    for (const m of raw.matchAll(new RegExp(`${EXEMPT}\\s*:\\s*\\.?([A-Za-z][\\w-]*)`, 'g'))) exempt.add(m[1]);
    const css = blankComments(raw);
    for (const rule of css.matchAll(/([^{}]+)\{[^{}]*\}/g)) {
      const sel = rule[1].trim();
      if (!sel || sel.startsWith('@')) continue;
      const line = css.slice(0, rule.index).split('\n').length;
      for (const c of sel.matchAll(/\.([A-Za-z][\w-]*)/g))
        if (!where.has(c[1])) where.set(c[1], `${path}:${line}`);
    }
  }
  return { where, exempt };
}

const identifiers = (text) => new Set(text.match(/[A-Za-z][\w-]*/g) || []);

/* --------------------------------- verdict -------------------------------- */

try {
  git(['rev-parse', '--verify', `${BASE_REF}^{commit}`]);
} catch {
  console.log(`check-orphan-css: BASE_REF ${BASE_REF} not resolvable — skipped (shallow clone / fresh fork).`);
  process.exit(0);
}

// Every path below is relative to the repo root. Run from a subdirectory without
// this and the scan finds no files and reports OK — "nothing to check" must
// never print the same verdict as "checked, clean" (the bug guard 2l shipped with).
process.chdir(git(['rev-parse', '--show-toplevel']).trim());
collect();

let removedLines;
try {
  removedLines = git(['diff', '--find-renames', '--unified=0', `${BASE_REF}...HEAD`, '--', ...ROOTS])
    .split('\n')
    .filter((l) => l.startsWith('-') && !l.startsWith('---'))
    .join('\n');
} catch (e) {
  console.error(`::error::check-orphan-css: cannot diff against ${BASE_REF}: ${e.stderr || e.message}`);
  process.exit(2);
}

const { where, exempt } = classesInCss(files.css);
// A name is only a candidate if the PR REMOVED it from somewhere and CSS still
// declares it. Everything else is noise by construction.
const candidates = [...identifiers(removedLines)].filter((c) => where.has(c) && !exempt.has(c));

let orphans = [];
if (candidates.length) {
  const live = identifiers(files.markup.map((p) => readFileSync(p, 'utf8')).join('\n'));
  orphans = candidates.filter((c) => !live.has(c)).sort();
}

if (orphans.length) {
  console.error('::error::check-orphan-css: rule(s) left pointing at a class nobody emits any more');
  for (const c of orphans) console.error(`  ✗ .${c} — ${where.get(c)}`);
  console.error(
    '\n  Разметка перестала писать это имя, а правило осталось - вместе с ним молча ушло то,' +
    '\n  что оно держало (размер, отступ, перенос строки). В диффе этого не видно.' +
    '\n  → перенеси объявление на класс, который ОСТАЛСЯ (правило на существующем классе' +
    '\n    апрува не требует), либо удали правило вместе с именем.' +
    `\n  → если имя ставит что-то вне этого репозитория: /* ${EXEMPT}: <класс> — причина */`,
  );
  process.exit(1);
}

console.log(
  candidates.length
    ? `check-orphan-css: ${candidates.length} removed class name(s) checked against ${BASE_REF} — all still emitted`
    : `check-orphan-css: no declared class left the markup against ${BASE_REF} — nothing to check`,
);
process.exit(0);
