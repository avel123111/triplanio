#!/usr/bin/env node
/**
 * CI guard 2d (TRIP-134, JSON model TRIP-129) — i18n discipline (rule 4). Four checks:
 *
 * A. NAMESPACE/KEY INTEGRITY (global, blocking). Locales are JSON files at
 *    locales/<loc>/<namespace>.json with BARE keys (the namespace is the file
 *    stem; call-sites use the dotted address `t('namespace.key')`). Enforces:
 *    (1) valid JSON; (2) bare-key invariant — a key inside <ns>.json must NOT
 *    re-encode its namespace (no "ns." prefix), else `t('ns.key')` silently
 *    misses; (3) no full key `ns.key` defined in two files per locale.
 *
 * B. HARDCODED UI STRINGS (PR-diff scoped, blocking). Every NEW user-facing string
 *    must go through t(), not be hardcoded in JSX. Scanning the whole tree would
 *    drown in legacy debt, so this checks only ADDED lines in this PR (src .jsx/.js):
 *    JSX text nodes and the user-facing attributes placeholder/title/aria-label/alt.
 *    Escape a legitimate literal with a trailing `// i18n-ignore` on the line.
 *
 * C. BACKEND-EMITTED KEYS RESOLVE (global, blocking). Notifications carry their key
 *    in the DB (notifications.i18n_title_key / i18n_message_key / i18n_params.role_key)
 *    and the Inbox resolves it at render time via t(n.i18n_title_key). Such a key
 *    therefore exists ONLY as a literal in an edge function or a migration — it never
 *    appears in src/ — so a "which keys does the frontend reference?" sweep looks
 *    straight past it. TRIP-299: a dead-key cleanup deleted the whole notif.tpl_*
 *    family and prod rendered raw keys in the inbox (including Pro payment notices).
 *    Every quoted `<namespace>.<key>` literal in the backend must resolve in every
 *    locale, where <namespace> is an existing locale file stem.
 *
 * D. FRONTEND LITERAL KEYS RESOLVE (global, blocking). The mirror of C for src/:
 *    every literal `t('ns.key')` call-site must resolve in every locale. That same
 *    sweep (TRIP-296) also dropped a key that IS referenced plainly in src
 *    (`event.show_on_map`, EventViewBody), so the "does the frontend use it?" pass
 *    cannot be trusted on its own either. Dynamic keys (t('pre_' + x), template
 *    literals) are deliberately out of scope here — the closing quote must end the
 *    argument — since their families cannot be resolved statically.
 *
 * Env: BASE_REF (default origin/dev).
 * Exit: 0 ok, 1 violation, 2 internal error.
 */
import { execFileSync } from 'node:child_process';
import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { join } from 'node:path';

const BASE_REF = process.env.BASE_REF || 'origin/dev';
const LOCALES_DIR = 'src/lib/i18n/locales';
// Backend sources that may emit an i18n key. `migrations_legacy` is deliberately
// excluded — it is frozen history (pre-TRIP-68 baseline) and never runs again.
const BACKEND_DIRS = ['supabase/functions', 'supabase/migrations'];

