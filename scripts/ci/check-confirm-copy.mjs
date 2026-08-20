#!/usr/bin/env node
/**
 * CI guard 2ab — every confirm() carries an accessible name AND a description.
 *
 * Policy: the app-wide promise-based `confirm({...})` (useConfirm → ConfirmDialog,
 * a Radix alert-dialog) MUST be given both a `title` and a `description`. Without
 * a description Radix logs "Missing `Description` or `aria-describedby`" on every
 * open (a real a11y gap for screen-reader users), and a title-less dialog has no
 * accessible name at all. ConfirmDialog carries a runtime opt-out so the warning
 * can never fire, but the opt-out is a safety net — the contract is that a caller
 * ALWAYS supplies real copy. This guard makes "a confirm without a title or a
 * description" structurally unrepresentable: a call site missing either key fails
 * the PR.
 *
 * This is a self-consistency invariant over the whole `src/` tree (like 2e/2f),
 * not a diff. It scans the inline-object form `confirm({ … })` — the useConfirm
 * signature; `window.confirm(string)` takes no object and is not matched. A call
 * that passes a variable instead of an inline literal (`confirm(opts)`) is not
 * matched either — that path is vanishingly rare here and deliberately out of
 * scope rather than guessed at.
 *
 * Exit: 0 ok, 1 violation, 2 internal error.
 */
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';

const ROOT = 'src';

// The seam files themselves name `title`/`description` in JSDoc examples and in
// the prop plumbing — they define the contract, they don't call it.
const SKIP = new Set([
  'src/components/common/ConfirmProvider.jsx',
  'src/components/common/ConfirmDialog.jsx',
]);

function walk(dir, out = []) {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    const s = statSync(p);
    if (s.isDirectory()) walk(p, out);
    else if (/\.(jsx?|tsx?)$/.test(name)) out.push(p);
  }
  return out;
}

// Given source and the index of the `{` that opens a confirm() options object,
// return the set of its DEPTH-1 keys (identifiers or quoted strings followed by
// `:`). Brace/paren/bracket depth and string/comment state are tracked so keys
// inside nested objects (e.g. an `onConfirm: () => {…}` body) are ignored.
function depth1Keys(src, openIdx) {
  const keys = new Set();
  let depth = 0;
  let i = openIdx;
  let str = null; // current string delimiter, or null
  let atKeyPos = false; // true right after `{` or `,` at depth 1 (a key may start)
  for (; i < src.length; i++) {
    const c = src[i];
    const prev = src[i - 1];
    if (str) {
      if (c === str && prev !== '\\') str = null;
      continue;
    }
    if (c === '"' || c === "'" || c === '`') {
      // A quoted key at depth 1: read it and see if a `:` follows.
      if (depth === 1 && atKeyPos) {
        const q = readQuoted(src, i);
        const after = skipWs(src, q.end);
        if (src[after] === ':') keys.add(q.value);
        i = q.end - 1;
        atKeyPos = false;
        continue;
      }
      str = c;
      continue;
    }
    // Line + block comments.
    if (c === '/' && src[i + 1] === '/') { while (i < src.length && src[i] !== '\n') i++; continue; }
    if (c === '/' && src[i + 1] === '*') { i += 2; while (i < src.length && !(src[i] === '*' && src[i + 1] === '/')) i++; i++; continue; }

    if (c === '{' || c === '(' || c === '[') {
      depth++;
      atKeyPos = depth === 1; // entering the top object → next token can be a key
      continue;
    }
    if (c === '}' || c === ')' || c === ']') {
      depth--;
      if (depth === 0) break; // options object closed
      atKeyPos = false;
      continue;
    }
    if (depth === 1 && c === ',') { atKeyPos = true; continue; }
    if (depth === 1 && atKeyPos && /[A-Za-z_$]/.test(c)) {
      let j = i;
      while (j < src.length && /[A-Za-z0-9_$]/.test(src[j])) j++;
      const ident = src.slice(i, j);
      const after = skipWs(src, j);
      if (src[after] === ':') keys.add(ident);
      i = j - 1;
      atKeyPos = false;
      continue;
    }
    if (!/\s/.test(c)) atKeyPos = false;
  }
  return keys;
}

function readQuoted(src, i) {
  const q = src[i];
  let j = i + 1;
  let value = '';
  for (; j < src.length; j++) {
    if (src[j] === '\\') { value += src[j + 1]; j++; continue; }
    if (src[j] === q) { j++; break; }
    value += src[j];
  }
  return { value, end: j };
}

const skipWs = (src, i) => { while (i < src.length && /\s/.test(src[i])) i++; return i; };

try {
  const offenders = [];
  const re = /\bconfirm\s*\(\s*\{/g;
  for (const file of walk(ROOT)) {
    const rel = file.split('\\').join('/');
    if (SKIP.has(rel)) continue;
    const src = readFileSync(file, 'utf8');
    let m;
    re.lastIndex = 0;
    while ((m = re.exec(src))) {
      const openIdx = src.indexOf('{', m.index);
      const keys = depth1Keys(src, openIdx);
      const missing = ['title', 'description'].filter((k) => !keys.has(k));
      if (missing.length) {
        const line = src.slice(0, m.index).split('\n').length;
        offenders.push(`${rel}:${line} — confirm() missing ${missing.join(' + ')}`);
      }
    }
  }

  if (offenders.length) {
    console.error('✗ 2ab confirm-copy guard: confirm() call without a title and/or description:');
    for (const o of offenders) console.error(`    ${o}`);
    console.error('\nEvery confirm({…}) needs BOTH `title` and `description` (accessible name +');
    console.error('Radix description). Add the missing i18n-backed prop — do not pass an empty');
    console.error('string and do not rely on the ConfirmDialog aria-describedby opt-out.');
    process.exit(1);
  }

  console.log('✓ 2ab confirm-copy guard: every confirm() carries a title and a description');
  process.exit(0);
} catch (e) {
  console.error('2ab confirm-copy guard: internal error', e);
  process.exit(2);
}
