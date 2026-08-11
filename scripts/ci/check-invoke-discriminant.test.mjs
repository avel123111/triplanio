#!/usr/bin/env node
/**
 * Tests for CI guard 2w (scripts/ci/check-invoke-discriminant.mjs).
 *
 * Как 2l: каждый тест строит одноразовый git-репо (base → head), гоняет гард
 * подпроцессом с BASE_REF на base-коммит и проверяет код выхода. Зелёный тест
 * ничего не значит, пока не увидел красным — здесь есть и то, и другое.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const GUARD = fileURLToPath(new URL('./check-invoke-discriminant.mjs', import.meta.url));

const git = (cwd, args) =>
  execFileSync('git', args, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });

function put(dir, path, body) {
  const full = join(dir, path);
  mkdirSync(dirname(full), { recursive: true });
  writeFileSync(full, body);
}

function fixture(t, { base = {}, head = {} }) {
  const dir = mkdtempSync(join(tmpdir(), 'guard2w-'));
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
  for (const [p, body] of Object.entries(head)) put(dir, p, body);
  git(dir, ['add', '-A']);
  git(dir, ['commit', '-qm', 'head', '--allow-empty']);
  return { dir, baseRef };
}

function run({ dir, baseRef }, { ref } = {}) {
  const r = spawnSync(process.execPath, [GUARD], {
    cwd: dir, encoding: 'utf8', env: { ...process.env, BASE_REF: ref ?? baseRef },
  });
  return { code: r.status, out: `${r.stdout}${r.stderr}` };
}

const use = (expr) => `export const C = async () => { const r = await invokeFn('x'); return ${expr}; };\n`;

/* ─────────────────────────────── the ratchet ────────────────────────────── */

test('новый файл читает .data.ok → fail (база 0)', (t) => {
  const f = fixture(t, { base: {}, head: { 'src/A.jsx': use('r.data.ok') } });
  const r = run(f);
  assert.equal(r.code, 1, r.out);
  assert.match(r.out, /src\/A\.jsx/);
});

test('.data?.code через optional chaining тоже ловится', (t) => {
  const f = fixture(t, { base: {}, head: { 'src/A.jsx': use('r.data?.code') } });
  assert.equal(run(f).code, 1);
});

test('рост в тронутом файле → fail', (t) => {
  const f = fixture(t, {
    base: { 'src/A.jsx': use('r.data.ok') },
    head: { 'src/A.jsx': use('r.data.ok || r.data.code') },
  });
  assert.equal(run(f).code, 1);
});

test('существующее вхождение грандфазерится (нет роста) → pass', (t) => {
  const f = fixture(t, {
    base: { 'src/A.jsx': use('r.data.ok') },
    head: { 'src/A.jsx': use('r.data.ok') + '// touched\n' },
  });
  assert.equal(run(f).code, 0, run(f).out);
});

test('сокращение → pass', (t) => {
  const f = fixture(t, {
    base: { 'src/A.jsx': use('r.data.ok || r.data.code') },
    head: { 'src/A.jsx': use('r.error') },
  });
  assert.equal(run(f).code, 0);
});

/* ──────────────────── чего гард НЕ должен ловить ─────────────────────────── */

test('голый data?.ok (легаси-контракт updateTripSettings) НЕ ловится', (t) => {
  const body = `export const C = async () => { const { data, code } = await invokeFn('x'); return data?.ok ? code : null; };\n`;
  const f = fixture(t, { base: {}, head: { 'src/A.jsx': body } });
  assert.equal(run(f).code, 0, run(f).out);
});

test('.data.code внутри комментария — проза, не эмиссия', (t) => {
  const body = `// пример: r.data.code читать нельзя\n/* r.data.ok тоже */\nexport const C = () => null;\n`;
  const f = fixture(t, { base: {}, head: { 'src/A.jsx': body } });
  assert.equal(run(f).code, 0, run(f).out);
});

test('escape-маркер освобождает легаси-поле (QR у шаринга)', (t) => {
  const body = `export const C = (last) => last?.data?.code; // invoke-discriminant-exempt: код шаринга, не дискриминант\n`;
  const f = fixture(t, { base: {}, head: { 'src/A.jsx': body } });
  assert.equal(run(f).code, 0, run(f).out);
});

test('нетронутый файл не пересуживается', (t) => {
  const f = fixture(t, {
    base: { 'src/Legacy.jsx': use('r.data.ok || r.data.code'), 'src/A.jsx': 'export const C = () => 1;\n' },
    head: { 'src/A.jsx': 'export const C = () => 2;\n' },
  });
  assert.equal(run(f).code, 0);
});

/* ──────────────────────────────── plumbing ──────────────────────────────── */

test('неразрешимый BASE_REF пропускается, а не угадывается', (t) => {
  const f = fixture(t, { base: {}, head: { 'src/A.jsx': use('r.data.ok') } });
  const r = run(f, { ref: 'refs/heads/no-such-branch' });
  assert.equal(r.code, 0, r.out);
  assert.match(r.out, /skip/i);
});

test('не-src файлы вне охвата', (t) => {
  const f = fixture(t, { base: {}, head: { 'scripts/x.jsx': use('r.data.ok') } });
  assert.equal(run(f).code, 0);
});