function git(args) {
  return execFileSync('git', args, { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
}

// Commented-out code and doc examples are prose, not call-sites — checks B and D
// both skip such lines (e.g. the `t('namespace.key')` example in i18n/dictionary.js).
function isCommentLine(text) {
  const s = text.trim();
  return s.startsWith('//') || s.startsWith('*') || s.startsWith('/*');
}

/* ----------------------------- locales on disk ------------------------------ */

// One pass over locales/<loc>/<ns>.json — the single place that knows the layout
// (directory = locale, file stem = namespace). `keys` is null when the file is not
// valid JSON: check A reports that, check C just skips the file.
// Returns locale -> [{ file, ns, keys, parseError }] (a locale with no JSON maps to []).
function readLocales() {
  const byLocale = new Map();
  if (!existsSync(LOCALES_DIR)) return byLocale;

  for (const loc of readdirSync(LOCALES_DIR, { withFileTypes: true })) {
    if (!loc.isDirectory()) continue;
    const files = [];
    byLocale.set(loc.name, files);
    for (const f of readdirSync(join(LOCALES_DIR, loc.name))) {
      if (!f.endsWith('.json')) continue;
      let keys = null;
      let parseError = null;
      try {
        keys = Object.keys(JSON.parse(readFileSync(join(LOCALES_DIR, loc.name, f), 'utf8')));
      } catch (e) {
        parseError = e.message;
      }
      files.push({ file: f, ns: f.slice(0, -'.json'.length), keys, parseError });
    }
  }
  return byLocale;
}

/* ------------------------- A. namespace/key integrity ----------------------- */

function checkLocaleKeys() {
  const errors = [];

  for (const [locale, entries] of readLocales()) {
    const fullKeyToFiles = new Map(); // `ns.key` -> [files]

    for (const { file: f, ns, keys, parseError } of entries) {
      if (parseError) {
        errors.push(`[${locale}] ${f}: invalid JSON — ${parseError}`);
        continue;
      }
      for (const bare of keys) {
        if (bare === ns || bare.startsWith(`${ns}.`)) {
          errors.push(`[${locale}] ${f}: key "${bare}" re-encodes its namespace — store it bare (drop the "${ns}." prefix)`);
        }
        const full = `${ns}.${bare}`;
        if (!fullKeyToFiles.has(full)) fullKeyToFiles.set(full, []);
        const arr = fullKeyToFiles.get(full);
        if (!arr.includes(f)) arr.push(f);
      }
    }

    for (const [full, files] of fullKeyToFiles) {
      if (files.length > 1) {
        errors.push(`[${locale}] key "${full}" defined in ${files.length} files: ${files.join(', ')}`);
      }
    }
  }
  return errors;
}

/* --------------------------- B. hardcoded UI strings ------------------------ */

// Added lines (with new-file line numbers) for src .jsx/.js changed in this PR.
function addedLines() {
  const diff = git(['diff', `${BASE_REF}...HEAD`, '--', 'src/**/*.jsx', 'src/**/*.js']);
  const out = [];
  let file = null;
  let lineNo = 0;
  for (const line of diff.split('\n')) {
    if (line.startsWith('+++ b/')) {
      file = line.slice(6);
      continue;
    }
    const hunk = line.match(/^@@ -\d+(?:,\d+)? \+(\d+)(?:,\d+)? @@/);
    if (hunk) {
      lineNo = parseInt(hunk[1], 10);
      continue;
    }
    if (line.startsWith('+') && !line.startsWith('+++')) {
      out.push({ file, lineNo, text: line.slice(1) });
      lineNo++;
    } else if (!line.startsWith('-') && !line.startsWith('\\')) {
      lineNo++; // context line advances the new-file counter
    }
  }
  return out;
}

// A literal is "user-facing" if it has real words: >=2 consecutive letters AND
// (a space, OR Word-case, OR non-ASCII letters). Excludes code-ish tokens
// (flex-start, auto, someVar) which carry none of those.
function isUserFacing(s) {
  const str = s.trim();
  if (!/[A-Za-zÀ-ÿА-Яа-яЁё]{2,}/.test(str)) return false;
  if (/\s/.test(str)) return true;
  if (/[A-ZÀ-Þ][a-zà-ÿ]/.test(str)) return true; // Word-case
  if (/[А-Яа-яЁё]/.test(str)) return true; // Cyrillic
  return false;
}

const TEXT_NODE_RE = />([^<>{}]+)</g;
const ATTR_RE = /\b(placeholder|title|aria-label|alt)\s*=\s*"([^"]+)"/g;

function checkHardcoded() {
  const errors = [];
  for (const { file, lineNo, text } of addedLines()) {
    if (/i18n-ignore/.test(text)) continue;
    if (isCommentLine(text)) continue;

    let m;
    TEXT_NODE_RE.lastIndex = 0;
    while ((m = TEXT_NODE_RE.exec(text))) {
      if (isUserFacing(m[1])) errors.push(`${file}:${lineNo}: hardcoded JSX text "${m[1].trim()}"`);
    }
    ATTR_RE.lastIndex = 0;
    while ((m = ATTR_RE.exec(text))) {
      if (isUserFacing(m[2])) errors.push(`${file}:${lineNo}: hardcoded ${m[1]} "${m[2]}"`);
    }
  }
  return errors;
}

/* -------------- shared by checks C and D: key index + file walk ------------- */

// `ns.key` -> Set(locales defining it), plus the namespace vocabulary and the
// locale list. A file that failed to parse still contributes its namespace (the
// stem is the filename); its keys are simply unknown here — check A is what
// reports the broken JSON.
function buildKeyIndex() {
  const byLocale = readLocales();
  const keyToLocales = new Map();
  const namespaces = new Set();
  for (const [locale, entries] of byLocale) {
    for (const { ns, keys } of entries) {
      namespaces.add(ns);
      for (const bare of keys ?? []) {
        const full = `${ns}.${bare}`;
        if (!keyToLocales.has(full)) keyToLocales.set(full, new Set());
        keyToLocales.get(full).add(locale);
      }
    }
  }
  return { keyToLocales, namespaces, locales: [...byLocale.keys()] };
}

// Locales that do not define `full`, i.e. where t() would fall through to the
// raw key. Empty array = resolves everywhere.
function missingLocales({ keyToLocales, locales }, full) {
  const have = keyToLocales.get(full);
  return locales.filter((l) => !have?.has(l));
}

