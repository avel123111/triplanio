#!/usr/bin/env node
/**
 * CI guard 2ac (TRIP-446 Ф1) — namespace ratchet for the SITE design system.
 *
 * `public/site.css` is the one home of the unauthenticated-zone CSS (landing,
 * public shared-trip, legal pages). Guard 2m (check-css-prefixes) only scans
 * `src/`, so site.css had no sentinel at all: any page ported in Ф6 could drag
 * its own private family of classes into the file and re-declare the buttons /
 * rows / tiles the shared primitives already own — the exact TRIP-321 style zoo
 * this rule (#6) exists to stop, just in the folder no guard was watching.
 *
 * WHAT IT COMPARES. The set of class-name PREFIXES in `public/site.css`, HEAD
 * vs base. Same idea as 2m: the prefix of `.auth-card` is `auth`; of
 * `.btn--primary` — `btn`; a dashless class (`.header`) is its own prefix. A
 * prefix that exists NOWHERE in the base version of the file is a new namespace
 * → red. Extending an existing family (`.btn--sm`), renaming selectors in bulk
 * and deleting families are all free — only a genuinely new prefix trips it.
 *
 * ★ BOOTSTRAP. On the PR that introduces this guard the file is `landing.css`
 * on the base and `site.css` on HEAD (TRIP-446 renames it). A guard keyed on
 * the fixed path `public/site.css` would read the base as empty and call EVERY
 * primitive new — red on the very PR that adds it (the sibling guard warns of
 * exactly this: check-design-tokens.mjs:65). So the base side resolves the file
 * by name: `public/site.css` if present, else `public/landing.css`. That map
 * lives until the first merge and then costs nothing.
 *
 * ESCAPE. A genuinely new, approved family ships with a marker in an ordinary
 * CSS comment in the same PR — the diff-time visibility IS the approval flow,
 * same idiom as 2m:
 *
 *     prefix-exempt: auth — примитивы экрана логина Ф6, апрув Pavel
 *
 * Env: BASE_REF (default origin/dev). Unresolvable ref → skipped, not guessed.
 * Exit: 0 ok, 1 violation, 2 internal error. Tests: check-site-prefixes.test.mjs.
 */
import { execFileSync } from 'node:child_process';
import { readFileSync, existsSync } from 'node:fs';

const BASE_REF = process.env.BASE_REF || 'origin/dev';
const EXEMPT = 'prefix-exempt';
const HEAD_PATH = 'public/site.css';
// Base side: the file may still be under its pre-rename name. First hit wins.
const BASE_PATHS = ['public/site.css', 'public/landing.css'];

const unknown = process.argv.slice(2).filter((a) => a !== '--');
if (unknown.length) {
  console.error(`::error::check-site-prefixes: unknown flag ${unknown.join(' ')}.`);
  console.error('  There is no baseline to refresh: the ceiling is the base branch.');
  process.exit(2);
}

const git = (args) =>
  execFileSync('git', args, { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024, stdio: ['ignore', 'pipe', 'pipe'] });

/* ------------------------------- scanning -------------------------------- */
/* mask/classesOf/prefixOf mirror check-css-prefixes.mjs (2m). Copied, not
 * imported: that module runs its whole verdict at import time. */

/**
 * Blank the bodies of block comments AND strings, preserving length. A brace or
 * dot inside text is not structure; reading it as structure breaks the walk in
 * both directions (a `content: "{"` derails it; a `[data-x=".y"]` reads as a
 * class).
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
      while (i < src.length && src[i] !== quote && src[i] !== '\n') {
        if (src[i] === '\\' && src[i + 1] && src[i + 1] !== '\n') out[i++] = ' ';
        out[i++] = ' ';
      }
    }
  }
  return out.join('');
}

/** `.auth-card` → `auth`; `.btn--ai` → `btn`; `.tm__row` → `tm`; `.header` → `header`. */
const prefixOf = (cls) => cls.split(/--|__|-/, 1)[0] || cls;

