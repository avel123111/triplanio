#!/usr/bin/env node
/**
 * Tests for CI guard 3c (scripts/ci/check-one-helper.mjs) — один общий хелпер.
 *
 * «Гард — это код, у него есть тест» (TRIP-282). Каждый тест раскладывает мини-
 * корпус `resources/*.ts` (+ опц. сосед-канон `mutateRules.ts`) во временную папку,
 * запускает гард ПОДПРОЦЕССОМ с `RESOURCES_DIR` на неё и проверяет код выхода.
 *
 * Зелёный тест ничего не значит, пока не увиден красным: дубль тела (в т.ч.
 * ПЕРЕИМЕНОВАННАЯ копия и копия канона) → красный; данные (объекты/спеки) и
 * различие лишь в строковом литерале → зелёный; ноль хелперов → код 2.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const GUARD = fileURLToPath(new URL('./check-one-helper.mjs', import.meta.url));

/**
 * Раскладывает `files` (путь→тело) во временном корне и гоняет гард с
 * RESOURCES_DIR=<root>/resources. Пути вида `mutateRules.ts` кладутся рядом с
 * папкой (канон-сосед), `resources/x.ts` — внутрь неё.
 */
function run(t, files) {
  const root = mkdtempSync(join(tmpdir(), 'guard3c-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  mkdirSync(join(root, 'resources'), { recursive: true });
  for (const [p, body] of Object.entries(files)) {
    const full = join(root, p);
    mkdirSync(dirname(full), { recursive: true });
    writeFileSync(full, body);
  }
  const r = spawnSync(process.execPath, [GUARD], {
    encoding: 'utf8',
    env: { ...process.env, RESOURCES_DIR: join(root, 'resources') },
  });
  return { code: r.status, out: `${r.stdout}${r.stderr}` };
}

const arrow = (name, msg) =>
  `const ${name} = (m: string): Refusal => ({ status: 400, code: 'INVALID_INPUT', message: '${msg}' });\n`;

/* ─────────────────────────── зелёный базовый ─────────────────────────────── */

test('синглтоны с разными телами → OK', (t) => {
  const r = run(t, {
    'resources/a.ts': `const httpUrl = (v: unknown): Refusal | null => v ? null : bad('x');\n`,
    'resources/b.ts': `const coord = (): FieldSpec => ({ type: 'number', nullable: true });\n`,
  });
  assert.equal(r.code, 0, r.out);
});

/* ───────────────────────── дубль тела → красный ──────────────────────────── */

test('одно тело стрелки в ДВУХ ресурсах → красный', (t) => {
  const r = run(t, {
    'resources/a.ts': arrow('invalid', 'x'),
    'resources/b.ts': arrow('invalid', 'x'),
  });
  assert.equal(r.code, 1, r.out);
  assert.match(r.out, /2 местах/);
});

test('ПЕРЕИМЕНОВАННАЯ копия (invalid) == канон (bad) → красный (rename не прячет дубль)', (t) => {
  const r = run(t, {
    'mutateRules.ts': arrow('bad', 'x'),
    'resources/a.ts': arrow('invalid', 'x'),
  });
  assert.equal(r.code, 1, r.out);
  assert.match(r.out, /invalid/);
  assert.match(r.out, /bad/);
});

test('дубль ОБЪЯВЛЕНИЯ функции (validateDocuments) → красный', (t) => {
  const body = (name) =>
    `function ${name}(value: unknown): Refusal | null {\n` +
    `  if (!Array.isArray(value)) return bad('list');\n  return null;\n}\n`;
  const r = run(t, { 'resources/a.ts': body('validateDocuments'), 'resources/b.ts': body('validateDocuments') });
  assert.equal(r.code, 1, r.out);
});

test('дубль регэксп-литерала (HTTP_URL) → красный', (t) => {
  const r = run(t, {
    'resources/a.ts': `const HTTP_URL = /^https?:\\/\\//i;\n`,
    'resources/b.ts': `const HTTP_URL = /^https?:\\/\\//i;\n`,
  });
  assert.equal(r.code, 1, r.out);
});

/* ─────────────────────── предикат: что НЕ дубль ──────────────────────────── */

test('различие ЛИШЬ в строковом литерале → OK (ключ по оригиналу, не по маске)', (t) => {
  // Если бы ключ считался по погашенному тексту, оба тела схлопнулись бы в дубль.
  const r = run(t, { 'resources/a.ts': arrow('a', 'first'), 'resources/b.ts': arrow('b', 'second') });
  assert.equal(r.code, 0, r.out);
});

test('идентичные ДАННЫЕ (Record/объект/спека) НЕ считаются дублем-хелпером', (t) => {
  const frag = `const MONEY_FIELDS: Record<string, FieldSpec> = {\n  price: { type: 'number', min: 0 },\n};\n`;
  const spec = `export const R: ResourceSpec = { name: 'r', scope: {}, actions: {} };\n`;
  // Плюс по РАЗНОМУ хелперу в каждый файл — корпус непуст (датчик слепоты), а
  // идентичные данные при этом дублем не считаются.
  const r = run(t, {
    'resources/a.ts': frag + spec + `const ha = (): FieldSpec => ({ type: 'number', min: 0 });\n`,
    'resources/b.ts': frag + spec + `const hb = (): FieldSpec => ({ type: 'string', max: 8 });\n`,
  });
  assert.equal(r.code, 0, r.out);
});

test('скобка внутри строкового литерала не рвёт разбор тела → OK', (t) => {
  const r = run(t, {
    'resources/a.ts': `const f = (v: unknown): Refusal | null => v ? null : bad('a) { needs ] care');\n`,
    'resources/b.ts': `const g = (): FieldSpec => ({ type: 'number', nullable: true });\n`,
  });
  assert.equal(r.code, 0, r.out);
});

/* ─────────────────────────── датчик слепоты ──────────────────────────────── */

test('ноль хелперов в корпусе (только данные) → код 2', (t) => {
  const r = run(t, {
    'resources/a.ts': `export const R: ResourceSpec = { name: 'r' };\n`,
  });
  assert.equal(r.code, 2, r.out);
});

test('нет папки ресурсов → код 2', (t) => {
  const r = spawnSync(process.execPath, [GUARD], {
    encoding: 'utf8',
    env: { ...process.env, RESOURCES_DIR: join(tmpdir(), 'guard3c-nope-does-not-exist') },
  });
  assert.equal(r.status, 2, `${r.stdout}${r.stderr}`);
});
