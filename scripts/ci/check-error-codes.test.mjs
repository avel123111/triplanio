#!/usr/bin/env node
/**
 * Tests for CI guard 2v (scripts/ci/check-error-codes.mjs) — реестр кодов ошибок.
 *
 * «Гард — это код, у него есть тест» (TRIP-282). Каждый тест строит одноразовый
 * git-репо с мини-деревом edge (`supabase/functions/**`) + реестром
 * `_shared/errorCodes.ts`, запускает гард ПОДПРОЦЕССОМ с BASE_REF на базовый
 * коммит и проверяет код выхода — как в CI.
 *
 * Зелёный тест ничего не значит, пока не увиден красным: два правила гарда
 * закреплены мутациями-фикстурами (самодельный код мимо реестра → (a) красный;
 * удаление/переименование кода → (b) красный), предикат — фикстурами
 * «что считается эмиссией», датчик слепоты — фикстурами «нечем мерить».
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const GUARD = fileURLToPath(new URL('./check-error-codes.mjs', import.meta.url));
const git = (cwd, args) =>
  execFileSync('git', args, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });

function put(dir, path, body) {
  const full = join(dir, path);
  mkdirSync(dirname(full), { recursive: true });
  writeFileSync(full, body);
}

const REGISTRY = 'supabase/functions/_shared/errorCodes.ts';

/** Текст реестра с данными кодами. */
const registry = (codes) =>
  `export const ERROR_CODES = [\n${codes.map((c) => `  '${c}',`).join('\n')}\n] as const;\n`;

/**
 * Двухкоммитный репо. `base`/`head` — карты путь→тело. По умолчанию оба коммита
 * несут реестр (иначе append-only нечего вычитать).
 */
