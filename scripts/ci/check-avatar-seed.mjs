#!/usr/bin/env node
/**
 * CI guard 2u — a PERSON avatar must carry a stable colour `seed`.
 *
 * The defect this exists to stop is the one that shipped to prod and started the
 * identity clean-up: <Avatar> colours itself from `seed || name`, and a call site
 * that renders a person WITHOUT a seed falls back to colouring by the display
 * name. The same human then changes colour the moment their label changes
 * (full_name ↔ e-mail local-part ↔ "Удалённый аккаунт"), and reads as three
 * different people across screens. resolveAuthor() hands every identity a stable
 * `seed` (the account/membership id) precisely so this cannot happen — but only
 * if the call site actually passes it. This guard makes forgetting it fail CI.
 *
 * THE RULE (one, static — this is an absolute invariant, not a ratchet):
 *   every `<Avatar …>` whose `name` is a DYNAMIC expression (`name={who.name}`,
 *   not a string literal `name="A B"`) must also carry `seed=` in the same tag.
 *
 * NOT required, because colour is irrelevant there:
 *   • a tag with `kind=` — the AI robot / initials placeholder variants;
 *   • a literal name — the /kit demos and one-off decorative avatars.
 *
 * ESCAPE. Some person avatars legitimately have no id to seed by — the public
 * trip page is served by getPublicTrip, which strips user_id/email by design, so
 * colouring by the display name is the only thing possible there. Put a JSX
 * comment carrying `avatar-seed-exempt: <reason>` on the tag (or the line right
 * before it) — same idiom as `inline-style-exempt` (2l) / `design-token-exempt`
 * (2k): visible in the diff, its reason next to the code.
 *
 * Deliberately dumb: a regex over source text with comments blanked out, no
 * parse — it measures the smell (a person avatar with no stable seed), not types.
 * What it does and does not catch is pinned in check-avatar-seed.test.mjs.
 *
 * Scope: `<root>/src` recursively, where <root> is argv[2] if given (the test
 * points it at a fixture) else the repo top-level. Static — no BASE_REF.
 * Exit: 0 ok, 1 violation, 2 internal error.
 */
import { execFileSync } from 'node:child_process';
import { readFileSync, readdirSync, statSync, existsSync } from 'node:fs';
import { join } from 'node:path';

const EXEMPT = 'avatar-seed-exempt';
const SCANNED = /\.(jsx|tsx)$/;

const unknown = process.argv.slice(3).filter((a) => a !== '--');
if (unknown.length) {
  console.error(`::error::check-avatar-seed: unexpected argument ${unknown.join(' ')} (only an optional scan root).`);
  process.exit(2);
}

/* -------------------------------- scanning -------------------------------- */

/** Blank comments, preserving length/newlines so line offsets stay valid.
 *  `//` right after `:`/quote is a URL, not a comment (same care as guard 2l). */
const URLISH = [':', '"', "'", '`'];
function blankComments(src) {
  const out = src.split('');
  for (let i = 0; i < src.length; i++) {
    if (src[i] === '/' && src[i + 1] === '/' && !URLISH.includes(src[i - 1])) {
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

// `name` whose value is a quoted STRING literal — `name="A B"`, `name='A B'`,
// `name={"A B"}`, `name={'A B'}`. Deliberately NOT template literals: `` name={`${x}`} ``
// interpolates and must be treated as dynamic, so backticks are excluded here.
const LITERAL_NAME = /\bname=(?:"[^"]*"|'[^']*'|\{\s*(['"])(?:\\.|(?!\1)[^\\])*\1\s*\})/;
const HAS_NAME = /\bname=/;
const HAS_SEED = /\bseed=/;
const HAS_KIND = /\bkind=/;

/**
 * Extract each `<Avatar …>` / `<Avatar …/>` OPENING tag from (comment-masked)
 * source. A regex `.*?>` would truncate the tag at the first `>` inside a prop —
 * a `p => p.id` arrow, a `n > 3` compare, a nested `<Icon/>` — and then miss the
 * violation entirely (a person avatar whose `name` sits AFTER such a prop reads
 * as "no name"). So we scan by hand, tracking `{}` depth and string literals, and
 * end the tag only at a `>` seen at brace-depth 0 and outside any string.
 * Returns [{ tag, index }] with `index` into the original source (masking keeps
 * offsets), so line numbers and the exempt-marker lookup stay valid.
 */
