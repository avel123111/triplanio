#!/usr/bin/env node
/**
 * CI guard 3c (TRIP-421, эпик TRIP-374) — ОДИН ОБЩИЙ ХЕЛПЕР (анти-зоопарк шва).
 *
 * Шов записи держит доменную логику в ДАННЫХ ресурсов (`_shared/resources/*.ts`),
 * а ОБЩИЕ мелкие хелперы (конструктор отказа `bad`, `HTTP_URL`, `validateDocuments`,
 * `coord`) живут ОДНИМ домом в каноне (`_shared/mutateRules.ts` рядом с `forbid`/
 * валидаторами; `coord` — в `resources/cityFields.ts`) и ИМПОРТИРУЮТСЯ. До TRIP-421
 * эти же тела были расписаны копиями по 3-4 ресурсам (`invalid`×3, `HTTP_URL`×2,
 * `validateDocuments`×2, `coord`×2) — ровно тот зоопарк, из-за которого правка
 * поведения в одном месте молча расходилась с копиями. Дедуп их убил; этот гард
 * не даёт им НАРАСТИ СНОВА: новая локальная копия хелпера с телом, уже живущим в
 * другом ресурсе ИЛИ в каноне, краснит PR.
 *
 * ── ЕДИНИЦА СЧЁТА (тело хелпера, не имя) ────────────────────────────────────
 * Top-level (col-0) ОПРЕДЕЛЕНИЕ ХЕЛПЕРА-ФУНКЦИИ:
 *   • `const NAME = (params) => …;`   — стрелка (тело-выражение или блок)
 *   • `function NAME(params) { … }`   — объявление функции
 *   • `const NAME = /regex/flags;`    — литерал-регэксп (как `HTTP_URL`)
 * Ключ дубля = НОРМАЛИЗОВАННОЕ ТЕЛО (всё после `=` у const / после имени у
 * function; пробелы схлопнуты), БЕЗ имени — чтобы переименованная копия (`invalid`
 * vs канонный `bad`) всё равно совпала. Одно и то же тело в ДВУХ определениях
 * (в разных файлах или дважды в одном) → красный.
 *
 * ДАННЫЕ НЕ СЧИТАЮТСЯ. Объектные/`Record`-фрагменты (`const X = {…}`, `X: Record…`),
 * `ResourceSpec`-экспорты и алиасы (`WAYPOINT_FIELDS = CITY_FIELDS`) — это данные
 * ресурса (архитектура «анти-дубль на уровне ДАННЫХ» их и так сводит общими
 * фрагментами), не логика; их per-resource набор уникален и законен → мимо гарда.
 *
 * ── ГРЕПА-ПРОСТОЙ, НЕ 11-Й TS-ПАРСЕР ────────────────────────────────────────
 * Границы тела ищет счётчик глубины по `(){}[]` поверх исходника с ПОГАШЕННЫМИ
 * строками/комментариями (скобка внутри `'…'` не сдвигает глубину). Это не разбор
 * TS-типов — тел, а не AST; в семью ручных TS-парсеров (`ts-static`, долг) не идёт.
 * Ключ считается по ОРИГИНАЛУ (гашение сохраняет офсеты), поэтому две функции,
 * различающиеся лишь строковым литералом, НЕ схлопываются в один ключ.
 *
 * ★ГРАНИЦА ВСЛУХ: ловит побайтовую копию ТЕЛА (тот самый зоопарк), не «похожую»
 * логику и не дубль ДАННЫХ. Регэксп-const разбирается до `;` на своей строке
 * (многострочный regex-литерал — вне предиката; в шве таких нет). Названо здесь.
 *
 * Whole-corpus (фиксированный набор файлов) — не дифф: набор мал, скан дешёв,
 * инвариант «ни одного дубля тела» зелёный по построению после дедупа.
 *
 * Стандартная библиотека, без git и `npm ci` (джоба `guards`). Exit: 0 чисто /
 * 1 дубль / 2 не смог измерить (0 хелперов = предикат сломан).
 * Env: RESOURCES_DIR (default — реальный `_shared/resources`) для теста гарда.
 */
