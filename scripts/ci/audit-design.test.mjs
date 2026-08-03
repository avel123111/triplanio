#!/usr/bin/env node
/**
 * Tests for the design-layer audit (scripts/ci/audit-design.mjs).
 *
 * WHY (TRIP-321). The load-bearing part of this script is the ALIAS
 * CLASSIFIER, and the obvious version of it is wrong in a way that ships a
 * production bug: "the value is a pure var()" marks theme handles, state
 * handles and token-island names as deletable synonyms. Collapsing those
 * repaints the dark header, kills the warm finish marker and changes five
 * colours on the auth screen. Both the original TRIP-321 plan AND the first
 * review of it produced a hand-made "safe to delete" list; both lists were
 * wrong, in different places. So the classifier gets a test before anything is
 * deleted on its say-so.
 *
 * The three trap shapes below are lifted from real declarations in
 * src/design/app.css and src/pages/login.css.
 *
 * Each test writes a throwaway CSS/JSX tree and runs the script as a
 * subprocess with AUDIT_ROOT pointing at it, the way CI runs it.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const SCRIPT = fileURLToPath(new URL('./audit-design.mjs', import.meta.url));

function fixture(t, files) {
  const dir = mkdtempSync(join(tmpdir(), 'audit-design-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  for (const [p, body] of Object.entries(files)) {
    const full = join(dir, p);
    mkdirSync(dirname(full), { recursive: true });
    writeFileSync(full, body);
  }
  return dir;
}

function run(dir) {
  const r = spawnSync(process.execPath, [SCRIPT, '--json'], {
    env: { ...process.env, AUDIT_ROOT: dir },
    encoding: 'utf8',
  });
  assert.equal(r.status, 0, `script failed:\n${r.stderr}`);
  return JSON.parse(r.stdout);
}

const names = (list) => list.map((x) => x.name);

// ── The alias classifier: the three traps ───────────────────────────────────

test('a token defined once as a pure var() IS a collapsible synonym', (t) => {
  const out = run(fixture(t, { 'a.css': ':root { --surface-2: #eee; --wash: var(--surface-2); }' }));
  assert.deepEqual(names(out.synonyms), ['--wash']);
  assert.equal(out.synonyms[0].target, '--surface-2');
  assert.deepEqual(names(out.handles), []);
});

test('TRAP 1 — a theme handle is NOT a synonym (--header-bg: light vs dark)', (t) => {
  const out = run(
    fixture(t, {
      'a.css': `
      :root { --header-bg: var(--surface); }
      :root[data-theme="dark"] { --header-bg: var(--bg); }`,
    }),
  );
  assert.deepEqual(names(out.synonyms), [], 'a theme handle must never be offered for deletion');
  assert.deepEqual(names(out.handles), ['--header-bg']);
});

test('TRAP 2 — a component state handle is NOT a synonym (--tmk on .tmk--finish)', (t) => {
  const out = run(
    fixture(t, {
      'a.css': `
      .tmk { --tmk: var(--brand); }
      .tmk--finish { --tmk: var(--warm); }`,
    }),
  );
  assert.deepEqual(names(out.synonyms), []);
  assert.deepEqual(names(out.handles), ['--tmk']);
});

test('TRAP 3 — a token island is NOT a synonym (--wash: var() in :root, literal in .auth)', (t) => {
  const out = run(
    fixture(t, {
      'app.css': ':root { --wash: var(--surface-2); }',
      'login.css': '.auth { --wash: #F7F8FA; }',
    }),
  );
  assert.deepEqual(
    names(out.synonyms),
    [],
    'login.css is a separate token island — substituting the target repaints the auth screen',
  );
  assert.deepEqual(names(out.handles), ['--wash']);
});

test('the island trap is caught even though login.css is out of SCOPE for the counts', (t) => {
  const out = run(
    fixture(t, {
      'app.css': ':root { --brand-600: var(--primary-hover); } .x { color: var(--brand-600); }',
      'login.css': '.auth { --brand-600: #1b58c4; }',
    }),
  );
  // Out-of-scope files are excluded from family/class counts but MUST still be
  // scanned for definitions — that is the whole point of the trap.
  assert.deepEqual(names(out.handles), ['--brand-600']);
  assert.deepEqual(names(out.synonyms), []);
});

test('MIRROR TRAP — a clean alias whose TARGET is re-pointed on a descendant needs eyeballing', (t) => {
  const out = run(
    fixture(t, {
      'app.css': ':root { --r-btn: 12px; --r-control: var(--r-btn); }',
      'login.css': '.auth { --r-btn: 8px; }',
    }),
  );
  assert.deepEqual(names(out.synonyms), [], 'not safe: inside .auth the two names differ');
  assert.deepEqual(names(out.checkTargets), ['--r-control']);
  assert.deepEqual(out.checkTargets[0].splitScopes, ['.auth']);
});

test('a target re-pointed only across THEMES is still safe (same element)', (t) => {
  // :root and :root[data-theme=dark] match the same element, so --x and --y
  // resolve together — this must NOT be demoted, or every token in the file
  // ends up in the manual pile and the tool stops being useful.
  const out = run(
    fixture(t, {
      'app.css': `
      :root { --surface-2: #eee; --secondary: var(--surface-2); }
      :root[data-theme="dark"] { --surface-2: #222; }`,
    }),
  );
  assert.deepEqual(names(out.synonyms), ['--secondary']);
  assert.deepEqual(names(out.checkTargets), []);
});

test('two different targets under the same name is a handle, not a synonym', (t) => {
  const out = run(
    fixture(t, { 'a.css': '.p { --x: var(--a); } .q { --x: var(--b); }' }),
  );
  assert.deepEqual(names(out.synonyms), []);
  assert.deepEqual(names(out.handles), ['--x']);
});

test('a definition with no trailing `;` (last in its block) is still seen', (t) => {
  // Real shape from PublicTrip.css: `.pt-itin{--num:38px;--gap:13px}`.
  // A missed definition is the one failure that matters — it can hide the
  // second, re-pointed definition and promote a handle into "safe to collapse".
  const out = run(fixture(t, { 'a.css': ':root{--x:var(--y)}' }));
  assert.deepEqual(names(out.synonyms), ['--x']);
});

test('a handle is still a handle when its second definition has no trailing `;`', (t) => {
  const out = run(
    fixture(t, { 'a.css': '.p{--x:var(--a);} .q{--x:var(--b)}' }),
  );
  assert.deepEqual(names(out.synonyms), [], 'the `;`-less definition must not be invisible');
  assert.deepEqual(names(out.handles), ['--x']);
});

test('a token that is never a pure var() is not reported at all', (t) => {
  const out = run(fixture(t, { 'a.css': ':root { --c: #fff; --d: calc(var(--e) - 4px); }' }));
  assert.deepEqual(names(out.synonyms), []);
  assert.deepEqual(names(out.handles), []);
});

test('definitions are found inside @media and multiple-per-line', (t) => {
  const out = run(
    fixture(t, {
      'a.css': `
      :root { --p: var(--q); --r: var(--s); }
      @media (max-width: 640px) { :root { --p: var(--other); } }`,
    }),
  );
  assert.deepEqual(names(out.synonyms), ['--r'], '--p is re-pointed inside @media → handle');
  assert.deepEqual(names(out.handles), ['--p']);
});

// ── Counts ──────────────────────────────────────────────────────────────────

test('out-of-scope files do not contribute to family/class counts', (t) => {
  const out = run(
    fixture(t, {
      'app.css': '.aa-one { color: red; } .aa-two { color: red; }',
      'login.css': '.zz-only-here { color: red; }',
    }),
  );
  assert.equal(out.families, 1, 'only the `aa` family counts');
  assert.equal(out.classes, 2);
});

test('inline styles are counted in scope and overall', (t) => {
  const out = run(
    fixture(t, {
      'A.jsx': 'const a = <i style={{width: 1}}/>; const b = <i style={{top: 2}}/>;',
      'Landing/B.jsx': 'const c = <i style={{left: 3}}/>;',
    }),
  );
  assert.equal(out.inlineScoped, 2);
  assert.equal(out.inlineAll, 3);
});

test('a shape repeated across 4+ families is reported, across 3 is not', (t) => {
  const body = 'display: flex; align-items: center; gap: 8px;';
  const three = run(
    fixture(t, { 'a.css': `.aa-x{${body}} .bb-x{${body}} .cc-x{${body}}` }),
  );
  assert.equal(three.dupShapes, 0, '3 families is under the threshold');

  const four = run(
    fixture(t, { 'a.css': `.aa-x{${body}} .bb-x{${body}} .cc-x{${body}} .dd-x{${body}}` }),
  );
  assert.equal(four.dupShapes, 1);
  assert.equal(four.dupShapeRules, 4);
});

test('a rule with fewer than 3 properties is a tweak, not a shape', (t) => {
  const out = run(
    fixture(t, { 'a.css': '.aa-x{display:flex;gap:8px} .bb-x{display:flex;gap:8px} .cc-x{display:flex;gap:8px} .dd-x{display:flex;gap:8px}' }),
  );
  assert.equal(out.dupShapes, 0);
});

test('custom properties do not count as shape properties', (t) => {
  // `--ev-color` style parameters would otherwise inflate every shape signature.
  const out = run(
    fixture(t, { 'a.css': '.aa-x{--p:1;--q:2;display:flex}' }),
  );
  assert.equal(out.dupShapes, 0);
});
