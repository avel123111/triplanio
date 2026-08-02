#!/usr/bin/env node
/**
 * Tests for CI guard 2m (scripts/ci/check-css-prefixes.mjs).
 *
 * Template: check-inline-styles.test.mjs (2l) — a throwaway git repo per test,
 * a "base" commit and a "head" commit, the guard run as a subprocess with
 * BASE_REF pointing at the base, assertions on the exit code. The guard is
 * exercised end to end, the way CI runs it.
 *
 * What matters most here is what the guard must NOT flag: the whole point of
 * TRIP-321 Ф3 is renaming/deleting classes in bulk while collapsing screens,
 * and the dead radius fence proved a guard keyed on selector text blocks
 * exactly that work. These tests pin the safe cases green.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const GUARD = fileURLToPath(new URL('./check-css-prefixes.mjs', import.meta.url));

const git = (cwd, args) =>
  execFileSync('git', args, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });

function put(dir, path, body) {
  const full = join(dir, path);
  mkdirSync(dirname(full), { recursive: true });
  writeFileSync(full, body);
}

function fixture(t, { base = {}, head = {}, renames = [] }) {
  const dir = mkdtempSync(join(tmpdir(), 'guard2m-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));

  git(dir, ['init', '-q', '-b', 'main']);
  git(dir, ['config', 'user.email', 'guard@test']);
  git(dir, ['config', 'user.name', 'guard']);
  git(dir, ['config', 'commit.gpgsign', 'false']);
  git(dir, ['config', 'core.hooksPath', '/dev/null']);

  for (const [p, body] of Object.entries(base)) put(dir, p, body);
  put(dir, '.keep', '');
  git(dir, ['add', '-A']);
  git(dir, ['commit', '-qm', 'base']);
  const baseRef = git(dir, ['rev-parse', 'HEAD']).trim();

  for (const [from, to] of renames) {
    mkdirSync(dirname(join(dir, to)), { recursive: true });
    git(dir, ['mv', from, to]);
  }
  for (const [p, body] of Object.entries(head)) put(dir, p, body);
  git(dir, ['add', '-A']);
  git(dir, ['commit', '-qm', 'head', '--allow-empty']);

  return { dir, baseRef };
}

function run({ dir, baseRef }, { args = [], ref, cwd } = {}) {
  const r = spawnSync(process.execPath, [GUARD, ...args], {
    cwd: cwd ? join(dir, cwd) : dir,
    encoding: 'utf8',
    env: { ...process.env, BASE_REF: ref ?? baseRef },
  });
  return { code: r.status, out: `${r.stdout}${r.stderr}` };
}

/** The app as it exists: two established namespaces spread over two files. */
const APP_CSS = '.acct-hero { color: red; }\n.acct-row { display: flex; }\n.btn { border: 0; }\n.btn--ai { color: blue; }\n';
const LENS_CSS = '.bgt-exrow { gap: 8px; }\n';

/* ─────────────────────────── what must go red ────────────────────────────── */

test('a new prefix in a modified file → fail, named in the output', (t) => {
  const f = fixture(t, {
    base: { 'src/design/app.css': APP_CSS },
    head: { 'src/design/app.css': APP_CSS + '.xyz-card { padding: 4px; }\n' },
  });
  const r = run(f);
  assert.equal(r.code, 1);
  assert.match(r.out, /new prefix "xyz"/);
  assert.match(r.out, /xyz-card/);
});

test('a NEW file bringing its own namespace → fail (the mockup-port hole)', (t) => {
  const f = fixture(t, {
    base: { 'src/design/app.css': APP_CSS },
    head: { 'src/pages/NewScreen.css': '.ns-wrap { display: flex; }\n.ns-tile { width: 24px; }\n' },
  });
  const r = run(f);
  assert.equal(r.code, 1);
  assert.match(r.out, /new prefix "ns"/);
});

test('a new DASHLESS class is its own namespace → fail', (t) => {
  // Rule #6: a new shared/utility class NAME needs approval, same as a family.
  const f = fixture(t, {
    base: { 'src/design/app.css': APP_CSS },
    head: { 'src/design/app.css': APP_CSS + '.glow { filter: blur(2px); }\n' },
  });
  assert.equal(run(f).code, 1);
});

test('a new prefix that hides inside @media only → still seen, fail', (t) => {
  const f = fixture(t, {
    base: { 'src/design/app.css': APP_CSS },
    head: { 'src/design/app.css': APP_CSS + '@media (max-width: 640px) { .zz-bar { top: 0; } }\n' },
  });
  const r = run(f);
  assert.equal(r.code, 1, r.out);
  assert.match(r.out, /new prefix "zz"/);
});

/* ────────────── what must stay green (the Ф3 clean-up path) ─────────────── */

test('extending an EXISTING family is normal work → pass', (t) => {
  const f = fixture(t, {
    base: { 'src/design/app.css': APP_CSS },
    head: { 'src/design/app.css': APP_CSS + '.acct-newthing { margin: 0; }\n.btn--warn { color: red; }\n' },
  });
  assert.equal(run(f).code, 0);
});

