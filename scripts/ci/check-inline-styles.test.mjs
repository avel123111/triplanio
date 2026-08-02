#!/usr/bin/env node
/**
 * Tests for CI guard 2l (scripts/ci/check-inline-styles.mjs).
 *
 * WHY this file exists (TRIP-282). The first cut of 2l was a ratchet that
 * compared the tree against a JSON baseline the PR itself could edit. Three
 * bypasses shipped green: raising a ceiling by hand, deleting the baseline and
 * re-seeding it with `--write`, and adding a brand-new file (the `--write`
 * count check was skipped when the file had no previous entry — exactly how
 * ManualPlanner.jsx was born with 145 inline styles, TRIP-321). None of that
 * was caught by CI, because the repo has twelve guards and no test for any of
 * them. This is the first one; it is meant to be the template for the rest.
 *
 * Each test builds a throwaway git repo, commits a "base", commits a "head",
 * and runs the guard as a subprocess with BASE_REF pointing at the base commit
 * — i.e. the guard is exercised end to end, the way CI runs it.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const GUARD = fileURLToPath(new URL('./check-inline-styles.mjs', import.meta.url));
const REPO_ROOT = fileURLToPath(new URL('../..', import.meta.url));

const git = (cwd, args) =>
  execFileSync('git', args, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });

function put(dir, path, body) {
  const full = join(dir, path);
  mkdirSync(dirname(full), { recursive: true });
  writeFileSync(full, body);
}

/**
 * Build a repo with two commits. `base` is the PR base, `head` is applied on
 * top of it. `renames` runs `git mv` between the two commits so rename
 * detection can be exercised.
 */
