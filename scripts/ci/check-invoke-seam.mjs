#!/usr/bin/env node
/**
 * CI guard 2i (TRIP-219) — every edge call goes through the invokeFn seam.
 *
 * The frontend must call edge functions ONLY through `src/lib/invokeFn.js`, the
 * single browser seam that (a) parses the canonical `{ error, code }` body once
 * and (b) reports to Sentry the failures the edge `withHandler` cannot see
 * (network / relay / a 200-with-`{error}` body). A raw `supabase.functions.invoke(`
 * anywhere else is a call-site that silently swallows those failures into a toast
 * — exactly the blind spot this phase closes.
 *
 * This guard fails the PR if `supabase.functions.invoke(` appears (in real code,
 * comments stripped) in any file under `src/` other than the seam itself. It is a
 * self-consistency invariant over the whole tree (not a diff), the twin of the
 * edge-side `check-edge-sentry.mjs` (2h): once every call-site is migrated, the
 * seam cannot silently regress.
 *
 * Exit: 0 ok, 1 violation, 2 internal error.
 */
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';

const ROOT = 'src';
const RAW_INVOKE = /\.functions\s*\.\s*invoke\s*\(/;

// The ONLY file allowed to call supabase.functions.invoke directly — it IS the seam.
const ALLOW = new Set([
  'src/lib/invokeFn.js',
]);

// Drop // line and /* */ block comments so a mention in a comment / JSDoc example
// (e.g. ConfirmProvider's usage note) cannot trip the guard. The `://` in a URL is
// left intact — irrelevant to matching `.functions.invoke(`.
function stripComments(src) {
  return src
    .replace(/\/\*[\s\S]*?\*\//g, ' ')
    .replace(/(^|[^:])\/\/[^\n]*/g, '$1');
}

function walk(dir, out = []) {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    const s = statSync(p);
    if (s.isDirectory()) walk(p, out);
    else if (/\.(jsx?|tsx?)$/.test(name)) out.push(p);
  }
  return out;
}

try {
  const offenders = [];
  for (const file of walk(ROOT)) {
    const rel = file.split('\\').join('/');
    if (ALLOW.has(rel)) continue;
    if (RAW_INVOKE.test(stripComments(readFileSync(file, 'utf8')))) offenders.push(rel);
  }

  if (offenders.length) {
    console.error('::error::2i invoke-seam guard failed: raw supabase.functions.invoke() outside the seam:');
    for (const f of offenders) console.error(`  ✗ ${f}`);
    console.error('\nCall the edge function through `invokeFn(name, options)` from @/lib/invokeFn');
    console.error('instead. It returns the same { data, error } (plus { code, message }) and reports');
    console.error('network / 200-error failures to Sentry that the edge seam cannot see.');
    process.exit(1);
  }

  console.log('check-invoke-seam: all edge calls go through invokeFn — OK');
  process.exit(0);
} catch (e) {
  console.error(`::error::check-invoke-seam internal error: ${e.message}`);
  process.exit(2);
}