function fixture(t, { base, head }) {
  const dir = mkdtempSync(join(tmpdir(), 'guard2v-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  git(dir, ['init', '-q', '-b', 'main']);
  git(dir, ['config', 'user.email', 'guard@test']);
  git(dir, ['config', 'user.name', 'guard']);
  git(dir, ['config', 'commit.gpgsign', 'false']);
  git(dir, ['config', 'core.hooksPath', '/dev/null']);

  for (const [p, body] of Object.entries(base)) put(dir, p, body);
  git(dir, ['add', '-A']);
  git(dir, ['commit', '-qm', 'base']);
  const baseRef = git(dir, ['rev-parse', 'HEAD']).trim();

  // HEAD полностью переписывает дерево из base (кроме того, что задано head).
  execFileSync('rm', ['-rf', join(dir, 'supabase')], { stdio: 'ignore' });
  for (const [p, body] of Object.entries(head)) put(dir, p, body);
  git(dir, ['add', '-A']);
  git(dir, ['commit', '-qm', 'head', '--allow-empty']);
  return { dir, baseRef };
}

function run({ dir, baseRef }, { args = [], ref } = {}) {
  const r = spawnSync(process.execPath, [GUARD, ...args], {
    cwd: dir,
    encoding: 'utf8',
    env: { ...process.env, BASE_REF: ref ?? baseRef },
  });
  return { code: r.status, out: `${r.stdout}${r.stderr}` };
}

/* ─────────────────────────── зелёный базовый ─────────────────────────────── */

test('эмитируемый код в реестре + ничего не удалено → OK', (t) => {
  const files = {
    [REGISTRY]: registry(['FORBIDDEN', 'NOT_FOUND']),
    'supabase/functions/fn/index.ts': `return jsonError(404, 'Not found', 'NOT_FOUND', h);\n`,
  };
  const r = run(fixture(t, { base: files, head: files }));
  assert.equal(r.code, 0, r.out);
});

/* ───────────────── (a) членство: самодельный код мимо реестра ─────────────── */

test('(a) edge эмитит код, которого НЕТ в реестре → красный', (t) => {
  const base = {
    [REGISTRY]: registry(['FORBIDDEN']),
    'supabase/functions/fn/index.ts': `return jsonError(403, 'no', 'FORBIDDEN', h);\n`,
  };
  const head = {
    [REGISTRY]: registry(['FORBIDDEN']),
    // самодельный код, в реестр не добавлен
    'supabase/functions/fn/index.ts':
      `throw new HttpError(400, 'bad', 'HOMEMADE_CODE');\n`,
  };
  const r = run(fixture(t, { base, head }));
  assert.equal(r.code, 1, r.out);
  assert.match(r.out, /HOMEMADE_CODE/);
  assert.match(r.out, /\[a\]/);
});

/* ──────────────── (b) append-only: удаление/переименование кода ────────────── */

test('(b) код был в реестре на BASE, на HEAD исчез → красный', (t) => {
  const base = {
    [REGISTRY]: registry(['FORBIDDEN', 'LEGACY_CODE']),
    'supabase/functions/fn/index.ts': `return jsonError(403, 'no', 'FORBIDDEN', h);\n`,
  };
  const head = {
    [REGISTRY]: registry(['FORBIDDEN']), // LEGACY_CODE удалён
    'supabase/functions/fn/index.ts': `return jsonError(403, 'no', 'FORBIDDEN', h);\n`,
  };
  const r = run(fixture(t, { base, head }));
  assert.equal(r.code, 1, r.out);
  assert.match(r.out, /LEGACY_CODE/);
  assert.match(r.out, /\[b\]/);
});

test('(b) переименование кода (drop+add) → красный по исчезнувшему', (t) => {
  const base = {
    [REGISTRY]: registry(['OLD_NAME']),
    'supabase/functions/fn/index.ts': `throw new HttpError(400, 'x', 'OLD_NAME');\n`,
  };
  const head = {
    [REGISTRY]: registry(['NEW_NAME']),
    'supabase/functions/fn/index.ts': `throw new HttpError(400, 'x', 'NEW_NAME');\n`,
  };
  const r = run(fixture(t, { base, head }));
  assert.equal(r.code, 1, r.out);
  assert.match(r.out, /OLD_NAME/);
});

/* ─────────────────────────── предикат эмиссии ────────────────────────────── */

test('все четыре формы эмиссии ловятся; многострочность и запятая в тексте не рвут', (t) => {
  const files = {
    [REGISTRY]: registry([
      'A_HTTPERROR', 'B_JSONERROR', 'C_FORBID', 'D_CODEPROP',
    ]),
    'supabase/functions/fn/index.ts': `
      throw new HttpError(
        404,
        'Not found, really (see the docs)',
        'A_HTTPERROR',
      );
      return jsonError(403, 'nope, sorry', 'B_JSONERROR', headers);
      guardRow: (row) => row.ok ? null : forbid(
        'C_FORBID',
        'message, with comma',
      );
      return Response.json({ error: 'x', code: 'D_CODEPROP' }, { status: 400 });
    `,
  };
  const r = run(fixture(t, { base: files, head: files }));
  assert.equal(r.code, 0, r.out);
});

test('каждая форма эмиссии, код ВНЕ реестра → красный (иначе дыра формы)', (t) => {
  // Дублирует предыдущий тест «с другой стороны»: тот ловит ложные срабатывания
  // (форма в реестре → OK), этот — ПРОПУСК формы (уронишь любой из четырёх
  // захватов — соответствующий код перестанет называться, и тест покраснеет).
  const files = {
    [REGISTRY]: registry(['FORBIDDEN']),
    'supabase/functions/fn/index.ts': `
      throw new HttpError(400, 'a', 'MISS_HTTPERROR');
      return jsonError(403, 'b', 'MISS_JSONERROR', h);
      forbid('MISS_FORBID', 'c');
      return Response.json({ code: 'MISS_CODEPROP' });
    `,
  };
  const r = run(fixture(t, { base: files, head: files }));
  assert.equal(r.code, 1, r.out);
  for (const c of ['MISS_HTTPERROR', 'MISS_JSONERROR', 'MISS_FORBID', 'MISS_CODEPROP']) {
    assert.match(r.out, new RegExp(c), `форма не поймана: ${c}`);
  }
});

test('легаси-нижний-регистр, продуктовые план-коды и PGRST-СРАВНЕНИЯ НЕ считаются эмиссией', (t) => {
  // Ни один из них не в реестре — и гард всё равно зелёный (они вне scope v1).
  const files = {
    [REGISTRY]: registry(['FORBIDDEN']),
    'supabase/functions/fn/index.ts': `
      return Response.json({ code: 'rate_limited' }, { status: 429 });
      return Response.json({ ok: true, code: 'account_pro_monthly' });
      if (error.code === 'PGRST116') return null;
      const x = { code: 'ok' };
      return jsonError(403, 'no', 'FORBIDDEN', h);
    `,
  };
  const r = run(fixture(t, { base: files, head: files }));
  assert.equal(r.code, 0, r.out);
});

test('код в КОММЕНТАРИИ не считается эмиссией (иначе ложное требование в реестр)', (t) => {
  const files = {
    [REGISTRY]: registry(['FORBIDDEN']),
    'supabase/functions/fn/index.ts': `
      // historical: jsonError(400, 'x', 'GHOST_CODE');
      /* also throw new HttpError(400, 'y', 'PHANTOM'); */
      return jsonError(403, 'no', 'FORBIDDEN', h);
    `,
  };
  const r = run(fixture(t, { base: files, head: files }));
  assert.equal(r.code, 0, r.out);
});

test('реестр и .test.ts НЕ сканируются как эмиттеры', (t) => {
  const files = {
    [REGISTRY]: registry(['FORBIDDEN']),
    // фикстура-тест цитирует несуществующий код — не должен требоваться в реестре
    'supabase/functions/fn/index.test.ts': `assert(jsonError(400,'x','TEST_ONLY_CODE'));\n`,
    'supabase/functions/fn/index.ts': `return jsonError(403, 'no', 'FORBIDDEN', h);\n`,
  };
  const r = run(fixture(t, { base: files, head: files }));
  assert.equal(r.code, 0, r.out);
});

/* ─────────────────────────── датчик слепоты ──────────────────────────────── */

test('пустой реестр → код 2 (не смог измерить, не зелёный)', (t) => {
  const files = {
    [REGISTRY]: `export const ERROR_CODES = [] as const;\n`,
    'supabase/functions/fn/index.ts': `return jsonError(403, 'no', 'FORBIDDEN', h);\n`,
  };
  const r = run(fixture(t, { base: files, head: files }));
  assert.equal(r.code, 2, r.out);
});

test('ноль эмиссий во всём дереве → код 2', (t) => {
  const files = {
    [REGISTRY]: registry(['FORBIDDEN']),
    'supabase/functions/fn/index.ts': `export const x = 1;\n`,
  };
  const r = run(fixture(t, { base: files, head: files }));
  assert.equal(r.code, 2, r.out);
});

test('нет файла реестра → код 2', (t) => {
  const files = { 'supabase/functions/fn/index.ts': `return jsonError(403,'n','FORBIDDEN',h);\n` };
  const r = run(fixture(t, { base: files, head: files }));
  assert.equal(r.code, 2, r.out);
});

/* ─────────────────────────── недостижимая база ───────────────────────────── */

test('BASE_REF не резолвится → append-only пропущен, членство ещё проверяется', (t) => {
  const files = {
    [REGISTRY]: registry(['FORBIDDEN']),
    'supabase/functions/fn/index.ts': `return jsonError(403, 'no', 'FORBIDDEN', h);\n`,
  };
  const r = run(fixture(t, { base: files, head: files }), { ref: 'refs/nope/missing' });
  assert.equal(r.code, 0, r.out);
});
