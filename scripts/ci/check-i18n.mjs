#!/usr/bin/env node
/**
 * CI guard 2d (TRIP-134, JSON model TRIP-129) — i18n discipline (rule 4). Two checks:
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

/* ------------------------- A. namespace/key integrity ----------------------- */

function checkLocaleKeys() {
  const errors = [];
  if (!existsSync(LOCALES_DIR)) return errors;

  for (const loc of readdirSync(LOCALES_DIR, { withFileTypes: true })) {
    if (!loc.isDirectory()) continue;
    const dir = join(LOCALES_DIR, loc.name);
    const fullKeyToFiles = new Map(); // `ns.key` -> [files]

    for (const f of readdirSync(dir)) {
      if (!f.endsWith('.json')) continue;
      const ns = f.slice(0, -'.json'.length);
      let obj;
      try {
        obj = JSON.parse(readFileSync(join(dir, f), 'utf8'));
      } catch (e) {
        errors.push(`[${loc.name}] ${f}: invalid JSON — ${e.message}`);
        continue;
      }
      for (const bare of Object.keys(obj)) {
        if (bare === ns || bare.startsWith(`${ns}.`)) {
          errors.push(`[${loc.name}] ${f}: key "${bare}" re-encodes its namespace — store it bare (drop the "${ns}." prefix)`);
        }
        const full = `${ns}.${bare}`;
        if (!fullKeyToFiles.has(full)) fullKeyToFiles.set(full, []);
        const arr = fullKeyToFiles.get(full);
        if (!arr.includes(f)) arr.push(f);
      }
    }

    for (const [full, files] of fullKeyToFiles) {
      if (files.length > 1) {
        errors.push(`[${loc.name}] key "${full}" defined in ${files.length} files: ${files.join(', ')}`);
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

let keyErrors, hcErrors;
try {
  keyErrors = checkLocaleKeys();
  hcErrors = checkHardcoded();
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

process.exit(failed ? 1 : 0);
