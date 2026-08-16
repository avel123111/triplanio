#!/usr/bin/env node
/**
 * CI guard 2v (TRIP-394, эпик TRIP-374) — реестр кодов ошибок edge-контракта.
 *
 * Коды ошибок = API. Edge печатает `jsonError(…, 'PRO_REQUIRED')`, клиент (и
 * будущий Flutter, который в сторе обновляется НЕ мгновенно) ветвится
 * `code === 'PRO_REQUIRED'`. Сегодня договорённость держится только тем, что
 * обе стороны НАБРАЛИ ОДНУ СТРОКУ РУКАМИ — опечатка на любой стороне тиха.
 * Реестр `_shared/errorCodes.ts` делает набор кодов явным словарём, а этот гард
 * держит две машинные гарантии:
 *
 *   (a) ЧЛЕНСТВО: любой код-строка, который edge ЭМИТИТ, обязан присутствовать
 *       в реестре. Самодельный код мимо словаря → красный. (Клиентскую сторону
 *       v1 НЕ форсит — импорт символа во всех старых местах едет доменным
 *       свипом; здесь только словарь на стороне-производителе контракта.)
 *   (b) APPEND-ONLY: код, присутствовавший в реестре на BASE_REF, нельзя
 *       удалить/переименовать на HEAD (машинная обратная совместимость: код в
 *       сторе живёт дольше нашего релиза).
 *
 * ── ПРЕДИКАТ РАНЬШЕ ЧИСЛА ───────────────────────────────────────────────────
 * В edge ДВЕ конвенции кодов. Канон — `UPPER_SNAKE` (шов `mutate`, бюджет,
 * весь seed-список TRIP-374). Легаси-семья в НИЖНЕМ регистре (`rate_limited`,
 * `email_exists`, `account_not_found`, `reset_sent`, `retry_soon` …) плюс
 * НЕ-ошибочные каталожные план-коды в УСПЕШНЫХ ответах (`account_pro_monthly`,
 * `trip_pro_lifetime`) и `ok`/численный `57014`. Бланкетный предикат «любой
 * `code:`-литерал» затащил бы в словарь продуктовые и success-маркеры (неверно)
 * и был бы красным на вводе. Поэтому scope v1 = **только `UPPER_SNAKE`-эмиссии**:
 * это ровно канон-контракт, ровно seed-список и ровно коды нового домена.
 *
 * ★ГРАНИЦА, НАЗВАННАЯ ВСЛУХ (не молча): легаси-нижний-регистр — отдельная
 * конвенция, её гармонизация вне «маленького словарного PR». Отсюда дыра
 * формы-записи: новый код, написанный СТРОЧНЫМИ, гард не потребует в реестре.
 * Она названа здесь, а не спрятана; закрытие — когда легаси-семья сведётся к
 * канону отдельным заходом.
 *
 * ── ЕДИНИЦА ЭМИССИИ ─────────────────────────────────────────────────────────
 * Код считается ЭМИТИРУЕМЫМ, если UPPER_SNAKE-литерал стоит в позиции контракта
 * (в ОБЕИХ формах кавычек — `deno fmt` предпочитает двойные, и предикат по одной
 * форме = дыра «новый код в двойных кавычках мимо гейта», ревью Codex):
 *   • `new HttpError(status, msg, 'CODE')`     — 3-й аргумент
 *   • `jsonError(status, msg, 'CODE', headers)`— 3-й аргумент
 *   • `forbid(status, 'CODE', msg)`            — 2-й аргумент (arg1, правила mutate)
 *   • `code: 'CODE'`                           — свойство тела Response.json / правил
 * Edge-ТЕСТЫ (`_test.ts` по Deno-конвенции, и `.test.ts`) исключены из скана —
 * иначе тест-код считается прод-эмиссией и требует свои коды в реестре.
 * Разбор — comment-blanking + сопоставление скобок (как 2r): `grep` построчный,
 * а тело ошибки многострочно; и запятая/скобка ВНУТРИ текста сообщения не
 * структурная (`'нет доступа (403)'`). Свой парсер CSS/JS был бы третьим в репо
 * — берём готовые хелперы разбора, как это делает 2r.
 *
 * ── ДАТЧИК СЛЕПОТЫ ──────────────────────────────────────────────────────────
 * Пустой реестр ИЛИ ноль найденных эмиссий = «не смог измерить» → код 2, а не
 * зелёный над пустой комнатой (сверка двух пустых зелена по построению).
 *
 * Стандартная библиотека + git (джоба `guards` намеренно без `npm ci`).
 * Env: BASE_REF (по умолчанию origin/dev).
 */
import { execFileSync } from 'node:child_process';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import path from 'node:path';

const BASE_REF = process.env.BASE_REF || 'origin/dev';
const REGISTRY = 'supabase/functions/_shared/errorCodes.ts';
const EDGE_DIR = 'supabase/functions';
const CODE_SHAPE = /^[A-Z][A-Z0-9_]{2,}$/;

// ── разбор (портировано из check-data-door.mjs, тот же инструмент на оба гарда) ──