test('deleting a family (screen collapse) → pass', (t) => {
  const f = fixture(t, {
    base: { 'src/design/app.css': APP_CSS, 'src/pages/BudgetLens.css': LENS_CSS },
    head: { 'src/pages/BudgetLens.css': '/* collapsed into the design system */\n' },
  });
  assert.equal(run(f).code, 0);
});

test('moving a family between files → pass (the ceiling is global, not per-file)', (t) => {
  const f = fixture(t, {
    base: { 'src/design/app.css': APP_CSS, 'src/pages/BudgetLens.css': LENS_CSS },
    head: {
      'src/design/app.css': APP_CSS + LENS_CSS,
      'src/pages/BudgetLens.css': '\n',
    },
  });
  assert.equal(run(f).code, 0);
});

test('git mv with no content change → pass', (t) => {
  const f = fixture(t, {
    base: { 'src/pages/Old.css': LENS_CSS },
    renames: [['src/pages/Old.css', 'src/pages/sub/New.css']],
  });
  assert.equal(run(f).code, 0);
});

test('an approved new family ships with a prefix-exempt marker → pass', (t) => {
  const f = fixture(t, {
    base: { 'src/design/app.css': APP_CSS },
    head: {
      'src/design/app.css':
        APP_CSS +
        '/* prefix-exempt: row — примитивы раскладки TRIP-321 Ф2, апрув Pavel */\n' +
        '.row { display: flex; align-items: center; }\n.row--wrap { flex-wrap: wrap; }\n',
    },
  });
  const r = run(f);
  assert.equal(r.code, 0, r.out);
});

test('the marker frees ONLY the named prefix, not the whole PR', (t) => {
  const f = fixture(t, {
    base: { 'src/design/app.css': APP_CSS },
    head: {
      'src/design/app.css':
        APP_CSS +
        '/* prefix-exempt: row — апрув */\n.row { display: flex; }\n.smuggled-in { color: red; }\n',
    },
  });
  const r = run(f);
  assert.equal(r.code, 1, 'an unrelated new prefix must not ride in on someone else\'s marker');
  assert.match(r.out, /new prefix "smuggled"/);
});

/* ──────────────────── false positives it must not have ──────────────────── */

test('declaration bodies are not selector text: url(x.png), rgba(0,.5), 0.5px', (t) => {
  const f = fixture(t, {
    base: { 'src/design/app.css': APP_CSS },
    head: {
      'src/design/app.css':
        APP_CSS +
        '.acct-bg { background: url(hero.png) rgba(0, 0, 0, .5); border-width: .5px; }\n',
    },
  });
  const r = run(f);
  assert.equal(r.code, 0, `.png / .5 inside a declaration must not read as a class:\n${r.out}`);
});

test('a class name inside a comment is prose, not a selector', (t) => {
  const f = fixture(t, {
    base: { 'src/design/app.css': APP_CSS },
    head: { 'src/design/app.css': APP_CSS + '/* TODO: fold .legacy-junk into .acct-row */\n' },
  });
  assert.equal(run(f).code, 0);
});

test('an untouched file with a lonely namespace is not re-judged', (t) => {
  const f = fixture(t, {
    base: { 'src/design/app.css': APP_CSS, 'src/pages/Legacy.css': '.oldzoo-tile { width: 9px; }\n' },
    head: { 'src/design/app.css': APP_CSS + '.acct-extra { margin: 0; }\n' },
  });
  assert.equal(run(f).code, 0);
});

/* ────────────────────────────── plumbing ────────────────────────────────── */

test('no CSS touched → "nothing to check", pass', (t) => {
  const f = fixture(t, {
    base: { 'src/design/app.css': APP_CSS },
    head: { 'src/pages/A.jsx': 'export const A = () => null;\n' },
  });
  const r = run(f);
  assert.equal(r.code, 0);
  assert.match(r.out, /nothing to check/);
});

test('unresolvable BASE_REF is skipped, not guessed', (t) => {
  const f = fixture(t, {
    base: { 'src/design/app.css': APP_CSS },
    head: { 'src/design/app.css': APP_CSS + '.xyz-card { padding: 4px; }\n' },
  });
  const r = run(f, { ref: 'refs/heads/no-such-branch' });
  assert.equal(r.code, 0);
  assert.match(r.out, /skip/i);
});

test('run from a subdirectory still judges the whole diff', (t) => {
  const f = fixture(t, {
    base: { 'src/design/app.css': APP_CSS },
    head: { 'src/design/app.css': APP_CSS + '.xyz-card { padding: 4px; }\n' },
  });
  assert.equal(run(f, { cwd: 'src' }).code, 1, 'a subdirectory run must not go green');
});

test('non-src CSS is out of scope', (t) => {
  const f = fixture(t, {
    base: { 'src/design/app.css': APP_CSS },
    head: { 'scripts/tooling.css': '.toolzoo-x { color: red; }\n' },
  });
  assert.equal(run(f).code, 0);
});

test('unknown flags are refused, not ignored', (t) => {
  const f = fixture(t, {
    base: { 'src/design/app.css': APP_CSS },
    head: { 'src/design/app.css': APP_CSS + '.xyz-card { padding: 4px; }\n' },
  });
  const r = run(f, { args: ['--write'] });
  assert.equal(r.code, 2);
  assert.match(r.out, /unknown flag/);
});
