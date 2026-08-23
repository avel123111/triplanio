#!/usr/bin/env node
/**
 * Tests for CI guard 2ac (scripts/ci/check-site-prefixes.mjs) — the namespace
 * ratchet for public/site.css (TRIP-446 Ф1).
 *
 * A CI guard is code, so it gets a test (TRIP-282). Each case builds a throwaway
 * git repo, commits a "base", commits a "head", and runs the guard as a
 * subprocess with BASE_REF at the base commit — the guard exercised end to end
 * the way CI runs it. A green test means nothing until the same assertion has
 * been seen RED: the red cases below (`code === 1`) are that proof.
 *
 * The load-bearing case is the BOOTSTRAP: on the introducing PR the file is
 * `public/landing.css` on the base and `public/site.css` on HEAD. The guard
 * must resolve the base by name and stay green, not read the base as empty and
 * flag every primitive.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const GUARD = fileURLToPath(new URL('./check-site-prefixes.mjs', import.meta.url));

const git = (cwd, args) =>
  execFileSync('git', args, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });

function put(dir, path, body) {
  const full = join(dir, path);
  mkdirSync(dirname(full), { recursive: true });
  writeFileSync(full, body);
}

/**
 * Build a repo with two commits. `base` is the PR base, `head` is applied on
 * top. `renames` runs `git mv` between the two so the rename (landing→site) can
 * be exercised; `removes` runs `git rm`.
 */
function fixture(t, { base = {}, head = {}, renames = [], removes = [] }) {
  const dir = mkdtempSync(join(tmpdir(), 'guard2ac-'));
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
  for (const p of removes) git(dir, ['rm', '-q', p]);
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

const SITE = 'public/site.css';
const LANDING = 'public/landing.css';
// A base file with the primitive families that live in site.css today.
const primitives = '.btn{color:#000}\n.btn--primary{}\n.header{}\n.footer{}\n.container{}\n.eyebrow{}\n';

/* ────────────────────────────── the ratchet ─────────────────────────────── */

test('a brand-new prefix in site.css → fail', (t) => {
  const f = fixture(t, {
    base: { [SITE]: primitives },
    head: { [SITE]: primitives + '.auth-card{}\n' },
  });
  const r = run(f);
  assert.equal(r.code, 1, r.out);
  assert.match(r.out, /auth/);
});

test('extending an existing family (.btn--sm) → pass', (t) => {
  const f = fixture(t, {
    base: { [SITE]: primitives },
    head: { [SITE]: primitives + '.btn--sm{}\n' },
  });
  assert.equal(run(f).code, 0, run(f).out);
});

test('removing a family → pass (deletion is always free)', (t) => {
  const f = fixture(t, {
    base: { [SITE]: primitives + '.eyebrow{}\n' },
    head: { [SITE]: '.btn{}\n.header{}\n' },
  });
  assert.equal(run(f).code, 0);
});

/* ───────────────────────────── the bootstrap ─────────────────────────────── */

test('★ bootstrap: base file is landing.css, head is site.css, same prefixes → pass', (t) => {
  const f = fixture(t, {
    base: { [LANDING]: primitives },
    renames: [[LANDING, SITE]],
    head: { [SITE]: primitives }, // dead :root removed etc. — no new class prefix
  });
  const r = run(f);
  assert.equal(r.code, 0, r.out);
  assert.match(r.out, /bootstrap|pre-rename/i);
});

test('★ bootstrap does not disable the ratchet: new prefix vs landing.css base → fail', (t) => {
  const f = fixture(t, {
    base: { [LANDING]: primitives },
    renames: [[LANDING, SITE]],
    head: { [SITE]: primitives + '.doc-body{}\n' },
  });
  const r = run(f);
  assert.equal(r.code, 1, r.out);
  assert.match(r.out, /doc/);
});

/* ──────────────────────────────── the escape ────────────────────────────── */

test('prefix-exempt marker blesses an approved new family → pass', (t) => {
  const f = fixture(t, {
    base: { [SITE]: primitives },
    head: { [SITE]: primitives + '/* prefix-exempt: auth — экран логина Ф6, апрув Pavel */\n.auth-card{}\n' },
  });
  assert.equal(run(f).code, 0, run(f).out);
});

/* ─────────────────────── false positives it must not have ────────────────── */

test('a dot inside a declaration string is not a class', (t) => {
  const f = fixture(t, {
    base: { [SITE]: primitives },
    head: { [SITE]: primitives + '.btn::before{content:".auth"}\n' },
  });
  assert.equal(run(f).code, 0, 'a string literal must not read as a new namespace');
});

test('the .site token host class is not itself a namespace → pass', (t) => {
  // `html.site { --tokens }` introduces a `.site` class that no base had. It is
  // the DS token host, not a component family, and must not be flagged.
  const f = fixture(t, {
    base: { [LANDING]: primitives },
    renames: [[LANDING, SITE]],
    head: { [SITE]: 'html.site{--ink:#000}\n' + primitives },
  });
  assert.equal(run(f).code, 0, run(f).out);
});

test('a .site-foo family IS still a new namespace → fail (host exclusion is not a hole)', (t) => {
  const f = fixture(t, {
    base: { [SITE]: 'html.site{--ink:#000}\n' + primitives },
    head: { [SITE]: 'html.site{--ink:#000}\n' + primitives + '.site-card{}\n' },
  });
  const r = run(f);
  assert.equal(r.code, 1, r.out);
  assert.match(r.out, /site/);
});

/* ────────────────────────────── plumbing ────────────────────────────────── */

test('site.css absent on HEAD → nothing to check (pass)', (t) => {
  const f = fixture(t, { base: { [SITE]: primitives }, removes: [SITE] });
  const r = run(f);
  assert.equal(r.code, 0, r.out);
  assert.match(r.out, /absent|nothing/i);
});

test('unresolvable BASE_REF is skipped, not guessed', (t) => {
  const f = fixture(t, { base: { [SITE]: primitives }, head: { [SITE]: primitives + '.auth-x{}\n' } });
  const r = run(f, { ref: 'refs/heads/no-such-branch' });
  assert.equal(r.code, 0, 'a shallow clone or fresh fork must not fail the build');
  assert.match(r.out, /skip/i);
});

test('run from a subdirectory still judges the file', (t) => {
  // Reads resolve from cwd; a run from anywhere but the repo root used to report
  // "nothing to check" on any amount of dirt. It must chdir to the toplevel.
  const f = fixture(t, {
    base: { [SITE]: primitives },
    head: { [SITE]: primitives + '.auth-x{}\n' },
  });
  assert.equal(run(f, { cwd: 'public' }).code, 1, 'a subdirectory run must not go green');
});

test('unknown flag is rejected (no baseline to refresh)', (t) => {
  const f = fixture(t, { base: { [SITE]: primitives }, head: { [SITE]: primitives } });
  const r = run(f, { args: ['--write'] });
  assert.equal(r.code, 2);
  assert.match(r.out, /unknown flag|--write/i);
});