/** Гасит комментарии ПРОБЕЛАМИ ТОЙ ЖЕ ДЛИНЫ (строки/колонки на месте). */
function blankComments(src) {
  const out = src.split('');
  const blank = (from, to) => {
    for (let i = from; i < to && i < out.length; i++) if (out[i] !== '\n') out[i] = ' ';
  };
  let i = 0;
  let prevSignificant = '';
  while (i < src.length) {
    const c = src[i];
    const n = src[i + 1];
    if (c === '/' && n === '/') {
      let j = i;
      while (j < src.length && src[j] !== '\n') j++;
      blank(i, j);
      i = j;
      continue;
    }
    if (c === '/' && n === '*') {
      const end = src.indexOf('*/', i + 2);
      const j = end === -1 ? src.length : end + 2;
      blank(i, j);
      i = j;
      continue;
    }
    if (c === "'" || c === '"' || c === '`') {
      let j = i + 1;
      while (j < src.length) {
        if (src[j] === '\\') { j += 2; continue; }
        if (src[j] === c) break;
        j++;
      }
      i = j + 1;
      prevSignificant = c;
      continue;
    }
    if (c === '/' && (prevSignificant === '' || '(,=:[!&|?{};+-*%~^<>'.includes(prevSignificant))) {
      let j = i + 1;
      let inClass = false;
      while (j < src.length && src[j] !== '\n') {
        if (src[j] === '\\') { j += 2; continue; }
        if (src[j] === '[') inClass = true;
        else if (src[j] === ']') inClass = false;
        else if (src[j] === '/' && !inClass) break;
        j++;
      }
      if (j < src.length && src[j] === '/') { i = j + 1; prevSignificant = '/'; continue; }
    }
    if (!/\s/.test(c)) prevSignificant = c;
    i++;
  }
  return out.join('');
}

function skipString(src, i) {
  const q = src[i];
  if (q !== "'" && q !== '"' && q !== '`') return i;
  for (let j = i + 1; j < src.length; j++) {
    if (src[j] === '\\') { j++; continue; }
    if (src[j] === q) return j;
  }
  return src.length - 1;
}

function matchParen(src, open) {
  let depth = 0;
  for (let i = open; i < src.length; i++) {
    const end = skipString(src, i);
    if (end !== i) { i = end; continue; }
    if (src[i] === '(') depth++;
    else if (src[i] === ')') {
      depth--;
      if (depth === 0) return i;
    }
  }
  return -1;
}

function splitArgs(src, open, close) {
  const args = [];
  let depth = 0;
  let start = open + 1;
  for (let i = open + 1; i < close; i++) {
    const end = skipString(src, i);
    if (end !== i) { i = end; continue; }
    const c = src[i];
    if ('([{'.includes(c)) depth++;
    else if (')]}'.includes(c)) depth--;
    else if (c === ',' && depth === 0) {
      args.push(src.slice(start, i));
      start = i + 1;
    }
  }
  args.push(src.slice(start, close));
  return args.map((a) => a.trim()).filter((a) => a.length);
}

/**
 * Если текст аргумента — одиночный UPPER_SNAKE-литерал в кавычках, вернуть его.
 * Обе формы кавычек: `deno fmt` предпочитает двойные, и `code: "NEW"` — валидный
 * синтаксис; предикат по одной форме = дыра «код в двойных кавычках мимо гейта».
 */