function avatarTags(masked) {
  const out = [];
  const re = /<Avatar\b/g;
  let m;
  while ((m = re.exec(masked))) {
    let depth = 0;
    let quote = null;
    let i = m.index + m[0].length;
    for (; i < masked.length; i++) {
      const c = masked[i];
      if (quote) {
        if (c === '\\') i++;               // skip an escaped char inside a string
        else if (c === quote) quote = null;
        continue;
      }
      if (c === '"' || c === "'" || c === '`') quote = c;
      else if (c === '{') depth++;
      else if (c === '}') depth--;
      else if (c === '>' && depth === 0) break; // end of the opening tag
    }
    out.push({ tag: masked.slice(m.index, i + 1), index: m.index });
  }
  return out;
}

/** Violations (dynamic-name Avatar with no seed) in one file. */
function scan(src) {
  const masked = blankComments(src);
  const lineOf = (idx) => src.slice(0, idx).split('\n').length - 1; // 0-based
  const lines = src.split('\n');
  const hits = [];
  for (const { tag, index } of avatarTags(masked)) {
    // Blank the CONTENTS of quoted attribute values before testing which props
    // are present, so a literal like `aria-label="seed=warm"` can never
    // masquerade as a real `seed=`/`kind=`/`name=` prop.
    const attrs = tag.replace(/"[^"]*"/g, '""').replace(/'[^']*'/g, "''");
    if (!HAS_NAME.test(attrs)) continue;   // kind-only avatar (ai) — no name to colour
    if (HAS_KIND.test(attrs)) continue;    // ai / placeholder — colour irrelevant
    if (LITERAL_NAME.test(attrs)) continue; // literal name (kit demo / decorative)
    if (HAS_SEED.test(attrs)) continue;    // the correct case
    const from = lineOf(index);
    const to = lineOf(index + tag.length);
    // Reason may sit on any line the tag spans, or the line right before it.
    if (lines.slice(Math.max(0, from - 1), to + 1).some((l) => l.includes(EXEMPT))) continue;
    hits.push(from + 1); // 1-based for humans
  }
  return hits;
}

/* --------------------------------- walk ----------------------------------- */

function walk(dir, acc) {
  for (const name of readdirSync(dir)) {
    if (name === 'node_modules' || name === 'dist' || name.startsWith('.')) continue;
    const full = join(dir, name);
    const st = statSync(full);
    if (st.isDirectory()) walk(full, acc);
    else if (SCANNED.test(name)) acc.push(full);
  }
  return acc;
}

let root = process.argv[2];
if (!root) {
  try {
    root = join(execFileSync('git', ['rev-parse', '--show-toplevel'], { encoding: 'utf8' }).trim(), 'src');
  } catch {
    console.error('::error::check-avatar-seed: not a git repo and no scan root given.');
    process.exit(2);
  }
}
if (!existsSync(root)) {
  console.error(`::error::check-avatar-seed: scan root ${root} does not exist.`);
  process.exit(2);
}

const errors = [];
let files = 0;
for (const file of walk(root, [])) {
  files++;
  for (const line of scan(readFileSync(file, 'utf8'))) {
    errors.push(`${file}:${line}`);
  }
}

if (errors.length) {
  console.error('::error::check-avatar-seed: a person <Avatar> is coloured by name, not a stable seed — see rule #6 / identity seam');
  errors.forEach((e) => console.error(
    `  ✗ ${e}: <Avatar> has a dynamic name but no seed=` +
    '\n      → pass seed={who.seed} from resolveAuthor (stable colour per person).' +
    `\n        If there is genuinely no id (public page), mark it: {/* ${EXEMPT}: <reason> */}`,
  ));
  process.exit(1);
}

console.log(`check-avatar-seed: ${files} file(s) scanned — every person <Avatar> carries a stable seed. OK`);
process.exit(0);
