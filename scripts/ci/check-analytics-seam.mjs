#!/usr/bin/env node
/**
 * CI guard 2j — the analytics seam has ONE door per side, and it stays that way.
 *
 * Three invariants, one theme: every event and every identity goes through a
 * single module, so the rules that live there (consent, the held queue, the uid,
 * the first-touch source) cannot be walked around. All three failures are
 * INVISIBLE — the app looks and behaves identically, and only a Network tab or a
 * months-later audit shows the difference. That is why they need a machine and
 * not a reviewer.
 *
 *   A. `posthog-js` is imported only by `src/lib/analytics.js` and
 *      `src/lib/consent.js` (TRIP-335).
 *      The expensive one. `$identify` is the event that CREATES the person, and
 *      PostHog attaches its own `$initial_*` block to it — including an explicit
 *      `$initial_utm_source: null`. That property is set-once and a null IS a
 *      written value, so whoever identifies FIRST decides the acquisition
 *      channel of that account FOREVER. A second, bare `posthog.identify(uid)`
 *      anywhere — a new login button, a new screen — would silently cost us the
 *      channel of every account it touched, unrepairably. The same import ban
 *      keeps `capture` behind `track()` (which holds events until consent),
 *      `reset` behind `resetIdentity()`, and `group` / `setPersonProperties`
 *      behind their own gates.
 *
 *   B. `posthog.init()` is called only from `src/lib/consent.js` (TRIP-311).
 *      The whole cookie-consent design rests on PostHog not existing in the
 *      browser until someone has agreed. A second init would start tracking
 *      before (or regardless of) the answer.
 *
 *   C. The PostHog ingestion key / host appear only in
 *      `supabase/functions/_shared/analytics.ts` (TRIP-213 Ф2).
 *      Server-born events (the Stripe purchase, the North Star) must carry
 *      `distinct_id = uid` — that is what lands them on the same person as the
 *      browser. An edge function POSTing on its own would be free to send any
 *      distinct_id, and revenue filed against the wrong person is worse than
 *      revenue not filed at all.
 *
 * A self-consistency invariant over the whole tree (not a diff), the twin of
 * `check-invoke-seam.mjs` (2i). Tested by `check-analytics-seam.test.mjs`.
 *
 * Exit: 0 ok, 1 violation, 2 internal error / the seam itself moved.
 */
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';

// `dev/` too: canon-inspector is dynamically imported INTO the app, so code
// there runs in the browser exactly like src/ does.
const BROWSER_ROOTS = ['src', 'dev'];
const EDGE_ROOTS = ['supabase/functions'];