function litCode(argText) {
  const m = argText.match(/^(['"])([A-Za-z0-9_]+)\1$/);
  return m && CODE_SHAPE.test(m[2]) ? m[2] : null;
}

/** Позиционный аргумент вызова `name(` начиная с индекса открытия имени. */
function argAt(src, callOpenParen, idx) {
  const close = matchParen(src, callOpenParen);
  if (close === -1) return null;
  const args = splitArgs(src, callOpenParen, close);
  return args[idx] ?? null;
}

/** Найти '(' сразу после спички регулярки на имя вызова. */
function parenAfter(src, matchIndex, matchLength) {
  let i = matchIndex + matchLength;
  while (i < src.length && /\s/.test(src[i])) i++;
  return src[i] === '(' ? i : -1;
}

/** Для каждого совпадения regex: найти '(' вызова, взять argIndex-й аргумент, добавить код. */
function collectCallArgCodes(src, regex, argIndex, codes) {
  for (const m of src.matchAll(regex)) {
    const open = parenAfter(src, m.index, m[0].length);
    if (open === -1) continue;
    const c = litCode((argAt(src, open, argIndex) || '').trim());
    if (c) codes.add(c);
  }
}

/** Множество UPPER_SNAKE-кодов, эмитируемых исходником (после гашения комментариев). */
function emittedCodes(rawSrc) {
  const src = blankComments(rawSrc);
  const codes = new Set();
  // code: 'CODE' / code: "CODE"  (свойство тела; обе формы кавычек)
  for (const m of src.matchAll(/\bcode:\s*(['"])([A-Za-z0-9_]+)\1/g)) {
    if (CODE_SHAPE.test(m[2])) codes.add(m[2]);
  }
  collectCallArgCodes(src, /\bnew\s+HttpError\b/g, 2, codes); // new HttpError( … , 'CODE')
  collectCallArgCodes(src, /\bjsonError\b/g, 2, codes);       // jsonError( … , 'CODE', headers)
  collectCallArgCodes(src, /\bforbid\b/g, 1, codes);          // forbid(status, 'CODE', msg) — код в arg1 (TRIP-419)
  return codes;
}

/** UPPER_SNAKE-строки-литералы, объявленные в тексте реестра. */
function registryCodes(registrySrc) {
  const src = blankComments(registrySrc);
  const codes = new Set();
  for (const m of src.matchAll(/(['"])([A-Za-z0-9_]+)\1/g)) {
    if (CODE_SHAPE.test(m[2])) codes.add(m[2]);
  }
  return codes;
}

// ── обход дерева edge ────────────────────────────────────────────────────────

const isTestFile = (name) => name.endsWith('_test.ts') || name.endsWith('.test.ts');

function walk(dir, out = []) {
  let entries;
  try { entries = readdirSync(dir); } catch { return out; }
  for (const name of entries) {
    const full = path.join(dir, name);
    let st;
    try { st = statSync(full); } catch { continue; }
    if (st.isDirectory()) walk(full, out);
    // edge-тесты в Deno называются `_test.ts` (mutateRules_test.ts,
    // redeemRole_test.ts); `.test.ts` тоже исключаем на всякий. Иначе тест-код
    // считается прод-эмиссией и требует свои коды в реестре.
    else if (name.endsWith('.ts') && !isTestFile(name) && full !== REGISTRY) out.push(full);
  }
  return out;
}

function emittedFromTree(root) {
  const byCode = new Map(); // code -> [file …]
  for (const file of walk(root)) {
    const codes = emittedCodes(readFileSync(file, 'utf8'));
    for (const c of codes) {
      if (!byCode.has(c)) byCode.set(c, []);
      byCode.get(c).push(path.relative('.', file));
    }
  }
  return byCode;
}

// ── git ──────────────────────────────────────────────────────────────────────

const die = (msg) => { console.error(`check-error-codes (2v): ${msg}`); process.exit(2); };

const git = (args) =>
  execFileSync('git', args, { encoding: 'utf8', maxBuffer: 32 * 1024 * 1024, stdio: ['ignore', 'pipe', 'pipe'] });

function registryAtBase() {
  try {
    git(['rev-parse', '--verify', `${BASE_REF}^{commit}`]);
  } catch {
    return null; // BASE_REF недоступен — append-only не проверяем (первый прогон / нет remote)
  }
  try {
    return git(['show', `${BASE_REF}:${REGISTRY}`]);
  } catch {
    return ''; // реестра на базе не было (вводящий PR) — вычитать нечего
  }
}

// ── main ─────────────────────────────────────────────────────────────────────

const argv = process.argv.slice(2).filter((a) => a !== '--');

if (argv.includes('--list-emitted')) {
  const byCode = emittedFromTree(EDGE_DIR);
  for (const c of [...byCode.keys()].sort()) console.log(c);
  process.exit(0);
}

let registrySrc;
try {
  registrySrc = readFileSync(REGISTRY, 'utf8');
} catch {
  die(`реестр ${REGISTRY} не читается — словаря нет, мерить нечем.`);
}

const registry = registryCodes(registrySrc);
const emitted = emittedFromTree(EDGE_DIR);

// датчик слепоты
if (registry.size === 0) die(`реестр пуст — разбор сломан или файл не тот (0 кодов).`);
if (emitted.size === 0) die(`в ${EDGE_DIR}/** не найдено ни одной эмиссии — разбор сломан.`);

const problems = [];

// (a) членство: эмитируемое ⊆ реестр
const missing = [...emitted.keys()].filter((c) => !registry.has(c)).sort();
for (const c of missing) {
  problems.push(`  [a] код '${c}' эмитится edge (${emitted.get(c).join(', ')}), но его НЕТ в реестре ${REGISTRY}`);
}

// (b) append-only vs BASE_REF
const baseSrc = registryAtBase();
if (baseSrc) {
  const base = registryCodes(baseSrc);
  const removed = [...base].filter((c) => !registry.has(c)).sort();
  for (const c of removed) {
    problems.push(`  [b] код '${c}' был в реестре на ${BASE_REF}, а на HEAD его нет (удаление/переименование запрещено — код живёт в сторе дольше релиза)`);
  }
}

console.log(`check-error-codes (2v): реестр ${registry.size} кодов, эмиссий ${emitted.size} (UPPER_SNAKE, HEAD vs ${BASE_REF})`);
if (problems.length) {
  console.error('НАРУШЕНИЯ:');
  for (const p of problems) console.error(p);
  console.error('\nПравило (a): новый edge-код обяжи объявить в реестре. Правило (b): коды append-only.');
  process.exit(1);
}
console.log('OK — все эмитируемые коды в реестре, ни один не удалён.');
process.exit(0);
