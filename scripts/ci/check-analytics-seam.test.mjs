#!/usr/bin/env node
/**
 * Tests for CI guard 2j (scripts/ci/check-analytics-seam.mjs).
 *
 * WHY (TRIP-335). The bug this guard prevents already happened once and cost six
 * broken registrations plus a day of investigation: a second place that talked to
 * PostHog directly, and an acquisition channel silently lost forever because
 * `$initial_*` is set-once. The guard is the only machine that can see it — there
 * is no screenshot, no failing test and no error in the logs. So the guard itself
 * gets tested, per the rule in CLAUDE.md.
 *
 * Each test builds a throwaway tree with the seam files in place and runs the
 * guard as a subprocess with cwd pointed at it — end to end, the way CI runs it.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const GUARD = fileURLToPath(new URL('./check-analytics-seam.mjs', import.meta.url));

// The seam as it exists in the repo: the three files the guard allows, plus a
// minimal auth file that satisfies the call-site rules (D/F). Every fixture
// starts from this, so a test only has to describe what it ADDS.
//
// Auth.jsx is here because D fails on ZERO signUp calls (an empty room is not
// "clean", TRIP-282): without a valid signUp somewhere, the seam-passes tests
// would trip D. Its path is one NO other fixture overrides, so adding an A/B/C
// violation elsewhere leaves this valid signUp/provider pair in place and only
// the intended rule fires. PostLoginDoor.jsx is there for the same reason on F,
// which is the same kind of rule: zero call sites is a moved seam, not a clean
// one. It is its OWN file rather than a line inside Auth.jsx precisely because
// the D fixtures replace Auth.jsx wholesale.
const SEAM = {
  'src/lib/analytics.js': "import posthog from 'posthog-js';\nexport function track(e) { posthog?.capture?.(e); }\n",
  'src/lib/destinations/posthog.js': "import posthog from 'posthog-js';\nexport function boot() { posthog.init('phc_x', {}); }\n",
  'supabase/functions/_shared/analytics.ts': "const TOKEN = Deno.env.get('POSTHOG_PROJECT_KEY');\nexport function captureServer() { return TOKEN; }\n",
  'src/pages/Auth.jsx':
    "import { getSignupMarks } from '@/lib/attribution';\n" +
    "export async function signUpEmail() {\n" +
    "  await supabase.auth.signUp({ email, password, options: { data: { signup_attribution: getSignupMarks() || undefined } } });\n" +
    "}\n" +
    "export async function google() {\n" +
    "  await supabase.auth.signInWithOAuth({ provider: 'google' });\n" +
    "}\n",
  'src/pages/PostLoginDoor.jsx':
    "const postLoginHref = () => withVisitCampaign(postLoginPath());\n" +
    "export function go() { window.location.href = postLoginHref(); }\n",
};

function put(dir, path, body) {
  const full = join(dir, path);
  mkdirSync(dirname(full), { recursive: true });
  writeFileSync(full, body);
}

/** Build a tree containing the seam plus `files`, and return its path. */
function fixture(t, files = {}, { seam = SEAM } = {}) {
  const dir = mkdtempSync(join(tmpdir(), 'guard2j-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  for (const [p, body] of Object.entries({ ...seam, ...files })) put(dir, p, body);
  return dir;
}

const run = (cwd) => spawnSync(process.execPath, [GUARD], { cwd, encoding: 'utf8' });

test('the seam as it stands passes', (t) => {
  const r = run(fixture(t));
  assert.equal(r.status, 0, r.stderr);
  assert.match(r.stdout, /one door per side/);
});

test('A: a component importing posthog-js is a violation', (t) => {
  const dir = fixture(t, {
    'src/pages/Login.jsx': "import posthog from 'posthog-js';\nposthog.identify(uid);\n",
  });
  const r = run(dir);
  assert.equal(r.status, 1);
  assert.match(r.stderr, /src\/pages\/Login\.jsx/);
  assert.match(r.stderr, /identifyUser/);
});

test('A: the double-quoted and require() spellings are caught too', (t) => {
  const quoted = run(fixture(t, { 'src/a.js': 'import p from "posthog-js";\n' }));
  assert.equal(quoted.status, 1);
  const required = run(fixture(t, { 'src/b.js': "const p = require('posthog-js');\n" }));
  assert.equal(required.status, 1);
});

// `posthog-js/react` is INSTALLED (node_modules/posthog-js/react) and exports
// usePostHog() onto the same singleton — so a pattern anchored on the bare
// package name lets the most idiomatic React bypass straight through. Same for
// the dynamic import: this repo already lazy-loads that way (invokeFn,
// canon-inspector). Both slipped past the first version of rule A.
test('A: a package subpath is still the same client', (t) => {
  const r = run(fixture(t, {
    'src/pages/Pro.jsx': "import { usePostHog } from 'posthog-js/react';\n",
  }));
  assert.equal(r.status, 1);
  assert.match(r.stderr, /src\/pages\/Pro\.jsx/);
});

test('A: a dynamic import is still the same client', (t) => {
  const r = run(fixture(t, {
    'src/pages/Login.jsx': "const { default: p } = await import('posthog-js');\np.identify(uid);\n",
  }));
  assert.equal(r.status, 1);
  assert.match(r.stderr, /src\/pages\/Login\.jsx/);
});

test('A: reaching the client through the global is caught', (t) => {
  // Optional chaining and globalThis included deliberately: `posthog?.capture?.`
  // is the house style of the seam, so `window?.posthog?.capture` is what a
  // second call site would actually look like here.
  for (const [file, body] of Object.entries({
    'src/pages/Pro.jsx': 'window.posthog.capture("x");\n',
    'src/pages/Trip.jsx': 'window?.posthog?.capture("x");\n',
    'src/pages/Map.jsx': 'globalThis.posthog.capture("x");\n',
    'src/pages/Docs.jsx': "window['posthog'].capture('x');\n",
  })) {
    const r = run(fixture(t, { [file]: body }));
    assert.equal(r.status, 1, `${file} slipped through`);
    assert.match(r.stderr, new RegExp(file.replace(/[/.]/g, '\\$&')));
  }
});

test('A: dev/ counts — it is imported into the browser bundle', (t) => {
  const r = run(fixture(t, { 'dev/canon-inspector/index.js': "import p from 'posthog-js';\n" }));
  assert.equal(r.status, 1);
  assert.match(r.stderr, /dev\/canon-inspector/);
});

// B alone is bypassable by renaming the import (`import p from 'posthog-js'`
// then `p.init(...)`) — found by this very test file on its first run. What
// actually closes that hole is rule A: the import itself is already illegal
// outside the seam. B stays because it also catches an init INSIDE the seam,
// where A cannot see it, and because it gives the consent-specific message.
test('B: a second init is a violation even inside the seam', (t) => {
  const dir = fixture(t, {
    'src/lib/analytics.js': "import posthog from 'posthog-js';\nposthog?.init('phc_x');\n",
  });
  const r = run(dir);
  assert.equal(r.status, 1);
  assert.match(r.stderr, /destination adapter/);
  assert.match(r.stderr, /src\/lib\/analytics\.js/);
});

// The TRIP-407 move: init lived in consent.js, it now lives in the destination
// adapter. consent.js is no longer allowed to init — pins the door where it is.
test('B: init in consent.js is now a violation (init moved to the adapter)', (t) => {
  const dir = fixture(t, {
    'src/lib/consent.js': "import posthog from 'posthog-js';\nposthog.init('phc_x', {});\n",
  });
  const r = run(dir);
  assert.equal(r.status, 1);
  assert.match(r.stderr, /src\/lib\/consent\.js/);
  assert.match(r.stderr, /destination adapter/);
});

test('C: an edge function posting to PostHog itself is a violation', (t) => {
  const dir = fixture(t, {
    'supabase/functions/stripe-webhook/index.ts':
      "const k = Deno.env.get('POSTHOG_PROJECT_KEY');\nfetch('https://eu.i.posthog.com/capture/', { body: k });\n",
  });
  const r = run(dir);
  assert.equal(r.status, 1);
  assert.match(r.stderr, /stripe-webhook/);
  assert.match(r.stderr, /captureServer/);
});

// Pins the ingestion-HOST half of rule C on its own. Without this test the
// `i.posthog.com` alternative could be deleted and the suite stayed 12/12 green
// — the other C fixture trips on the env-var name before the host is ever
// consulted. This is the shape that matters most: the host alone is enough to
// POST, and the body is free to name any distinct_id it likes.
test('C: the ingestion host alone is enough to be a violation', (t) => {
  const dir = fixture(t, {
    'supabase/functions/stripe-webhook/index.ts':
      "const url = 'https://eu.i.posthog.com/i/v0/e/';\n" +
      "fetch(url, { method: 'POST', body: JSON.stringify({ distinct_id: 'whoever' }) });\n",
  });
  const r = run(dir);
  assert.equal(r.status, 1);
  assert.match(r.stderr, /stripe-webhook/);
});

test('C: an edge function using the shared emitter passes', (t) => {
  const dir = fixture(t, {
    'supabase/functions/stripe-webhook/index.ts':
      "import { captureServer } from '../_shared/analytics.ts';\ncaptureServer('purchase_completed', uid);\n",
  });
  assert.equal(run(dir).status, 0);
});

// ── D — the ONE signUp carries the campaign marks (TRIP-456/TRIP-335) ────────

test('D: a signUp without signup_attribution is a violation', (t) => {
  const r = run(fixture(t, {
    'src/pages/Auth.jsx':
      "export async function s() { await supabase.auth.signUp({ email, password, options: { data: { full_name } } }); }\n",
  }));
  assert.equal(r.status, 1);
  assert.match(r.stderr, /signup_attribution/);
  assert.match(r.stderr, /src\/pages\/Auth\.jsx/);
});

test('D: a second signUp is a violation (two birthplaces of an account)', (t) => {
  // Auth.jsx (the seam's valid one) stays; this adds a second, so the tree has two.
  const r = run(fixture(t, {
    'src/pages/Onboard.jsx':
      "export async function s() { await supabase.auth.signUp({ email, password, options: { data: { signup_attribution: m } } }); }\n",
  }));
  assert.equal(r.status, 1);
  assert.match(r.stderr, /birthplace/);
  assert.match(r.stderr, /src\/pages\/Onboard\.jsx/);
});

test('D: zero signUp is an empty room, not clean (TRIP-282)', (t) => {
  // Override the seam's Auth.jsx with a signUp-free version → nothing to check.
  const r = run(fixture(t, {
    'src/pages/Auth.jsx': "export function noop() { return 1; }\n",
  }));
  assert.equal(r.status, 1);
  assert.match(r.stderr, /vanished|no supabase\.auth\.signUp/);
});

test('D: the attribution key mentioned only in a comment does not satisfy the rule', (t) => {
  // The marks must be IN the call, not merely named nearby: masking strips the
  // comment before the arguments are read.
  const r = run(fixture(t, {
    'src/pages/Auth.jsx':
      "export async function s() {\n" +
      "  // signup_attribution rides the data bag\n" +
      "  await supabase.auth.signUp({ email, password });\n" +
      "}\n",
  }));
  assert.equal(r.status, 1);
  assert.match(r.stderr, /signup_attribution/);
});

test('a mention in a comment does not trip the guard', (t) => {
  const dir = fixture(t, {
    'src/pages/Trips.jsx': [
      "// never import posthog-js here — window.posthog is banned too",
      '/* posthog.init() lives in consent.js; POSTHOG_PROJECT_KEY is server-side */',
      'export default function Trips() { return null; }',
    ].join('\n'),
  });
  assert.equal(run(dir).status, 0);
});

test('all three rules report together, not one at a time', (t) => {
  const dir = fixture(t, {
    'src/x.jsx': "import posthog from 'posthog-js';\nposthog.init('phc_x');\n",
    'supabase/functions/y/index.ts': "Deno.env.get('POSTHOG_HOST');\n",
  });
  const r = run(dir);
  assert.equal(r.status, 1);
  assert.match(r.stderr, /\(A\)/);
  assert.match(r.stderr, /\(B\)/);
  assert.match(r.stderr, /\(C\)/);
});

// The TRIP-282 lesson, and the one bypass a whole-tree guard actually has:
// "nothing to check" must not print the same verdict as "checked, clean".
test('a missing seam file fails loudly instead of passing an empty room', (t) => {
  const { 'src/lib/analytics.js': _gone, ...rest } = SEAM;
  const r = run(fixture(t, {}, { seam: rest }));
  assert.equal(r.status, 2);
  assert.match(r.stderr, /src\/lib\/analytics\.js/);
  assert.doesNotMatch(r.stdout, /OK/);
});

test('running from outside the repo root cannot report success', (t) => {
  const dir = mkdtempSync(join(tmpdir(), 'guard2j-empty-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const r = run(dir);
  assert.equal(r.status, 2);
  assert.doesNotMatch(r.stdout, /OK/);
});

// ── F — the post-login destination is decided in one module-scope helper ─────

test('F: postLoginPath() called inline at the door is a violation', (t) => {
  // The One Tap shape that lost a paid signup: the destination decided at the
  // call site, so the "carries the campaign marks" rule is simply not applied.
  const r = run(fixture(t, {
    'src/pages/Login.jsx':
      "export async function oneTap() {\n" +
      "  window.location.href = postLoginPath();\n" +
      "}\n",
  }));
  assert.equal(r.status, 1);
  assert.match(r.stderr, /postLoginHref/);
  assert.match(r.stderr, /src\/pages\/Login\.jsx:2/);
});

test('F: the same call inside a module-scope helper passes', (t) => {
  const r = run(fixture(t, {
    'src/pages/Login.jsx':
      "const postLoginRedirectTo = () => window.location.origin + postLoginPath();\n" +
      "export async function apple() {\n" +
      "  await supabase.auth.signInWithOAuth({ provider: 'apple', options: { redirectTo: postLoginRedirectTo() } });\n" +
      "}\n",
  }));
  assert.equal(r.status, 0, r.stderr); // the helper is the ONE place; nothing else fires
});

test('F: a helper written across two lines is still one place', (t) => {
  // Depth, not line shape, is the predicate: a prettier-wrapped helper is the
  // same single author and must not read as an inline call.
  const r = run(fixture(t, {
    'src/pages/Login.jsx':
      "const postLoginHref = () =>\n" +
      "  withVisitCampaign(postLoginPath());\n" +
      "export function go() { window.location.href = postLoginHref(); }\n",
  }));
  assert.equal(r.status, 0, r.stderr);
});

test('F: zero call sites is a moved seam, not a clean tree', (t) => {
  // An empty room passes anything (TRIP-282). Strip the helper out of the seam
  // and the guard must say the destination seam moved, not "OK".
  const seam = { ...SEAM };
  delete seam['src/pages/PostLoginDoor.jsx'];
  const r = run(fixture(t, {}, { seam }));
  assert.equal(r.status, 1);
  assert.match(r.stderr, /destination seam moved/);
});
