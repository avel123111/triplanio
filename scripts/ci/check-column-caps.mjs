#!/usr/bin/env node
/**
 * CI guard 2g (TRIP-169) — length caps on new user-facing text columns.
 *
 * Policy (input-integrity layer): every NEW `text` column that can hold
 * user-supplied content must be bounded — either declared with a capped domain
 * (`short_text` / `long_text` / `url_text`, defined in the TRIP-169 migration)
 * or given a `char_length(<col>) <= N` CHECK in the same migration file. This
 * makes the class of defect "added a column, forgot the cap" IMPOSSIBLE to ship
 * by accident: the guard greps ADDED lines of migration files (vs the base
 * branch) for raw unbounded `text` columns and fails the PR.
 *
 * It is deliberately dumb (line-level, no SQL parse) and only inspects columns
 * ADDED in this PR — the whole existing schema is grandfathered (its retrofit
 * CHECKs live in the TRIP-169 migration).
 *
 * Escape for a legitimately-uncapped column (opaque key, hash, machine token):
 *     -- caps-guard: allow-uncapped — <reason>
 * placed anywhere in the migration file. Without it, an unbounded user text
 * column blocks → uncapped text only ships on purpose, justified in review.
 *
 * Env: BASE_REF (default origin/dev).
 * Exit: 0 ok, 1 violation, 2 internal error.
 */
import { execFileSync } from 'node:child_process';

const BASE_REF = process.env.BASE_REF || 'origin/dev';
const DIR = 'supabase/migrations';
const ALLOW_MARKER = /--\s*caps-guard:\s*allow-uncapped/i;

function git(args) {
  return execFileSync('git', args, { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
}

let changed;
try {
  changed = git(['diff', '--name-only', '--diff-filter=AM', `${BASE_REF}...HEAD`, '--', DIR])
    .split('\n')
    .filter((f) => f.endsWith('.sql'));
} catch (e) {
  console.error(`::error::cannot diff against ${BASE_REF}: ${e.message}`);
  process.exit(2);
}

if (changed.length === 0) {
  console.log('check-column-caps: no migration changes in this PR — OK');
  process.exit(0);
}

// A raw unbounded text type token: `text`, `varchar`, `character varying` NOT
// followed by a `(n)` length. A capped domain (short_text/…) won't match.
const RAW_TEXT = '"?(?:text|character\\s+varying|varchar)"?(?!\\s*\\()';
// `ALTER TABLE … ADD COLUMN [IF NOT EXISTS] <col> text …` (whole clause on the line).
const ADD_COL_RE = new RegExp(`add\\s+column\\s+(?:if\\s+not\\s+exists\\s+)?"?([a-z_][a-z0-9_]*)"?\\s+${RAW_TEXT}`, 'i');
// A bare CREATE TABLE body column def: `"notes" text,` / `notes "text"`.
const COL_DEF_RE = new RegExp(`^"?([a-z_][a-z0-9_]*)"?\\s+${RAW_TEXT}`, 'i');
// Lines that are never a user-column decl (DDL verbs, constraints, bodies).
const SKIP_LINE = /^(?:--|check\b|constraint\b|create\b|comment\b|grant\b|revoke\b|insert\b|update\b|select\b|with\b|drop\b|\))/i;

const errors = [];

for (const file of changed) {
  let full = '';
  try {
    full = git(['show', `HEAD:${file}`]);
  } catch {
    continue; // deleted at HEAD (rename) — skip
  }
  if (ALLOW_MARKER.test(full)) {
    console.log(`  ⚠ caps-guard: skipping ${file} (allow-uncapped marker present)`);
    continue;
  }
  const capped = new Set([...full.matchAll(/char_length\("?([a-z_][a-z0-9_]*)"?\)/gi)].map((m) => m[1].toLowerCase()));

  const diff = git(['diff', `${BASE_REF}...HEAD`, '--', file]);
  const added = diff
    .split('\n')
    .filter((l) => l.startsWith('+') && !l.startsWith('+++'))
    .map((l) => l.slice(1).trim());

  for (const line of added) {
    if (!line) continue;
    // ADD COLUMN can appear on an `alter table …` line, so check it first,
    // independent of the DDL-verb skip list.
    let m = line.match(ADD_COL_RE);
    if (!m && !SKIP_LINE.test(line)) m = line.match(COL_DEF_RE);
    if (!m) continue;
    const col = m[1].toLowerCase();
    if (!capped.has(col)) {
      errors.push(`${file}: unbounded text column "${col}" — use short_text/long_text/url_text domain or add a char_length(${col}) CHECK`);
    }
  }
}

if (errors.length) {
  console.error('::error::column-caps guard failed (add `-- caps-guard: allow-uncapped — <reason>` for a deliberate exception):');
  for (const e of errors) console.error(`  ✗ ${e}`);
  process.exit(1);
}

console.log('check-column-caps: no unbounded user text columns added — OK');
process.exit(0);
