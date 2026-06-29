#!/usr/bin/env node
/**
 * CI Phase 5 (TRIP-134) — auto re-stamp out-of-order migrations on the dev deploy.
 *
 * The residual race that guard 2a can't catch: two PRs each pass 2a against the
 * same journal snapshot; after the first merges, the second's timestamp is now
 * <= the journal max → strict `db push` (no --include-all) rejects it as
 * out-of-order (the TRIP-121 incident). Humans fixed it by renaming the file to
 * a fresh timestamp. This automates exactly that — SAFELY:
 *
 *   - DEV ONLY (caller guards github.ref_name == 'dev'). Never on main: renaming
 *     a migration on main would diverge repo from the prod journal (TRIP-68 drift).
 *   - Only PENDING migrations (present locally, NOT yet applied remotely) are
 *     touched. An already-applied migration is never renamed (that would drift).
 *   - Only files whose timestamp is <= the newest APPLIED remote version are
 *     re-stamped (the ones db push would reject). In-order pending files are left
 *     alone.
 *   - New timestamps are assigned strictly above max(remote applied, all local)
 *     so the re-stamped files become the newest and apply cleanly. The caller
 *     commits the rename back to dev with [skip ci] and applies it in the same run.
 *
 * Input: path to the output of `supabase migration list --db-url <dev>` (arg 1).
 *   Columns are "Local | Remote | Time", separated by │ or |. A row with a Remote
 *   value = applied; Local-only = pending.
 * Performs `git mv` for each re-stamp (so git records the rename). Prints the plan.
 * Set DRY_RUN=1 to print the plan without moving files (used by the unit check).
 *
 * Exit: 0 always on success (0 or N renames); 2 on internal/parse error.
 */
import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { execFileSync } from 'node:child_process';

const DIR = 'supabase/migrations';
const DRY_RUN = process.env.DRY_RUN === '1';
const TS_RE = /(\d{14})/;
const FILE_RE = /^(\d{14})_(.+\.sql)$/;

const listPath = process.argv[2];
if (!listPath || !existsSync(listPath)) {
  console.error(`::error::restamp: migration-list file not found: ${listPath}`);
  process.exit(2);
}

// Parse `supabase migration list` → applied (remote) versions + pending (local-only).
function parseList(text) {
  const applied = new Set();
  const pending = new Set();
  for (const line of text.split('\n')) {
    // Only data rows have the column separator and at least one 14-digit version.
    if (!/[│|]/.test(line) || !TS_RE.test(line)) continue;
    const cols = line.split(/[│|]/).map((c) => c.trim());
    if (cols.length < 2) continue;
    const localM = cols[0].match(TS_RE);
    const remoteM = cols[1].match(TS_RE);
    if (remoteM) applied.add(remoteM[1]);
    if (localM && !remoteM) pending.add(localM[1]);
  }
  return { applied, pending };
}

function tsToEpoch(ts) {
  const Y = +ts.slice(0, 4), Mo = +ts.slice(4, 6), D = +ts.slice(6, 8);
  const h = +ts.slice(8, 10), mi = +ts.slice(10, 12), s = +ts.slice(12, 14);
  return Date.UTC(Y, Mo - 1, D, h, mi, s) / 1000;
}
function epochToTs(epoch) {
  const d = new Date(epoch * 1000);
  const p = (n, w = 2) => String(n).padStart(w, '0');
  return (
    p(d.getUTCFullYear(), 4) + p(d.getUTCMonth() + 1) + p(d.getUTCDate()) +
    p(d.getUTCHours()) + p(d.getUTCMinutes()) + p(d.getUTCSeconds())
  );
}

const { applied, pending } = parseList(readFileSync(listPath, 'utf8'));

if (applied.size === 0) {
  console.log('restamp: no applied remote migrations reported — nothing to do');
  process.exit(0);
}

const appliedMax = [...applied].sort().at(-1);

// Local migration files on disk, parsed once into { file, version, desc }.
const localMigrations = readdirSync(DIR)
  .map((f) => f.match(FILE_RE))
  .filter(Boolean)
  .map((m) => ({ file: m[0], version: m[1], desc: m[2] }));
const localMax = localMigrations.map((m) => m.version).sort().at(-1);

// Out-of-order = pending AND timestamp <= newest applied remote.
const offenders = localMigrations
  .filter((m) => pending.has(m.version) && m.version <= appliedMax)
  .sort((a, b) => (a.file < b.file ? -1 : a.file > b.file ? 1 : 0));

if (offenders.length === 0) {
  console.log(`restamp: no out-of-order pending migrations (applied max ${appliedMax}) — OK`);
  process.exit(0);
}

// Assign fresh timestamps strictly above max(appliedMax, localMax), 1s apart.
let cursor = tsToEpoch(appliedMax > localMax ? appliedMax : localMax);
const plan = [];
for (const { file, desc } of offenders) {
  cursor += 1;
  const newName = `${epochToTs(cursor)}_${desc}`;
  plan.push({ from: file, to: newName });
}

console.log(`restamp: ${plan.length} out-of-order migration(s) below applied max ${appliedMax}:`);
for (const { from, to } of plan) {
  console.log(`  ${from}  →  ${to}`);
  if (!DRY_RUN) {
    execFileSync('git', ['mv', `${DIR}/${from}`, `${DIR}/${to}`], { stdio: 'inherit' });
  }
}
console.log(DRY_RUN ? 'restamp: DRY_RUN — no files moved' : 'restamp: renames staged via git mv');
process.exit(0);