// Every spelling that hands back a working client. The SUBPATH is not decoration:
// `posthog-js/react` is a real installed entry point (`usePostHog()`) onto the
// very same singleton, so `from 'posthog-js/react'` is the most idiomatic way a
// React dev reaches it — and a pattern anchored on the bare name never sees it.
// `import(…)` likewise: lazy-loading is this repo's house style (invokeFn,
// canon-inspector), and it is the natural way to defer the analytics bundle.
const POSTHOG_MODULE = /(?:\bfrom|\brequire\s*\(|\bimport\s*\(?)\s*['"]posthog-js(?:\/[^'"]*)?['"]/;

// The script-tag escape hatch: the global reaches the same client without
// importing anything. `?.` and `globalThis` are in for the reason rule B gives
// for accepting `?.` — optional chaining is the house style of the calls sitting
// next to these. The bracket form is what gets written when TS has no type for
// `window.posthog`.
const POSTHOG_GLOBAL = /\b(?:window|globalThis)\s*(?:(?:\?\.|\.)\s*posthog\b|(?:\?\.)?\s*\[\s*['"]posthog['"])/;

const RULES = [
  {
    id: 'A',
    roots: BROWSER_ROOTS,
    pattern: new RegExp(`${POSTHOG_MODULE.source}|${POSTHOG_GLOBAL.source}`),
    allow: ['src/lib/analytics.js', 'src/lib/consent.js'],
    title: 'posthog-js reached outside the analytics seam',
    fix: [
      'Events go through `track()`, identity through `identifyUser()` / `resetIdentity()`,',
      'the trip group through `groupTrip()` — all exported from @/lib/analytics.',
      'A bare posthog.identify() elsewhere permanently blanks the acquisition channel of',
      'every account it touches: $initial_* is set-once and PostHog already wrote a null',
      'into it on the event that created the person (TRIP-335).',
    ],
  },
  {
    id: 'B',
    roots: BROWSER_ROOTS,
    // Both spellings. `posthog?.init(` is the house style of the calls next to it
    // (`posthog?.capture?.`), so it is the MORE likely way a second init gets
    // written — matching only the plain dot would let the realistic case through.
    pattern: /\bposthog\s*(\?\.|\.)\s*init\s*\(/,
    allow: ['src/lib/consent.js'],
    title: 'posthog.init() outside the consent gate',
    fix: [
      'Start PostHog through `applyConsent(record, uid)` from @/lib/consent instead.',
      'An init anywhere else runs before the visitor has agreed to cookies — the exact',
      'thing TRIP-311 removed. Add new analytics destinations to applyConsent().',
    ],
  },
  {
    id: 'C',
    roots: EDGE_ROOTS,
    // The write key or the ingestion host — either one is enough to post events
    // from an edge function without going through the shared emitter.
    pattern: /POSTHOG_PROJECT_KEY|POSTHOG_HOST|\bi\.posthog\.com\b/,
    allow: ['supabase/functions/_shared/analytics.ts'],
    title: 'PostHog ingestion reached outside the shared server emitter',
    fix: [
      'Emit server-side events with `captureServer(event, uid, props, groups)` from',
      '../_shared/analytics.ts. It pins `distinct_id` to the uid, which is what makes a',
      'server event (the Stripe purchase) land on the same person as the browser.',
    ],
  },
];

/**
 * Drop // line and block comments so a mention in prose cannot trip the guard —
 * this seam is described in several docblocks, including this file's own.
 */
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

const rel = (file) => file.split('\\').join('/');

try {
  // "Nothing to check" must never print the same verdict as "checked, clean"
  // (TRIP-282). A missing allowed file means the seam moved or the guard is being
  // run from the wrong directory — either way it is now watching an empty room
  // and would pass anything.
  // Deduped: consent.js is allowed by both A and B, and reporting it twice would
  // read like two different files are gone.
  const missing = [...new Set(RULES.flatMap((r) => r.allow))].filter((f) => !existsSync(f));
  if (missing.length) {
    console.error('::error::check-analytics-seam cannot run — the files it guards are not here:');
    for (const f of missing) console.error(`  ? ${f}`);
    console.error('\nRun it from the repo root. If the seam genuinely moved, update the allow');
    console.error('lists in this guard in the same commit — otherwise it guards nothing, quietly.');
    process.exit(2);
  }

  const failures = [];
  for (const rule of RULES) {
    const allow = new Set(rule.allow);
    const offenders = rule.roots
      .filter(existsSync)
      .flatMap((root) => walk(root))
      .map(rel)
      .filter((f) => !allow.has(f))
      .filter((f) => rule.pattern.test(stripComments(readFileSync(f, 'utf8'))));
    if (offenders.length) failures.push({ rule, offenders });
  }

  if (failures.length) {
    for (const { rule, offenders } of failures) {
      console.error(`::error::2j analytics seam (${rule.id}) — ${rule.title}:`);
      for (const f of offenders) console.error(`  ✗ ${f}`);
      for (const line of rule.fix) console.error(`  ${line}`);
      console.error('');
    }
    process.exit(1);
  }

  console.log('check-analytics-seam: one door per side (events, identity, server) — OK');
  process.exit(0);
} catch (e) {
  console.error(`::error::check-analytics-seam internal error: ${e.message}`);
  process.exit(2);
}
