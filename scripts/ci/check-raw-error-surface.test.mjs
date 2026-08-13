#!/usr/bin/env node
/**
 * Tests for CI guard 3b (scripts/ci/check-raw-error-surface.mjs) — TRIP-408 PR#2.
 *
 * Как 2w/2l: каждый тест строит одноразовый git-репо (base → head), гоняет гард
 * подпроцессом с BASE_REF на base-коммит и проверяет код выхода. Зелёный тест
 * ничего не значит, пока не увиден красным — каждый кейс это мутация, которую
 * гард обязан ловить.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const GUARD = fileURLToPath(new URL('./check-raw-error-surface.mjs', import.meta.url));

const git = (cwd, args) =>
  execFileSync('git', args, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });

function put(dir, path, body) {
  const full = join(dir, path);
  mkdirSync(dirname(full), { recursive: true });
  writeFileSync(full, body);
}

function fixture(t, { base = {}, head = {} }) {
  const dir = mkdtempSync(join(tmpdir(), 'guard3b-'));
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

/* ─────────────────────────────── the ratchet ────────────────────────────── */

test('новый файл с setError(error.message) → fail (база 0)', (t) => {
  const f = fixture(t, { base: {}, head: { 'src/A.jsx': 'const f = (error) => setError(error.message);\n' } });
  const r = run(f);
  assert.equal(r.code, 1, r.out);
  assert.match(r.out, /A\.jsx/);
});

test('рост в тронутом файле (1 → 2) → fail', (t) => {
  const f = fixture(t, {
    base: { 'src/A.jsx': 'const a = (e) => setErr(e.message);\n' },
    head: { 'src/A.jsx': 'const a = (e) => setErr(e.message);\nconst b = (x) => setErr(x.message);\n' },
  });
  const r = run(f);
  assert.equal(r.code, 1, r.out);
});

test('без роста (2 → 2) → ok', (t) => {
  const body = 'const a = (e) => setErr(e.message);\nconst b = (x) => setErr(x.message);\n';
  const f = fixture(t, { base: { 'src/A.jsx': body }, head: { 'src/A.jsx': body + 'const c = 1;\n' } });
  const r = run(f);
  assert.equal(r.code, 0, r.out);
});

test('снижение (2 → 1) → ok', (t) => {
  const f = fixture(t, {
    base: { 'src/A.jsx': 'const a = (e) => setErr(e.message);\nconst b = (x) => setErr(x.message);\n' },
    head: { 'src/A.jsx': 'const a = (e) => setErr(e.message);\n' },
  });
  const r = run(f);
  assert.equal(r.code, 0, r.out);
});

test('форма { message: x.message } считается', (t) => {
  const f = fixture(t, { base: {}, head: { 'src/A.jsx': "const f = (error) => t('k', { message: error.message });\n" } });
  const r = run(f);
  assert.equal(r.code, 1, r.out);
});

test('форма description: err.message считается', (t) => {
  const f = fixture(t, { base: {}, head: { 'src/A.jsx': 'const f = (err) => toast({ description: err?.message });\n' } });
  const r = run(f);
  assert.equal(r.code, 1, r.out);
});

test('дедуп по строке: setErrorMsg(t(k,{message: e.message})) = ОДИН показ, не два', (t) => {
  // Строка совпадает и по PATTERNS[0] ({message:…}) и по PATTERNS[1] (setErr…()).
  // Если бы считалось два, база=2 и head (та же строка) не краснела бы на рост —
  // а тут добавляем ВТОРУЮ такую строку и ждём рост 1→2 (значит первая = 1).
  const one = "const a = (e) => setErrorMsg(t('k', { message: e.message }));\n";
  const f = fixture(t, { base: { 'src/A.jsx': one }, head: { 'src/A.jsx': one + one.replace('const a', 'const b') } });
  const r = run(f);
  assert.equal(r.code, 1, r.out); // 1 → 2, а не 2 → 4
});

test('мутация: показ В КОММЕНТАРИИ не считается (гашение)', (t) => {
  const f = fixture(t, {
    base: {},
    head: { 'src/A.jsx': '// setError(error.message)\n/* description: err.message */\nexport const y = 2;\n' },
  });
  const r = run(f);
  assert.equal(r.code, 0, `комментарий посчитан показом:\n${r.out}`);
});

test('escape raw-error-exempt на строке освобождает показ', (t) => {
  const f = fixture(t, {
    base: {},
    head: { 'src/A.jsx': 'const f = (error) => setError(error.message); // raw-error-exempt: диагностика\n' },
  });
  const r = run(f);
  assert.equal(r.code, 0, `exempt не сработал:\n${r.out}`);
});

test('бар `.message` вне слота показа не считается (const m = err.message)', (t) => {
  const f = fixture(t, { base: {}, head: { 'src/A.jsx': 'const g = (err) => { const m = err.message; return log(m); };\n' } });
  const r = run(f);
  assert.equal(r.code, 0, `бар .message посчитан показом:\n${r.out}`);
});

test('неразрешимый BASE_REF → skip (exit 0), не догадка', (t) => {
  const f = fixture(t, { base: {}, head: { 'src/A.jsx': 'const f = (e) => setErr(e.message);\n' } });
  const r = run(f, { ref: 'origin/does-not-exist' });
  assert.equal(r.code, 0, r.out);
  assert.match(r.out, /skipped/);
});

test('печатает whole-tree итог для видимости', (t) => {
  const f = fixture(t, { base: { 'src/A.jsx': 'const a = (e) => setErr(e.message);\n' }, head: {} });
  const r = run(f);
  assert.match(r.out, /сырых показов в src\/: \d+/, r.out);
});
