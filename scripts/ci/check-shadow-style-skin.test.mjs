#!/usr/bin/env node
/**
 * Tests for CI guard 2y (scripts/ci/check-shadow-style-skin.mjs).
 *
 * Пиннинг предиката «поверхность в теневом <style>»: гард HEAD-only (список файлов
 * из `git ls-files src`), поэтому каждый тест строит throwaway git-репо, коммитит
 * `src/*.jsx` и запускает гард подпроцессом из этого репо — как в CI. Зелёный
 * тест ничего не значит, пока не увидел КРАСНЫМ: первый же тест — поверхность,
 * которую гард ОБЯЗАН поймать (TRIP-343, «A CI guard is code»).
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const GUARD = fileURLToPath(new URL('./check-shadow-style-skin.mjs', import.meta.url));
const git = (cwd, args) =>
  execFileSync('git', args, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });

function fixture(t, files) {
  const dir = mkdtempSync(join(tmpdir(), 'guard2y-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  git(dir, ['init', '-q', '-b', 'main']);
  git(dir, ['config', 'user.email', 'guard@test']);
  git(dir, ['config', 'user.name', 'guard']);
  git(dir, ['config', 'commit.gpgsign', 'false']);
  git(dir, ['config', 'core.hooksPath', '/dev/null']);
  for (const [p, body] of Object.entries(files)) {
    const full = join(dir, p);
    mkdirSync(dirname(full), { recursive: true });
    writeFileSync(full, body);
  }
  writeFileSync(join(dir, '.keep'), '');
  git(dir, ['add', '-A']);
  git(dir, ['commit', '-qm', 'x']);
  return dir;
}

function run(dir) {
  const r = spawnSync(process.execPath, [GUARD], { cwd: dir, encoding: 'utf8', env: { ...process.env } });
  return { code: r.status, out: `${r.stdout}${r.stderr}` };
}

// `<style>` c реальным CSS-фрагментом (шаблонная строка), как в проде.
const styleJsx = (css) => `export const C = () => (<><style>{\`${css}\`}</style></>);\n`;

/* ── красное: поверхность в <style> ловится ─────────────────────────────────── */

test('поверхность (радиус+фон+рамка) в <style> → красный', (t) => {
  const dir = fixture(t, {
    'src/A.jsx': styleJsx('.card-x { background: var(--surface); border: 1px solid var(--line); border-radius: 16px; }'),
  });
  const r = run(dir);
  assert.equal(r.code, 1, r.out);
  assert.match(r.out, /\.card-x/);
});

test('поверхность через тень (радиус+фон+box-shadow, не квадрат) → красный', (t) => {
  const dir = fixture(t, {
    'src/A.jsx': styleJsx('.panel-y { background: var(--surface); border-radius: 20px; box-shadow: var(--sh-1); padding: 18px; }'),
  });
  assert.equal(run(dir).code, 1);
});

/* ── зелёное: раскладка / акцент / сепаратор / плитка не ловятся ─────────────── */

test('раскладка + акцент без фона/радиуса (мигрированный fork-manual) → зелёный', (t) => {
  const dir = fixture(t, {
    'src/A.jsx': styleJsx('.fork-manual { display: flex; gap: 12px; padding: 10px; border-color: var(--fk); box-shadow: 0 0 0 3px var(--fk-soft); }'),
  });
  assert.equal(run(dir).code, 0, run(dir).out);
});

test('сепаратор border-top без радиуса/фона (Stay22/Viator) → зелёный', (t) => {
  const dir = fixture(t, {
    'src/A.jsx': styleJsx('.s22-row + .s22-row { border-top: 1px solid var(--line); }'),
  });
  assert.equal(run(dir).code, 0);
});

test('плитка-иконка (квадрат + радиус + фон + тень + центр) — это пятно, не поверхность → зелёный', (t) => {
  const dir = fixture(t, {
    'src/A.jsx': styleJsx('.ic { width: 38px; height: 38px; border-radius: 8px; background: var(--fk); box-shadow: 0 5px 13px -6px var(--fk); display: grid; place-items: center; }'),
  });
  assert.equal(run(dir).code, 0, run(dir).out);
});

test('файл без <style> → зелёный', (t) => {
  const dir = fixture(t, { 'src/A.jsx': 'export const C = () => <div className="card"/>;\n' });
  assert.equal(run(dir).code, 0);
});
