#!/usr/bin/env node
/**
 * CI guard 2j (TRIP-311) — analytics start from ONE place, behind consent.
 *
 * The whole cookie-consent design rests on a single fact: PostHog does not exist
 * in the browser until someone has agreed. That holds only while `posthog.init()`
 * is called from `src/lib/consent.js` and nowhere else — a second init anywhere
 * would start tracking before (or regardless of) the answer, which is precisely
 * the state this ticket exists to end. It is also invisible: the app would look
 * and behave exactly the same, and only a Network tab would show the difference.
 *
 * This is a self-consistency invariant over the whole tree (not a diff), the twin
 * of `check-invoke-seam.mjs` (2i).
 *
 * Exit: 0 ok, 1 violation, 2 internal error.
 */
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';

// `dev/` too: canon-inspector is dynamically imported INTO the app, so code there
// runs in the browser exactly like src/ does.
const ROOTS = ['src', 'dev'];

// Both spellings. `posthog?.init(` is the house style of the calls right next to
// it (`posthog?.capture?.`), so it is the MORE likely way a second init gets
// written — matching only the plain dot would let the realistic case through.
const POSTHOG_INIT = /\bposthog\s*(\?\.|\.)\s*init\s*\(/;

// The ONLY file allowed to start PostHog — it IS the consent gate.
const ALLOW = new Set([
  'src/lib/consent.js',
]);

// Drop // line and /* */ block comments so a mention in a comment (this guard is
// referenced in several docblocks) cannot trip it.
function stripComments(src) {
  return src
    .replace(/\/\*[\s\S]*?\*\//g, ' ')
    .replace(/(^|[^:])\/\/[^\n]*/g, '$1');
}

function walk(dir, out = []) {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) walk(p, out);
    else if (/\.(jsx?|tsx?)$/.test(name)) out.push(p);
  }
  return out;
}

try {
  const offenders = [];
  const files = ROOTS.filter(existsSync).flatMap((root) => walk(root));
  for (const file of files) {
    const rel = file.split('\\').join('/');
    if (ALLOW.has(rel)) continue;
    if (POSTHOG_INIT.test(stripComments(readFileSync(file, 'utf8')))) offenders.push(rel);
  }

  if (offenders.length) {
    console.error('::error::2j consent guard failed: posthog.init() outside the consent gate:');
    for (const f of offenders) console.error(`  ✗ ${f}`);
    console.error('\nStart PostHog through `applyConsent(record, uid)` from @/lib/consent instead.');
    console.error('An init anywhere else runs before the visitor has agreed to cookies — the exact');
    console.error('thing TRIP-311 removed. Add new analytics destinations to applyConsent().');
    process.exit(1);
  }

  console.log('check-posthog-init: analytics start only from the consent gate — OK');
  process.exit(0);
} catch (e) {
  console.error(`::error::check-posthog-init internal error: ${e.message}`);
  process.exit(2);
}
