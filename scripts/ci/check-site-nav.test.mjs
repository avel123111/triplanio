#!/usr/bin/env node
/**
 * Tests for CI guard 2ad (scripts/ci/check-site-nav.mjs).
 *
 * The failure this guard prevents is INVISIBLE: an internal `<a href>` looks and
 * behaves like any link, but it reloads the document and drops the entry-URL
 * snapshot, and with it the campaign mark of the visit. There is no screenshot
 * and no failing test for a lost `gclid` — only this guard sees it, so it gets
 * tested, per CLAUDE.md.
 *
 * Each test builds a throwaway zone (the three site-zone paths the guard scans)
 * plus whatever the case ADDS, and runs the guard as a subprocess with cwd on
 * it — end to end, the way CI runs it.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const GUARD = fileURLToPath(new URL('./check-site-nav.mjs', import.meta.url));

// A clean zone: every SITE_ZONE path present, no internal literal href. Anchors
// (#), an external and a dynamic href={SITE} are all fine. Fixtures start here
// and only describe what they ADD (or override).
const ZONE = {
  'src/components/site/SiteChrome.jsx': "export const H = () => <a href=\"#features\">x</a>;\n",
  'src/pages/Landing/LandingPage.jsx': "export const L = () => <a href=\"#how\">x</a>;\n",
  'src/pages/PublicTrip.jsx': "const SITE = f();\nexport const P = () => <a href={SITE}>x</a>;\n",
  'src/pages/Login.jsx': "import { Link } from 'react-router-dom';\nexport const Lg = () => <Link to=\"/\">home</Link>;\n",
  'src/pages/JoinTrip.jsx': "export const J = () => { nav('/trips'); return null; };\n",
};

function put(dir, path, body) {
  const full = join(dir, path);
  mkdirSync(dirname(full), { recursive: true });
  writeFileSync(full, body);
}

/** Build a tree containing the zone plus `files`, and return its path. */
function fixture(t, files = {}, { zone = ZONE } = {}) {
  const dir = mkdtempSync(join(tmpdir(), 'guard2ad-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  for (const [p, body] of Object.entries({ ...zone, ...files })) put(dir, p, body);
  return dir;
}

const run = (cwd) => spawnSync(process.execPath, [GUARD], { cwd, encoding: 'utf8' });

test('the zone as it stands passes', (t) => {
  const r = run(fixture(t));
  assert.equal(r.status, 0, r.stderr);
  assert.match(r.stdout, /go through the router/);
});

test('an internal literal href is a violation', (t) => {
  const r = run(fixture(t, {
    'src/pages/Landing/Extra.jsx': "export const E = () => <a href=\"/trips\">go</a>;\n",
  }));
  assert.equal(r.status, 1);
  assert.match(r.stderr, /src\/pages\/Landing\/Extra\.jsx/);
  assert.match(r.stderr, /href="\/trips"/);
});

test('a nav-exempt marker for that path rescues it', (t) => {
  const r = run(fixture(t, {
    'src/pages/Landing/Extra.jsx':
      "export const E = () => (\n" +
      "  /* nav-exempt: /terms — статический HTML до Ф6 (vercel.json rewrite) */\n" +
      "  <a href=\"/terms\">legal</a>\n" +
      ");\n",
  }));
  assert.equal(r.status, 0, r.stderr);
});

test('a marker for a DIFFERENT path does not rescue the link', (t) => {
  const r = run(fixture(t, {
    'src/pages/Landing/Extra.jsx':
      "export const E = () => (\n" +
      "  /* nav-exempt: /terms — not this link */\n" +
      "  <a href=\"/trips\">go</a>\n" +
      ");\n",
  }));
  assert.equal(r.status, 1);
  assert.match(r.stderr, /href="\/trips"/);
});

test('external, anchor, mailto and dynamic hrefs are not flagged', (t) => {
  const r = run(fixture(t, {
    'src/pages/Landing/Extra.jsx':
      "export const E = () => (<>\n" +
      "  <a href=\"https://triplanio.com/x\">ext</a>\n" +
      "  <a href=\"#faq\">anchor</a>\n" +
      "  <a href=\"mailto:hi@triplanio.com\">mail</a>\n" +
      "  <a href=\"//cdn.example.com/x\">proto-rel</a>\n" +
      "  <a href={target}>dyn</a>\n" +
      "</>);\n",
  }));
  assert.equal(r.status, 0, r.stderr);
});

test('a DOM property assignment link.href = "/x" is not a JSX attribute', (t) => {
  const r = run(fixture(t, {
    'src/components/site/useCss.js':
      "export function boot() { const link = document.createElement('link'); link.href = '/site.css'; }\n",
  }));
  assert.equal(r.status, 0, r.stderr);
});

test('a commented-out internal link does not trip the guard', (t) => {
  const r = run(fixture(t, {
    'src/pages/Landing/Extra.jsx':
      "export const E = () => (\n" +
      "  // <a href=\"/trips\">old</a>\n" +
      "  <a href=\"#top\">up</a>\n" +
      ");\n",
  }));
  assert.equal(r.status, 0, r.stderr);
});

// Perimeter pins (Pavel's review). The zone must cover the pages where the
// attribution machinery is densest. A violation placed in Login.jsx must be
// caught — so if a future edit drops 'src/pages/Login.jsx' from SITE_ZONE, the
// guard stops scanning the fixture's Login.jsx, passes it, and THIS test turns
// red. That is what stops the perimeter from being silently narrowed back.
test('a violation in Login.jsx is caught — Login is inside the perimeter', (t) => {
  const r = run(fixture(t, {
    'src/pages/Login.jsx': "export const Lg = () => <a href=\"/\">home</a>;\n",
  }));
  assert.equal(r.status, 1);
  assert.match(r.stderr, /src\/pages\/Login\.jsx/);
  assert.match(r.stderr, /href="\/"/);
});

// The boundary is deliberate: the zone is NOT all of src/pages. An authed app
// screen reloading to an internal route is fine (nothing to attribute there),
// so a violation outside the zone stays green.
test('a file outside the zone is not scanned (the perimeter is deliberate)', (t) => {
  const r = run(fixture(t, {
    'src/pages/TripScreen.jsx': "export const T = () => <a href=\"/trips\">go</a>;\n",
  }));
  assert.equal(r.status, 0, r.stderr);
});

// The TRIP-282 lesson: "nothing to check" must not read as "checked, clean".
test('a missing zone path fails loudly instead of scanning an empty room', (t) => {
  const { 'src/pages/PublicTrip.jsx': _gone, ...rest } = ZONE;
  const r = run(fixture(t, {}, { zone: rest }));
  assert.equal(r.status, 2);
  assert.match(r.stderr, /src\/pages\/PublicTrip\.jsx/);
  assert.doesNotMatch(r.stdout, /OK/);
});

test('running from outside the repo root cannot report success', (t) => {
  const dir = mkdtempSync(join(tmpdir(), 'guard2ad-empty-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const r = run(dir);
  assert.equal(r.status, 2);
  assert.doesNotMatch(r.stdout, /OK/);
});
