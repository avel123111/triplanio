#!/usr/bin/env node
/**
 * CI guard 3a (TRIP-408 PR#2, контракт ошибок эпика TRIP-374).
 *
 * Карта «код ошибки → i18n-ключ» живёт в ОДНОМ месте — `src/lib/errorText.js`
 * (`classifyError`/`errorText`). До этого домена каждый экран держал свою
 * локальную карту: `AI_ERROR_KEY` (чат), `BUDGET_REFUSAL` (бюджет),
 * `REFUSAL_CLAUSE` (настройки). Три копии = три расхождения: один и тот же
 * `FORBIDDEN` показывался тремя разными строками, а новый код правился в одной
 * карте и молча оставался сырым в двух других. PR#2 их схлопнул; этот гард не
 * даёт им отрасти заново.
 *
 * ── ПРЕДИКАТ (форма записи, не семантика) ───────────────────────────────────
 * Нарушение = литерал объекта, где КЛЮЧ ∈ реестру `ERROR_CODES` (UPPER_SNAKE,
 * канон-контракт), а ЗНАЧЕНИЕ — строковый литерал вида i18n-ключа
 * (`namespace.key`). Ровно форма снесённых карт (`PRO_REQUIRED: 'chat.ai_err_pro'`).
 * Ключ обязан быть из реестра — это отсекает случайные UPPER-объекты, чьи
 * значения просто содержат точку. Разрешён единственный дом — `errorText.js`
 * (где карты нет: там `err.${code}` собирается шаблоном, а не литералами).
 *
 * ★ГРАНИЦА ВСЛУХ: гард ловит ФОРМУ (литерал `CODE: 'ns.key'`), а не намерение.
 * Динамическая карта (`{ [code]: key }`) или вынесенная в переменную-строку
 * пройдёт — как и у 2j, это «одна дверь по построению», а не полный запрет
 * ветвления. Достаточно: три снесённые карты были ровно этой литеральной формы,
 * и именно её всего проще написать заново по невнимательности.
 *
 * Самосогласованность по всему дереву (не дифф), близнец `check-analytics-seam`
 * (2j). Пустое дерево / пропавший дом = код 2 (не зелёный над пустой комнатой).
 * Тест — `check-error-i18n-map.test.mjs`.
 *
 * Стандартная библиотека + `src/lib/errorCodes.js` (0 импортов, джоба `guards`
 * без `npm ci`). Exit: 0 ok, 1 нарушение, 2 внутренняя ошибка / дом уехал.
 */
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { ERROR_CODE_SET } from '../../src/lib/errorCodes.js';

const ROOT = 'src';
const HOME = 'src/lib/errorText.js'; // единственный дом карты код→i18n
// `CODE: 'ns.key'` — ключ UPPER_SNAKE, значение похоже на i18n-адрес.
const ENTRY = /\b([A-Z][A-Z0-9_]{2,})\s*:\s*(['"])([a-z][a-zA-Z0-9_]*\.[a-zA-Z0-9_.]+)\2/g;

/** Гасит комментарии пробелами ТОЙ ЖЕ длины (номера строк/колонок на месте). */
function blankComments(src) {
  const out = src.split('');
  for (let i = 0; i < src.length; i++) {
    if (src[i] === '/' && src[i + 1] === '/' && ![':', '"', "'", '`'].includes(src[i - 1])) {
      while (i < src.length && src[i] !== '\n') out[i++] = ' ';
    } else if (src[i] === '/' && src[i + 1] === '*') {
      const end = src.indexOf('*/', i + 2);
      const stop = end === -1 ? src.length : end + 2;
      for (; i < stop; i++) if (src[i] !== '\n') out[i] = ' ';
    }
  }
  return out.join('');
}

const rel = (f) => f.split('\\').join('/');

function walk(dir, out = []) {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) walk(p, out);
    else if (/\.(jsx?|tsx?)$/.test(name) && !/\.test\.(jsx?|tsx?)$/.test(name)) out.push(p);
  }
  return out;
}

function lineOf(src, index) {
  let line = 1;
  for (let i = 0; i < index && i < src.length; i++) if (src[i] === '\n') line++;
  return line;
}

try {
  if (!existsSync(HOME)) {
    console.error(`::error::check-error-i18n-map: дом карты не найден (${HOME}). Гард смотрит в пустую комнату — запусти из корня; если файл переехал, обнови HOME в этом же коммите.`);
    process.exit(2);
  }
  if (!ERROR_CODE_SET || ERROR_CODE_SET.size === 0) {
    console.error('::error::check-error-i18n-map: реестр ERROR_CODES пуст — измерить нечем.');
    process.exit(2);
  }

  const homeAbs = rel(HOME);
  const offenders = [];
  for (const file of walk(ROOT)) {
    const r = rel(file);
    if (r === homeAbs) continue; // дом карты — единственное разрешённое место
    const src = blankComments(readFileSync(file, 'utf8'));
    for (const m of src.matchAll(ENTRY)) {
      if (ERROR_CODE_SET.has(m[1])) offenders.push({ file: r, line: lineOf(src, m.index), code: m[1], key: m[3] });
    }
  }

  if (offenders.length) {
    console.error('::error::3a карта код→i18n вне errorText.js — локальная карта отказа воскресла:');
    for (const o of offenders) console.error(`  ✗ ${o.file}:${o.line}  ${o.code}: '${o.key}'`);
    console.error('  Трактовку кода даёт `classifyError(t, code)` из @/lib/errorText: kind (upsell/');
    console.error('  refusal/error) + text через `errorText`. Локальную карту код→ключ не заводить.');
    process.exit(1);
  }

  console.log(`check-error-i18n-map (3a): карта код→i18n одна (${HOME}), локальных копий нет — OK`);
  process.exit(0);
} catch (e) {
  console.error(`::error::check-error-i18n-map internal error: ${e.message}`);
  process.exit(2);
}