// The bare `.site` class is the token HOST on <html> (html.site { --tokens }),
// not a component namespace — the site DS's analogue of `:root`. Drop it from
// the prefix maths on BOTH sides so it never becomes a "known prefix"; that way
// a future `.site-foo` family (prefix `site`) is still caught, not blessed by
// the host's mere existence.
const IGNORED = new Set(['site']);

// `\.` inside a class name is an escaped dot, not the start of the next class.
const CLASS = /(?<!\\)\.(-?[A-Za-z_][\w-]*)/g;

/** Class names from prelude (selector) positions only; recurses into every block. */
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
        if (!top) return;
        selStart = i;
        continue;
      }
      if (ch === ';') { i++; selStart = i; continue; }
      if (ch !== '{') { i++; continue; }
      const prelude = css.slice(selStart, i).trim();
      i++;
      if (!prelude.startsWith('@')) {
        for (const m of prelude.matchAll(CLASS)) found.add(m[1]);
      }
      walk(false);
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

const prefixesOf = (src) => {
  const out = new Set();
  for (const cls of classesOf(src)) if (!IGNORED.has(cls)) out.add(prefixOf(cls));
  return out;
};

/* --------------------------------- run ----------------------------------- */

try {
  git(['rev-parse', '--verify', `${BASE_REF}^{commit}`]);
} catch {
  console.log(`check-site-prefixes: BASE_REF ${BASE_REF} not resolvable — skipped (shallow clone / fresh fork).`);
  process.exit(0);
}

// Pathspecs and file reads resolve from cwd; a subdirectory run must not read
// "file absent" as "clean".
process.chdir(git(['rev-parse', '--show-toplevel']).trim());

if (!existsSync(HEAD_PATH)) {
  console.log(`check-site-prefixes: ${HEAD_PATH} absent on HEAD — nothing to check`);
  process.exit(0);
}
const headSrc = readFileSync(HEAD_PATH, 'utf8');

// Base side: try site.css, then the pre-rename landing.css.
let baseSrc = null;
let basePath = null;
for (const p of BASE_PATHS) {
  try {
    baseSrc = git(['show', `${BASE_REF}:${p}`]);
    basePath = p;
    break;
  } catch { /* not at this name on the base — try the next */ }
}
if (baseSrc == null) {
  // The file has no ancestor under either name — it is genuinely brand new, so
  // every prefix is new. That cannot happen once site.css is on the base; log
  // it loudly rather than silently blessing an empty ceiling.
  console.log(`check-site-prefixes: ${HEAD_PATH} has no base version under ${BASE_PATHS.join(' or ')} — treating all prefixes as new`);
  baseSrc = '';
} else if (basePath !== HEAD_PATH) {
  console.log(`check-site-prefixes: base resolved via ${basePath} (pre-rename) — bootstrap map`);
}

const basePrefixes = prefixesOf(baseSrc);
const exempted = exemptsOf(headSrc);

const offenders = new Map(); // prefix -> example class
for (const cls of classesOf(headSrc)) {
  if (IGNORED.has(cls)) continue;
  const p = prefixOf(cls);
  if (basePrefixes.has(p) || exempted.has(p)) continue;
  if (!offenders.has(p)) offenders.set(p, cls);
}

if (offenders.size) {
  console.error('::error::check-site-prefixes: new CSS namespace(s) in public/site.css — a new prefix needs Pavel\'s approval (rule #6)');
  for (const [p, example] of offenders) {
    console.error(`  ✗ new prefix "${p}" (e.g. .${example})`);
  }
  console.error('    → reuse an existing site primitive (btn/header/footer/container/eyebrow) or the app design system;');
  console.error(`      a genuinely new, approved family ships with /* ${EXEMPT}: <prefix> — причина + апрув */ in the same PR.`);
  process.exit(1);
}

console.log(`check-site-prefixes: ${HEAD_PATH} checked against ${BASE_REF} — no new namespaces`);
process.exit(0);