function fixture(t, { base = {}, head = {}, renames = [] }) {
  const dir = mkdtempSync(join(tmpdir(), 'guard2l-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));

  git(dir, ['init', '-q', '-b', 'main']);
  git(dir, ['config', 'user.email', 'guard@test']);
  git(dir, ['config', 'user.name', 'guard']);
  // A developer's global gpgsign / hooksPath would otherwise break the fixture
  // and report it as a guard failure.
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

/** A file with `n` byte-identical inline styles. */
const repeated = (n) =>
  `export const C = () => <>${'<i style={{ flex: 1, minWidth: 0 }}/>'.repeat(n)}</>;\n`;

/** A file with `n` inline styles that are all different. */
const unique = (n) =>
  `export const C = () => <>${Array.from({ length: n }, (_, i) => `<i style={{ marginTop: ${i}, zIndex: ${i} }}/>`).join('')}</>;\n`;

/* ─────────────────────── the three shipped bypasses ─────────────────────── */

test('a committed baseline artifact no longer exists (it was the bypass)', () => {
  assert.equal(
    existsSync(join(REPO_ROOT, 'scripts/ci/inline-style-baseline.json')),
    false,
    'the ceiling must live on the base branch, not in a file this PR can edit',
  );
});

test('--write is gone: the guard refuses the flag instead of rewriting a ceiling', (t) => {
  const f = fixture(t, { base: { 'src/A.jsx': repeated(4) }, head: { 'src/A.jsx': repeated(9) } });
  const r = run(f, { args: ['--write'] });
  assert.notEqual(r.code, 0, '--write must not be a way to bless a regression');
  assert.match(r.out, /unknown flag|--write/i);
});

test('a NEW file may not be born with inline styles (the ManualPlanner hole)', (t) => {
  const f = fixture(t, { base: {}, head: { 'src/New.jsx': unique(40) } });
  const r = run(f);
  assert.equal(r.code, 1, 'a new file with 40 unique inline styles must fail');
  assert.match(r.out, /src\/New\.jsx/);
});

/* ───────────────────────────── the ratchet ──────────────────────────────── */

test('count grew against the base branch → fail', (t) => {
  const f = fixture(t, { base: { 'src/A.jsx': unique(3) }, head: { 'src/A.jsx': unique(4) } });
  const r = run(f);
  assert.equal(r.code, 1);
  assert.match(r.out, /src\/A\.jsx/);
});

test('count shrank → pass', (t) => {
  const f = fixture(t, { base: { 'src/A.jsx': unique(5) }, head: { 'src/A.jsx': unique(2) } });
  assert.equal(run(f).code, 0);
});

test('a NEW group of 3 identical inline styles → fail', (t) => {
  // Count does not grow (5 → 5), so a count-only ratchet would wave this
  // through. The repetition itself is the defect being guarded.
  const f = fixture(t, { base: { 'src/A.jsx': unique(5) }, head: { 'src/A.jsx': repeated(3) + unique(2) } });
  const r = run(f);
  assert.equal(r.code, 1);
  assert.match(r.out, /3 identical inline styles/);
});

test('a repeated group that already existed may stay, but not grow', (t) => {
  const keep = fixture(t, { base: { 'src/A.jsx': repeated(3) }, head: { 'src/A.jsx': repeated(3) } });
  assert.equal(run(keep).code, 0, 'existing debt is grandfathered');

  const grow = fixture(t, { base: { 'src/A.jsx': repeated(3) }, head: { 'src/A.jsx': repeated(4) } });
  assert.equal(run(grow).code, 1, 'existing debt may not grow');
});

/* ──────────────────────── false positives it must not have ──────────────── */

test('an inline style that CANNOT be a class is exempt with a stated reason', (t) => {
  // Width comes from data — no CSS class can own it. Every other guard in the
  // repo has this escape (i18n-ignore, ddl-guard, design-token-exempt); the
  // first cut of 2l had none, and told the author to do the impossible.
  const bar = '  <i style={{ width: pct(r), background: r.color }}/> // inline-style-exempt: ширина и цвет приходят из данных\n';
  const body = `export const C = ({ rows }) => <>\n${bar.repeat(3)}</>;\n`;
  const f = fixture(t, { base: {}, head: { 'src/Chart.jsx': body } });
  const r = run(f);
  assert.equal(r.code, 0, r.out);
});

test('style={{…}} inside a comment is prose, not code', (t) => {
  const head = {
    'src/A.jsx': `// legacy: style={{ marginTop: 4 }}
/* old: style={{ marginTop: 4 }} */
// and once more: style={{ marginTop: 4 }}
export const C = () => <b/>;\n`,
  };
  const f = fixture(t, { base: {}, head });
  const r = run(f);
  assert.equal(r.code, 0, r.out);
});

test('a URL inside a string is not the start of a comment', (t) => {
  // Both spellings: `https://` (guarded by the preceding `:`) and the
  // protocol-relative `//cdn…`, which has no colon in front of it and used to
  // blank out the rest of the line — hiding the style that followed.
  for (const src of [
    `const u = 'https://triplanio.com';\nexport const C = () => <a href={u} style={{ color: 'red' }}/>;\n`,
    `export const C = () => <img src="//cdn.example/x.png" style={{ margin: 4 }}/>;\n`,
  ]) {
    const f = fixture(t, { base: {}, head: { 'src/A.jsx': src } });
    const r = run(f);
    assert.equal(r.code, 1, `a URL must not swallow the style after it:\n${src}`);
    assert.match(r.out, /1 inline/);
  }
});

test('a renamed file is judged against its OLD path, not against zero', (t) => {
  // Guards the `{ path: new, base: old }` branch: without it a rename would
  // reset the ratchet to 0 and let the file grow freely on the way through.
  const f = fixture(t, {
    base: { 'src/Old.jsx': unique(2) },
    renames: [['src/Old.jsx', 'src/New.jsx']],
    head: { 'src/New.jsx': unique(5) },
  });
  assert.equal(run(f).code, 1, 'renaming must not reset the ceiling');
});

test('git mv with no content change → pass', (t) => {
  const f = fixture(t, {
    base: { 'src/Old.jsx': repeated(4) },
    renames: [['src/Old.jsx', 'src/sub/New.jsx']],
  });
  const r = run(f);
  assert.equal(r.code, 0, 'renaming a file must not read as "a new file full of inline styles"');
});

test('an untouched file is not re-judged', (t) => {
  // Legacy debt sits in files this PR never opened; the guard must be scoped to
  // the diff, or every PR would be red forever.
  const f = fixture(t, {
    base: { 'src/Legacy.jsx': repeated(9), 'src/A.jsx': unique(1) },
    head: { 'src/A.jsx': unique(1) + '// touched\n' },
  });
  assert.equal(run(f).code, 0);
});

/* ────────────────────────────── plumbing ────────────────────────────────── */

test('unresolvable BASE_REF is skipped, not guessed', (t) => {
  const f = fixture(t, { base: {}, head: { 'src/New.jsx': unique(40) } });
  const r = run(f, { ref: 'refs/heads/no-such-branch' });
  assert.equal(r.code, 0, 'a shallow clone or fresh fork must not fail the build');
  assert.match(r.out, /skip/i);
});

test('run from a subdirectory still judges the whole diff', (t) => {
  // `src/` and the file reads resolve from cwd, so a run from anywhere but the
  // repo root used to report "0 changed file(s) — OK" on any amount of dirt.
  // "Nothing to check" and "checked, clean" must never print the same verdict.
  const f = fixture(t, { base: {}, head: { 'src/New.jsx': unique(4) } });
  assert.equal(run(f, { cwd: 'src' }).code, 1, 'a subdirectory run must not go green');
});

test('non-src files are out of scope', (t) => {
  const f = fixture(t, { base: {}, head: { 'scripts/x.jsx': unique(9) } });
  assert.equal(run(f).code, 0);
});

test('.js and .tsx count too, not only .jsx', (t) => {
  for (const name of ['src/A.js', 'src/A.tsx']) {
    const f = fixture(t, { base: {}, head: { [name]: unique(2) } });
    assert.equal(run(f).code, 1, `${name} must be scanned`);
  }
});
