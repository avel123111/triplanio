#!/usr/bin/env node
/**
 * CI guard 2h (TRIP-219) — Sentry coverage for new edge functions.
 *
 * Every edge function must report unexpected failures to Sentry. The uniform way
 * is to wrap the handler in `withHandler(fnName, …)` from `_shared/http.ts` (cors
 * + OPTIONS + a top-level catch that reports any non-2xx). A few functions have
 * their own contract (webhooks read the raw body / must always 200, image render
 * returns SVG, rate-limited paths) and keep hand-written capture — they opt out
 * with an explicit `// sentry: manual` marker so the choice is visible in review.
 *
 * This guard fails a PR that adds a NEW function dir whose source contains
 * NEITHER `withHandler(` NOR `captureEdgeError(` NOR the `// sentry: manual`
 * marker — so coverage stays self-sustaining as functions are added. (Backfilling
 * the pre-existing uncovered functions onto withHandler happens in tranches; once
 * complete this can be tightened from "new" to "all".)
 *
 * Env: BASE_REF (default origin/dev).
 * Exit: 0 ok, 1 violation, 2 internal error.
 */
import { execFileSync } from 'node:child_process';

const BASE_REF = process.env.BASE_REF || 'origin/dev';
const FN_DIR = 'supabase/functions';

const SIGNALS = [
  { re: /\bwithHandler\s*\(/, label: 'withHandler wrapper' },
  { re: /\bcaptureEdgeError\s*\(/, label: 'captureEdgeError call' },
  { re: /\/\/\s*sentry:\s*manual/i, label: 'explicit // sentry: manual opt-out' },
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
    const name = p.slice(FN_DIR.length + 1).split('/')[0];
    if (name && name !== '_shared') names.add(name);
  }
  return names;
}

const baseFns = functionsAt(BASE_REF);
const headFns = functionsAt('HEAD');
const newFns = [...headFns].filter((n) => !baseFns.has(n)).sort();

if (newFns.length === 0) {
  console.log('check-edge-sentry: no new edge functions in this PR — OK');
  process.exit(0);
}

const errors = [];
for (const fn of newFns) {
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
  if (hit) {
    console.log(`  ✓ new function "${fn}": ${hit.label}`);
  } else {
    errors.push(
      `new edge function "${fn}" has no Sentry coverage — wrap its handler in ` +
        `withHandler(...) from _shared/http.ts, or add captureEdgeError, or (if it ` +
        `owns its error contract) an explicit "// sentry: manual" marker`,
    );
  }
}

if (errors.length) {
  console.error('::error::edge Sentry-coverage guard failed:');
  for (const e of errors) console.error(`  ✗ ${e}`);
  process.exit(1);
}

console.log('check-edge-sentry: new functions OK');
process.exit(0);