function* walk(dir, extRe) {
  if (!existsSync(dir)) return;
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    const p = join(dir, e.name);
    if (e.isDirectory()) yield* walk(p, extRe);
    else if (extRe.test(e.name)) yield p;
  }
}

/* ------------------- C. backend-emitted keys resolve ------------------------ */

function checkBackendKeys(index) {
  const errors = [];
  const { namespaces } = index;
  if (!namespaces.size) return errors;

  // Single-quoted `ns.key` where ns is a real locale namespace. Anchoring on the
  // namespace vocabulary is what keeps this quiet: SQL schema qualifiers
  // (public.foo, auth.users) are bare identifiers, not quoted string literals.
  const nsAlt = [...namespaces].sort().join('|');
  const litRe = new RegExp(`'((?:${nsAlt})\\.[A-Za-z0-9_]+)'`, 'g');

  for (const dir of BACKEND_DIRS) {
    for (const file of walk(dir, /\.(ts|sql)$/)) {
      const text = readFileSync(file, 'utf8');
      litRe.lastIndex = 0;
      let m;
      const seen = new Set();
      while ((m = litRe.exec(text))) {
        const full = m[1];
        if (seen.has(full)) continue;
        seen.add(full);
        const missing = missingLocales(index, full);
        if (missing.length) {
          errors.push(`${file}: emits "${full}" — missing in locale(s): ${missing.join(', ')}`);
        }
      }
    }
  }
  return errors;
}

/* ------------------- D. frontend literal keys resolve ----------------------- */

// A literal `t('ns.key')` call — the closing quote must end the argument (`)` or
// `,`), which is what excludes a dynamic prefix like t('notif.booking_kind_' + k)
// and template-built keys: those families cannot be resolved statically, so they
// are left to their own literal call-sites.
const T_LITERAL_RE = /\bt\(\s*(["'])([a-z0-9_]+\.[A-Za-z0-9_]+)\1\s*[,)]/g;

function checkFrontendKeys(index) {
  const errors = [];
  const { namespaces } = index;

  for (const file of walk('src', /\.(jsx|js)$/)) {
    const lines = readFileSync(file, 'utf8').split('\n');
    for (const [i, line] of lines.entries()) {
      if (isCommentLine(line)) continue;
      let m;
      T_LITERAL_RE.lastIndex = 0;
      while ((m = T_LITERAL_RE.exec(line))) {
        const full = m[2];
        if (!namespaces.has(full.split('.')[0])) continue; // dotted literal, but not an i18n address
        const missing = missingLocales(index, full);
        if (missing.length) {
          errors.push(`${file}:${i + 1}: t("${full}") — missing in locale(s): ${missing.join(', ')}`);
        }
      }
    }
  }
  return errors;
}

/* ---------------------------------- run ------------------------------------ */

let keyErrors, hcErrors, backendErrors, frontendErrors;
try {
  const index = buildKeyIndex(); // read the locales once, share with C and D
  keyErrors = checkLocaleKeys();
  hcErrors = checkHardcoded();
  backendErrors = checkBackendKeys(index);
  frontendErrors = checkFrontendKeys(index);
} catch (e) {
  console.error(`::error::i18n guard internal error: ${e.message}`);
  process.exit(2);
}

let failed = false;

if (keyErrors.length) {
  failed = true;
  console.error('::error::i18n namespace/key integrity guard failed (bare keys, one file per `ns.key`, valid JSON):');
  for (const e of keyErrors) console.error(`  ✗ ${e}`);
} else {
  console.log('check-i18n: namespace/key integrity — OK');
}

if (hcErrors.length) {
  failed = true;
  console.error('::error::i18n hardcoded-string guard failed (route UI strings through t(), or add `// i18n-ignore`):');
  for (const e of hcErrors) console.error(`  ✗ ${e}`);
} else {
  console.log('check-i18n: no new hardcoded UI strings — OK');
}

if (backendErrors.length) {
  failed = true;
  console.error('::error::i18n backend-key guard failed (an edge function / migration emits a key that no longer resolves — the UI would render the raw key):');
  for (const e of backendErrors) console.error(`  ✗ ${e}`);
} else {
  console.log('check-i18n: backend-emitted keys resolve — OK');
}

if (frontendErrors.length) {
  failed = true;
  console.error('::error::i18n frontend-key guard failed (a t() call-site references a key that no longer resolves — the UI would render the raw key):');
  for (const e of frontendErrors) console.error(`  ✗ ${e}`);
} else {
  console.log('check-i18n: frontend literal keys resolve — OK');
}

process.exit(failed ? 1 : 0);
