#!/usr/bin/env node
/**
 * CI guard 2h (TRIP-219) — Sentry coverage for ALL edge functions.
 *
 * Every edge function must report failures to Sentry. The uniform way is to wrap
 * the handler in `withHandler(fnName, …)` from `_shared/http.ts` (cors + OPTIONS
 * + a top-level catch that reports every 4xx/5xx). A few functions own their
 * error contract (webhooks read the raw body / must always 200, image render
 * returns SVG, anon rate-limited preflight) and keep hand-written capture — they
 * opt out with an explicit `// sentry: manual` marker so the choice is visible.
 *
 * This guard fails the PR if ANY function's ENTRYPOINT (`index.ts`) has NEITHER
 * real `withHandler(` / `captureEdgeError(` instrumentation NOR the
 * `// sentry: manual` marker. Coverage started as a per-new-function rule and was
 * tightened to the whole set once every function was covered (TRIP-219) — so it
 * is now a structural invariant that cannot silently regress.
 *
 * Only `index.ts` is scanned (a helper/test elsewhere calling captureEdgeError
 * must not satisfy the gate), the code signals are matched with comments stripped
 * (a comment mentioning withHandler must not satisfy it), and the `// sentry:
 * manual` opt-out is matched on the RAW text since it is itself a comment.
 *
 * Exit: 0 ok, 1 violation, 2 internal error.
 */
import { readdirSync, readFileSync, existsSync } from 'node:fs';

const FN_DIR = 'supabase/functions';

const MANUAL_MARKER = /\/\/\s*sentry:\s*manual/i;
const CODE_SIGNALS = [
  { re: /\bwithHandler\s*\(/, label: 'withHandler wrapper' },
  { re: /\bcaptureEdgeError\s*\(/, label: 'captureEdgeError call' },
];

// Drop // line and /* */ block comments so a mention in a comment can't satisfy
// the code signals (the `://` in a URL is left intact — irrelevant to matching).
function stripComments(src) {
  return src
    .replace(/\/\*[\s\S]*?\*\//g, ' ')
    .replace(/(^|[^:])\/\/[^\n]*/g, '$1');
}

let fnNames;
try {
  fnNames = readdirSync(FN_DIR, { withFileTypes: true })
    .filter((d) => d.isDirectory() && d.name !== '_shared')
    .map((d) => d.name)
    .sort();
} catch (e) {
  console.error(`::error::cannot list ${FN_DIR}: ${e.message}`);
  process.exit(2);
}

const errors = [];
let ok = 0;
for (const fn of fnNames) {
  const entry = [`${FN_DIR}/${fn}/index.ts`, `${FN_DIR}/${fn}/index.js`].find((p) => existsSync(p));
  if (!entry) {
    errors.push(`function "${fn}" has no index.ts/index.js entrypoint`);
    continue;
  }
  const raw = readFileSync(entry, 'utf8');
  if (MANUAL_MARKER.test(raw)) {
    ok++;
    continue;
  }
  if (CODE_SIGNALS.some((s) => s.re.test(stripComments(raw)))) {
    ok++;
    continue;
  }
  errors.push(
    `edge function "${fn}" has no Sentry coverage in index.ts — wrap its handler ` +
      `in withHandler(...) from _shared/http.ts, or call captureEdgeError, or (if ` +
      `it owns its error contract) add a "// sentry: manual" marker`,
  );
}

if (errors.length) {
  console.error('::error::edge Sentry-coverage guard failed:');
  for (const e of errors) console.error(`  ✗ ${e}`);
  process.exit(1);
}

console.log(`check-edge-sentry: all ${ok} edge functions covered — OK`);
process.exit(0);