import { readFileSync, existsSync, readdirSync, statSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const unknown = process.argv.slice(2).filter((a) => a !== '--');
if (unknown.length) {
  console.error(`::error::check-one-helper: unknown flag ${unknown.join(' ')}.`);
  process.exit(2);
}

const HERE = dirname(fileURLToPath(import.meta.url));
const RESOURCES_DIR =
  process.env.RESOURCES_DIR ||
  join(HERE, '..', '..', 'supabase', 'functions', '_shared', 'resources');
// Канон общих хелперов — сосед папки ресурсов. Копия хелпера в ресурсе, чьё тело
// уже живёт здесь, обязана вместо этого импортировать канон → сверяем и его.
const CANON_FILE = join(RESOURCES_DIR, '..', 'mutateRules.ts');

/** Гасит комментарии И содержимое строк, сохраняя длину (офсеты валидны для ключа). */
function mask(src) {
  const out = src.split('');
  const n = src.length;
  let i = 0;
  while (i < n) {
    const c = src[i];
    const d = src[i + 1];
    if (c === '/' && d === '/') {
      while (i < n && src[i] !== '\n') out[i++] = ' ';
    } else if (c === '/' && d === '*') {
      out[i] = ' '; out[i + 1] = ' '; i += 2;
      while (i < n && !(src[i] === '*' && src[i + 1] === '/')) { if (src[i] !== '\n') out[i] = ' '; i++; }
      if (i < n) { out[i] = ' '; out[i + 1] = ' '; i += 2; }
    } else if (c === '"' || c === "'" || c === '`') {
      i++; // оставляем открывающую кавычку, гасим содержимое
      while (i < n && src[i] !== c) {
        if (src[i] === '\\') { out[i] = ' '; i++; if (i < n) out[i++] = ' '; continue; }
        if (src[i] !== '\n') out[i] = ' ';
        i++;
      }
      i++; // закрывающая кавычка (или конец файла)
    } else {
      i++;
    }
  }
  return out.join('');
}

const DEPTH = { '(': 1, '[': 1, '{': 1, ')': -1, ']': -1, '}': -1 };

/** Индекс depth-0 `;` начиная с `from` (по погашенному тексту). */
function endAtSemicolon(masked, from) {
  let depth = 0;
  for (let i = from; i < masked.length; i++) {
    const ch = masked[i];
    if (DEPTH[ch]) depth += DEPTH[ch];
    else if (ch === ';' && depth <= 0) return i;
  }
  return masked.length;
}

/** Индекс сразу ПОСЛЕ блока `{…}`: первый `{` с `from`, затем брейс-матч. */
function endAfterBlock(masked, from) {
  const open = masked.indexOf('{', from);
  if (open === -1) return masked.length;
  let depth = 0;
  for (let i = open; i < masked.length; i++) {
    if (masked[i] === '{') depth++;
    else if (masked[i] === '}' && --depth === 0) return i + 1;
  }
  return masked.length;
}

const normalize = (s) => s.replace(/\s+/g, ' ').trim();
const lineOf = (src, idx) => src.slice(0, idx).split('\n').length;

// Top-level `const NAME =` / `function NAME(` (только с начала строки).
const CONST_RE = /^(?:export\s+)?const\s+([A-Za-z0-9_$]+)\s*=\s*/gm;
const FUNC_RE = /^(?:export\s+)?function\s+([A-Za-z0-9_$]+)\s*\(/gm;

/** Хелперы-функции файла: [{ name, key, line }]. Данные (объекты/алиасы/спеки) — мимо. */
function extractHelpers(file, src) {
  const masked = mask(src);
  const found = [];

  for (const m of masked.matchAll(CONST_RE)) {
    const bodyStart = m.index + m[0].length;
    const first = masked[bodyStart];
    if (first === '(') {
      // Стрелка: тело до depth-0 `;`.
      const end = endAtSemicolon(masked, bodyStart);
      found.push({ name: m[1], key: normalize(src.slice(bodyStart, end)), line: lineOf(src, m.index) });
    } else if (first === '/') {
      // Регэксп-литерал: до `;` на этой же строке.
      const nl = masked.indexOf('\n', bodyStart);
      const lineEnd = nl === -1 ? masked.length : nl;
      const semi = masked.lastIndexOf(';', lineEnd);
      const end = semi > bodyStart ? semi : lineEnd;
      found.push({ name: m[1], key: normalize(src.slice(bodyStart, end)), line: lineOf(src, m.index) });
    }
    // `{`/идентификатор/`[` → данные, не хелпер-функция: пропускаем.
  }

  for (const m of masked.matchAll(FUNC_RE)) {
    const bodyStart = m.index + m[0].length - 1; // на `(` параметров
    const end = endAfterBlock(masked, bodyStart);
    found.push({ name: m[1], key: normalize(src.slice(bodyStart, end)), line: lineOf(src, m.index) });
  }

  return found.map((h) => ({ ...h, file }));
}

if (!existsSync(RESOURCES_DIR) || !statSync(RESOURCES_DIR).isDirectory()) {
  console.error(`::error::check-one-helper: нет папки ресурсов ${RESOURCES_DIR}.`);
  process.exit(2);
}

const files = readdirSync(RESOURCES_DIR)
  .filter((n) => n.endsWith('.ts') && !/_test\.ts$/.test(n))
  .map((n) => join(RESOURCES_DIR, n));
if (existsSync(CANON_FILE)) files.push(CANON_FILE);

const byKey = new Map();
let total = 0;
for (const f of files) {
  for (const h of extractHelpers(f, readFileSync(f, 'utf8'))) {
    total++;
    if (!byKey.has(h.key)) byKey.set(h.key, []);
    byKey.get(h.key).push(h);
  }
}

// Датчик слепоты: в ресурсах ЕСТЬ хелперы (coord/ts/httpUrl/…). Ноль = предикат сломан.
if (total === 0) {
  console.error('::error::check-one-helper (3c): 0 хелперов в корпусе — предикат сломан, мерить нечем.');
  process.exit(2);
}

const dups = [...byKey.values()].filter((locs) => locs.length > 1);
if (dups.length) {
  console.error(
    '::error::check-one-helper (3c): тело хелпера дублируется — сведи в канон и импортируй (TRIP-421)',
  );
  for (const locs of dups) {
    const where = locs.map((l) => `${l.file}:${l.line} (${l.name})`).join('  ↔  ');
    console.error(`  ✗ одно тело в ${locs.length} местах: ${where}`);
  }
  console.error(
    '    → общий дом хелперов — `_shared/mutateRules.ts` (рядом с `bad`/`forbid`/валидаторами) ' +
    'или `resources/cityFields.ts` (фрагменты города); экспортируй ОДИН и импортируй, копию удали.',
  );
  process.exit(1);
}

console.log(`check-one-helper (3c): ${total} хелперов в ${files.length} файлах — дублей тел нет · OK`);
process.exit(0);
