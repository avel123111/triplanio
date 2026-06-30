#!/usr/bin/env node
/**
 * CI guard 2b (TRIP-134) — destructive (contract-phase) migrations.
 *
 * Policy: migrations are additive / backward-compatible by default. Dropping or
 * renaming schema objects is a deliberate late "contract" phase, done only once
 * the code no longer uses them (expand → switch → contract). This guard makes
 * the destructive default IMPOSSIBLE to ship by accident — it greps ADDED lines
 * of migration files (vs the base branch) for destructive DDL and fails the PR.
 *
 * What it does NOT do: it does not check semantics (is the column still used?)
 * nor phase separation over time — that stays with review/policy. It only forces
 * a destructive change to be intentional and logged.
 *
 * Escape for a legitimate contract phase: put an opt-in marker anywhere in the
 * migration file:
 *     -- ddl-guard: allow-destructive — TRIP-XX, contract, <object> unused since <commit>
 * Without the marker the guard blocks → destructive DDL only passes on purpose,
 * with a justification visible in review.
 *
 * Env: BASE_REF (default origin/dev).
 * Exit: 0 ok, 1 violation, 2 internal error.
 */
import { execFileSync } from 'node:child_process';

const BASE_REF = process.env.BASE_REF || 'origin/dev';
const DIR = 'supabase/migrations';
const ALLOW_MARKER = /--\s*ddl-guard:\s*allow-destructive/i;

// Destructive DDL patterns (case-insensitive), matched on added lines only.
const PATTERNS = [
  { re: /\bDROP\s+COLUMN\b/i, label: 'DROP COLUMN' },
  { re: /\bDROP\s+TABLE\b/i, label: 'DROP TABLE' },
  { re: /\bDROP\s+NOT\s+NULL\b/i, label: 'DROP NOT NULL' },
  { re: /\bRENAME\b/i, label: 'RENAME' }, // ALTER ... RENAME [COLUMN] ... TO ...
  { re: /\bALTER\s+\w[\w".]*\s+.*\bDROP\b/i, label: 'ALTER ... DROP' }, // drop constraint/default/column
];

function git(args) {
  return execFileSync('git', args, { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
}

// Files added or modified in this PR under the migrations dir.
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
  console.log('check-destructive-migrations: no migration changes in this PR — OK');
  process.exit(0);
}

const errors = [];

for (const file of changed) {
  // Marker is file-level (read the full current file content).
  let fullContent = '';
  try {
    fullContent = git(['show', `HEAD:${file}`]);
  } catch {
    /* file may be deleted at HEAD on a rename — skip */
    continue;
  }
  const allowed = ALLOW_MARKER.test(fullContent);

  // Added lines for this file (unified diff, only '+' content lines).
  const diff = git(['diff', `${BASE_REF}...HEAD`, '--', file]);
  const addedLines = diff
    .split('\n')
    .filter((l) => l.startsWith('+') && !l.startsWith('+++'))
    .map((l) => l.slice(1));

  for (const raw of addedLines) {
    const line = raw.trim();
    if (!line || line.startsWith('--')) continue; // skip blanks and SQL comments
    for (const { re, label } of PATTERNS) {
      if (re.test(line)) {
        if (allowed) {
          console.log(`  ⚠ allowed (marker present) ${file}: ${label} — "${line}"`);
        } else {
          errors.push(`${file}: destructive DDL ${label} — "${line}"`);
        }
      }
    }
  }
}

if (errors.length) {
  console.error('::error::destructive-migration guard failed (add `-- ddl-guard: allow-destructive — <reason>` to opt in):');
  for (const e of errors) console.error(`  ✗ ${e}`);
  process.exit(1);
}

console.log('check-destructive-migrations: no un-marked destructive DDL — OK');
process.exit(0);
