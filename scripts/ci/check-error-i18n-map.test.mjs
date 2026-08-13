#!/usr/bin/env node
/**
 * Тест гарда 3a (`check-error-i18n-map.mjs`) — карта код→i18n живёт в ОДНОМ доме.
 *
 * Гард — самосогласованность по дереву (не дифф), поэтому фикстура = временный
 * каталог с `src/`, а гард запускается подпроцессом с `cwd` на него (реестр
 * `ERROR_CODES` он тянет от СВОЕГО расположения, т.е. настоящий). Ассертим код
 * выхода — как `check-inline-styles.test.mjs`.
 *
 * Зелёный тест ничего не значит, пока не увиден красным: каждый кейс — это
 * мутация гарда, которую он ОБЯЗАН ловить (снять фильтр реестра → «непонятный
 * ключ», снять гашение комментариев → «в комментарии», пустить дом в скан → …).
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const GUARD = fileURLToPath(new URL('./check-error-i18n-map.mjs', import.meta.url));

function put(dir, path, body) {
  const full = join(dir, path);
  mkdirSync(dirname(full), { recursive: true });
  writeFileSync(full, body);
}

/** Дерево с домом `src/lib/errorText.js` (если не отключён) + переданные файлы. */
function fixture(t, files, { withHome = true } = {}) {
  const dir = mkdtempSync(join(tmpdir(), 'guard3a-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  if (withHome) put(dir, 'src/lib/errorText.js', 'export function classifyError() {}\n');
  for (const [p, body] of Object.entries(files)) put(dir, p, body);
  return dir;
}

function run(dir) {
  const r = spawnSync(process.execPath, [GUARD], { cwd: dir, encoding: 'utf8' });
  return { code: r.status, out: `${r.stdout}${r.stderr}` };
}

test('чистое дерево (только дом) — exit 0', (t) => {
  const r = run(fixture(t, { 'src/app.js': 'export const x = 1;\n' }));
  assert.equal(r.code, 0, r.out);
});

test('литерал CODE (из реестра) → i18n-ключ вне дома — exit 1', (t) => {
  const r = run(fixture(t, { 'src/pages/Chat.jsx': "const M = { PRO_REQUIRED: 'chat.ai_err_pro' };\n" }));
  assert.equal(r.code, 1, r.out);
  assert.match(r.out, /PRO_REQUIRED/);
  assert.match(r.out, /Chat\.jsx/);
});

test('двойные кавычки тоже ловятся', (t) => {
  const r = run(fixture(t, { 'src/a.js': 'const M = { FORBIDDEN: "settings.err_forbidden" };\n' }));
  assert.equal(r.code, 1, r.out);
});

test('та же карта ВНУТРИ дома errorText.js — exit 0 (разрешено)', (t) => {
  const r = run(fixture(t, {
    'src/lib/errorText.js': "export const M = { PRO_REQUIRED: 'err.pro' };\n",
  }));
  assert.equal(r.code, 0, `дом карты не должен краснеть:\n${r.out}`);
});

test('мутация: паттерн В КОММЕНТАРИИ не считается (гашение комментариев)', (t) => {
  const r = run(fixture(t, {
    'src/a.js': "// был код PRO_REQUIRED: 'chat.ai_err_pro'\n/* NOT_FOUND: 'settings.err_trip_gone' */\nexport const y = 2;\n",
  }));
  assert.equal(r.code, 0, `комментарий посчитан картой:\n${r.out}`);
});

test('мутация: ключ НЕ из реестра не краснит (фильтр ERROR_CODES)', (t) => {
  const r = run(fixture(t, { 'src/a.js': "const M = { WHATEVER_KEY: 'some.namespaced.thing' };\n" }));
  assert.equal(r.code, 0, `непонятный UPPER-ключ посчитан кодом ошибки:\n${r.out}`);
});

test('значение без точки (не i18n-ключ) не краснит', (t) => {
  const r = run(fixture(t, { 'src/a.js': "const M = { FORBIDDEN: 'plainword' };\n" }));
  assert.equal(r.code, 0, r.out);
});

test('строчный ключ (не код) не краснит', (t) => {
  const r = run(fixture(t, { 'src/a.js': "const M = { forbidden: 'settings.err_forbidden' };\n" }));
  assert.equal(r.code, 0, r.out);
});

test('пропавший дом errorText.js = exit 2 (не зелёный над пустой комнатой)', (t) => {
  const r = run(fixture(t, { 'src/a.js': 'export const z = 3;\n' }, { withHome: false }));
  assert.equal(r.code, 2, r.out);
});

test('.test.js-файл исключён из скана', (t) => {
  const r = run(fixture(t, { 'src/a.test.js': "const M = { PRO_REQUIRED: 'chat.ai_err_pro' };\n" }));
  assert.equal(r.code, 0, `тест-файл посчитан прод-картой:\n${r.out}`);
});
