#!/usr/bin/env node
/**
 * CI guard 2a (TRIP-134) — migration numbering.
 *
 * Runs on a PR into dev. Looks at migration files ADDED in this PR (vs the base
 * branch) and fails the PR when a new file:
 *   1. DUPLICATE   — reuses a timestamp that already exists (in base history or
 *                    twice within the PR). `db push` refuses duplicate versions.
 *   2. OUT-OF-ORDER — has a timestamp <= the newest already-committed migration.
 *                    `db push` (no --include-all) refuses to insert "in the
 *                    middle" of the journal → Deploy Supabase fails (the exact
 *                    TRIP-121 incident).
 *   3. MANUAL/ROUND — minutes AND seconds are both "00" (…HH0000). `supabase
 *                    migration new` stamps UTC to the second, so a round stamp
 *                    is the tell of a hand-typed number. Forcing the generator
 *                    is what stops the drift at the source.
 *
 * Repo == dev == prod journals after TRIP-68, so the newest committed migration
 * filename on the base branch is a faithful proxy for the live journal max — no
 * DB access needed in the PR gate. The residual race (two PRs pass against the
 * same journal snapshot; the second goes out-of-order after the first merges) is
 * caught by Telegram-notify + manual re-stamp, not by this guard.
 *
 * Env: BASE_REF (default origin/dev).
 * Exit: 0 ok, 1 violation, 2 internal error.
 */
import { readdirSync } from 'node:fs';
import { execFileSync } from 'node:child_process';

const BASE_REF = process.env.BASE_REF || 'origin/dev';
const DIR = 'supabase/migrations';
const TS_RE = /^(\d{14})_.+\.sql$/;

function git(args) {
  return execFileSync('git', args, { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
}

function baseFilenames() {
  let out;
  try {
    out = git(['ls-tree', '-r', '--name-only', BASE_REF, '--', DIR]);
  } catch (e) {
    console.error(`::error::cannot read ${DIR} at ${BASE_REF} — is the base branch fetched? ${e.message}`);
    process.exit(2);
  }
  return out
    .split('\n')
    .filter(Boolean)
    .map((p) => p.split('/').pop())
    .filter((n) => n.endsWith('.sql'));
}

function tsOf(name) {
  const m = name.match(TS_RE);
  return m ? m[1] : null;
}

const baseNames = baseFilenames();
const currentNames = readdirSync(DIR).filter((n) => n.endsWith('.sql'));

const baseSet = new Set(baseNames);
const newNames = currentNames.filter((n) => !baseSet.has(n)).sort();

if (newNames.length === 0) {
  console.log('check-migration-numbering: no new migrations in this PR — OK');
  process.exit(0);
}

// Newest committed timestamp on the base branch = journal max proxy.
const baseTimestamps = baseNames.map(tsOf).filter(Boolean).sort();
const journalMax = baseTimestamps[baseTimestamps.length - 1] || '00000000000000';

const baseTsSet = new Set(baseTimestamps);
const seenNew = new Map(); // ts -> filename (detect intra-PR dups)
const errors = [];

for (const name of newNames) {
  const ts = tsOf(name);
  if (!ts) {
    errors.push(`${name}: not a "<YYYYMMDDHHMMSS>_<name>.sql" file — use \`supabase migration new <name>\``);
    continue;
  }

  // 1. duplicate
  if (baseTsSet.has(ts)) {
    errors.push(`${name}: timestamp ${ts} already exists in ${BASE_REF} (duplicate — db push refuses it)`);
  }
  if (seenNew.has(ts)) {
    errors.push(`${name}: timestamp ${ts} duplicated within this PR (also ${seenNew.get(ts)})`);
  }
  seenNew.set(ts, name);

  // 2. out-of-order
  if (ts <= journalMax) {
    errors.push(
      `${name}: timestamp ${ts} <= newest committed migration ${journalMax} — ` +
        `out-of-order, \`db push\` (no --include-all) will reject it. Re-stamp with \`supabase migration new\`.`,
    );
  }

  // 3. manual / round stamp
  const mm = ts.slice(10, 12);
  const ss = ts.slice(12, 14);
  if (mm === '00' && ss === '00') {
    errors.push(
      `${name}: timestamp ${ts} ends in ":00:00" — looks hand-typed. ` +
        `Generate it with \`supabase migration new <name>\` (second-precision UTC) instead of writing the number.`,
    );
  }
}

if (errors.length) {
  console.error('::error::migration numbering guard failed:');
  for (const e of errors) console.error(`  ✗ ${e}`);
  process.exit(1);
}

console.log(`check-migration-numbering: ${newNames.length} new migration(s) OK (journal max ${journalMax})`);
process.exit(0);
