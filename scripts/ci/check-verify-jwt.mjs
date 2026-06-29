#!/usr/bin/env node
/**
 * CI guard 2c (TRIP-134) — verify_jwt for new externally-callable functions.
 *
 * Enforces rule 12 at PR time. If a PR adds a NEW edge function that authenticates
 * itself (webhook / public / N8N_SECRET / Stripe signature) but `supabase/config.toml`
 * has NO `[functions.<name>] verify_jwt = false` entry, the deploy would ship it as
 * verify_jwt=true and 401 every caller. This catches that before merge.
 *
 * Source of truth = config.toml (the deploy job already asserts the live set via the
 * Management API — that stays). Detection of "externally-callable" is necessarily a
 * heuristic: a new function dir is flagged when its source contains a self-auth
 * signal (N8N_SECRET, Stripe constructEvent / stripe-signature) or an explicit
 * `// verify-jwt: external` marker. Functions with none of these are assumed to want
 * the default (verify_jwt=true) and pass. Residual risk: a public function using none
 * of these signals — annotate it with `// verify-jwt: external` to bring it under the
 * guard. False negatives here are still backstopped by the deploy-time assert.
 *
 * Env: BASE_REF (default origin/dev).
 * Exit: 0 ok, 1 violation, 2 internal error.
 */
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';

const BASE_REF = process.env.BASE_REF || 'origin/dev';
const FN_DIR = 'supabase/functions';
const CONFIG = 'supabase/config.toml';

const SIGNALS = [
  { re: /N8N_SECRET/, label: 'N8N_SECRET (service-to-service)' },
  { re: /constructEvent|stripe-signature/i, label: 'Stripe webhook signature' },
  { re: /\/\/\s*verify-jwt:\s*external/i, label: 'explicit // verify-jwt: external marker' },
];

function git(args) {
  return execFileSync('git', args, { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
}

// Immediate function names (subdirs of FN_DIR) at a given ref, excluding _shared.
function functionsAt(ref) {
  let out;
  try {
    out = git(['ls-tree', '-r', '--name-only', ref, '--', FN_DIR]);
  } catch (e) {
    console.error(`::error::cannot list ${FN_DIR} at ${ref}: ${e.message}`);
    process.exit(2);
  }
  const names = new Set();
  for (const p of out.split('\n').filter(Boolean)) {
    const rel = p.slice(FN_DIR.length + 1); // "<name>/..."
    const name = rel.split('/')[0];
    if (name && name !== '_shared') names.add(name);
  }
  return names;
}

// Set of function names pinned verify_jwt = false in config.toml.
function pinnedFalse() {
  const txt = readFileSync(CONFIG, 'utf8');
  const set = new Set();
  let cur = null;
  for (const line of txt.split('\n')) {
    const sec = line.match(/^\s*\[functions\.([^\]]+)\]/);
    if (sec) {
      cur = sec[1];
      continue;
    }
    if (cur && /^\s*verify_jwt\s*=/.test(line)) {
      if (/false/.test(line)) set.add(cur);
      cur = null;
    }
  }
  return set;
}

const baseFns = functionsAt(BASE_REF);
const headFns = functionsAt('HEAD');
const newFns = [...headFns].filter((n) => !baseFns.has(n)).sort();

if (newFns.length === 0) {
  console.log('check-verify-jwt: no new edge functions in this PR — OK');
  process.exit(0);
}

const pinned = pinnedFalse();
const errors = [];

for (const fn of newFns) {
  // Concatenate the function's source at HEAD.
  const files = git(['ls-tree', '-r', '--name-only', 'HEAD', '--', `${FN_DIR}/${fn}`])
    .split('\n')
    .filter((f) => f.endsWith('.ts') || f.endsWith('.js'));
  let src = '';
  for (const f of files) {
    try {
      src += git(['show', `HEAD:${f}`]) + '\n';
    } catch {
      /* skip */
    }
  }

  const hit = SIGNALS.find((s) => s.re.test(src));
  if (!hit) {
    console.log(`  · new function "${fn}": no external-call signal → assumed verify_jwt=true (default), OK`);
    continue;
  }
  if (pinned.has(fn)) {
    console.log(`  ✓ new function "${fn}": ${hit.label} → pinned verify_jwt=false in config.toml`);
  } else {
    errors.push(
      `new externally-callable function "${fn}" (${hit.label}) is missing ` +
        `[functions.${fn}] verify_jwt = false in ${CONFIG} — CI would deploy it as verify_jwt=true and break its callers`,
    );
  }
}

if (errors.length) {
  console.error('::error::verify_jwt guard failed:');
  for (const e of errors) console.error(`  ✗ ${e}`);
  process.exit(1);
}

console.log('check-verify-jwt: new functions OK');
process.exit(0);
