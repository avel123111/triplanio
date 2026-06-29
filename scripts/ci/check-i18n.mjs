#!/usr/bin/env node
/**
 * CI guard 2d (TRIP-134) — i18n discipline (rule 4). Two checks:
 *
 * A. DUPLICATE KEYS (global, blocking). Each translation key must live in exactly
 *    ONE namespace file per locale. A key defined in two namespaces (e.g. trip.js
 *    AND ai_plan.js) is a bug: the last spread in locales/<loc>/index.js silently
 *    wins and the other copy is dead/conflicting. Scans every namespace file in
 *    every locale at HEAD (parser-free — keys are flat quoted strings).
 *
 * B. HARDCODED UI STRINGS (PR-diff scoped, blocking). Every NEW user-facing string
 *    must go through t(), not be hardcoded in JSX. Scanning the whole tree would
 *    drown in legacy debt, so this checks only ADDED lines in this PR (src .jsx/.js):
 *    JSX text nodes and the user-facing attributes placeholder/title/aria-label/alt.
 *    Escape a legitimate literal with a trailing `// i18n-ignore` on the line.
 *
 * Env: BASE_REF (default origin/dev).
 * Exit: 0 ok, 1 violation, 2 internal error.
 */
import { execFileSync } from 'node:child_process';
import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { join } from 'node:path';

const BASE_REF = process.env.BASE_REF || 'origin/dev';
const LOCALES_DIR = 'src/lib/i18n/locales';

function git(args) {
  return execFileSync('git', args, { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
}

/* ----------------------------- A. duplicate keys ---------------------------- */

const KEY_RE = /^\s*(['"])([^'"]+)\1\s*:/;

function checkDuplicateKeys() {
  const errors = [];
  if (!existsSync(LOCALES_DIR)) return errors;

  for (const loc of readdirSync(LOCALES_DIR, { withFileTypes: true })) {
    if (!loc.isDirectory()) continue;
    const dir = join(LOCALES_DIR, loc.name);
    const keyToFiles = new Map(); // key -> [namespace files]

    for (const f of readdirSync(dir)) {
      if (!f.endsWith('.js') || f === 'index.js') continue;
      const content = readFileSync(join(dir, f), 'utf8');
      for (const line of content.split('\n')) {
        const m = line.match(KEY_RE);
        if (!m) continue;
        const key = m[2];
        if (!keyToFiles.has(key)) keyToFiles.set(key, []);
        const arr = keyToFiles.get(key);
        if (!arr.includes(f)) arr.push(f);
      }
    }

    for (const [key, files] of keyToFiles) {
      if (files.length > 1) {
        errors.push(`[${loc.name}] key "${key}" defined in ${files.length} namespaces: ${files.join(', ')}`);
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
    const trimmed = text.trim();
    if (trimmed.startsWith('//') || trimmed.startsWith('*') || trimmed.startsWith('/*')) continue;

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

/* ---------------------------------- run ------------------------------------ */

let dupErrors, hcErrors;
try {
  dupErrors = checkDuplicateKeys();
  hcErrors = checkHardcoded();
} catch (e) {
  console.error(`::error::i18n guard internal error: ${e.message}`);
  process.exit(2);
}

let failed = false;

if (dupErrors.length) {
  failed = true;
  console.error('::error::i18n duplicate-key guard failed (a key must live in ONE namespace per locale):');
  for (const e of dupErrors) console.error(`  ✗ ${e}`);
} else {
  console.log('check-i18n: no duplicate keys — OK');
}

if (hcErrors.length) {
  failed = true;
  console.error('::error::i18n hardcoded-string guard failed (route UI strings through t(), or add `// i18n-ignore`):');
  for (const e of hcErrors) console.error(`  ✗ ${e}`);
} else {
  console.log('check-i18n: no new hardcoded UI strings — OK');
}

process.exit(failed ? 1 : 0);
