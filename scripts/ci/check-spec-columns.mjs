#!/usr/bin/env node
/**
 * CI guard 2y (TRIP-420, эпик TRIP-374) — spec-поля ресурса ⊆ колонки таблицы.
 *
 * РОДНЯ 2t (`check-db-types`), но с другой стороны шва. 2t держит, что
 * `database.types.ts` не отстаёт от миграций (типы == схема). ЭТОТ гард держит,
 * что БЕЛЫЙ СПИСОК КОЛОНОК КЛИЕНТА в спецификации ресурса (`_shared/resources/*.ts`,
 * поля `fields` + `forcedOnInsert` каждого table-DML-действия) — подмножество
 * колонок целевой таблицы из тех же типов. Вместе: клиент → spec → таблица
 * сходится по построению.
 *
 * ★ КЛАСС ДЕФЕКТА, КОТОРЫЙ ЭТО ЗАКРЫВАЕТ МАШИННО (живой прод-баг TRIP-420).
 * Действие `activity` спредило `COMMON_BOOKING_FIELDS` с `booking_reference`/
 * `booking_url`, а у таблицы `activities` этих колонок НЕТ. Клиент с этими полями
 * проходил whitelist шва → INSERT доносил их до Postgres → `42703 undefined_column`
 * → сырой 500 с текстом БД клиенту. `hotel`/`transfer` колонки имеют, `service`
 * COMMON не спредит — `activity` был единственным аутлаером, и увидеть это глазами
 * в диффе со спредами почти нельзя. Гард делает это невозможным пронести молча.
 *
 * ── ЧТО ПРОВЕРЯЕТСЯ ─────────────────────────────────────────────────────────
 * Только действия, которые ПИШУТ СТРОКУ ТАБЛИЦЫ напрямую: `op ∈ {upsert, insert,
 * delete}` с `table`. `op:'rpc'` пропускается НАМЕРЕННО: запись делает сам RPC,
 * а `fields` там маппятся в АРГУМЕНТЫ функции (`p_*`), не в колонки — их контракт
 * держит сигнатура RPC, не типы таблицы. `op:'none'` (resend) не пишет вовсе.
 * `delete` полей не несёт → проверка тривиальна, но действие включено, чтобы
 * будущий `forcedOnInsert` на нём (если появится) тоже попал под инвариант.
 *
 * ── КАК ЧИТАЮТСЯ СПЕЦИФИКАЦИИ ───────────────────────────────────────────────
 * Спеки — Deno-`.ts` с `.ts`-импортами; из node их не загрузить, а джоба `guards`
 * живёт на стандартной библиотеке без `npm ci` (как 2v/2w/3a/3b). Поэтому парсер
 * СТАТИЧЕСКИЙ: маскирует строки/комментарии/regex/шаблоны (чтобы `{`/`,` в них не
 * ломали баланс скобок), затем скобочно разбирает объекты. Спреды (`...MONEY_FIELDS`)
 * резолвятся рекурсивно по КАРТЕ ФРАГМЕНТОВ, собранной со всех файлов ресурсов
 * (в т.ч. алиасы вида `WAYPOINT_FIELDS = CITY_FIELDS`). Имя поля — это КЛЮЧ спеки;
 * `validate`-хуки/типы значений парсер не трогает.
 *
 * ★★ ДАТЧИК СЛЕПОТЫ (как у 2t). Пустой разбор (ноль таблиц ИЛИ ноль проверенных
 * действий) = код 2 «не смог измерить», а не 0: «нечего проверять» и «проверено,
 * чисто» не должны печатать один вердикт (TRIP-282). Неизвестная таблица действия
 * = тоже ошибка (опечатка/дрейф имени таблицы).
 *
 * ★★ МАРКЕРА-ОБХОДА НЕТ НАМЕРЕННО. Лишнее поле спеки — это либо колонка, которой
 * нет (баг), либо RPC-аргумент не в том действии (тоже баг); законного «поле не
 * колонка» у table-DML не существует. Данные, которым нельзя в свою колонку,
 * едут в `details` (jsonb), как booking-ссылка активности после фикса TRIP-420.
 *
 * ЗАПУСК: `node scripts/ci/check-spec-columns.mjs`. Только стандартная библиотека
 * (инвариант джобы «без npm ci» цел). Тест — `check-spec-columns.test.mjs`.
 * КОДЫ ВЫХОДА: 0 — сошлось · 1 — лишнее поле/неизвестная таблица · 2 — не смог измерить.
 */
import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { join } from 'node:path';

const TYPES = process.env.SPEC_COLUMNS_TYPES || 'supabase/functions/_shared/database.types.ts';
const RES_DIR = process.env.SPEC_COLUMNS_RESOURCES || 'supabase/functions/_shared/resources';

const unknown = process.argv.slice(2).filter((a) => a !== '--');
if (unknown.length) {
  console.error(`::error::check-spec-columns: unknown flag ${unknown.join(' ')}.`);
  process.exit(2);
}

function die(message, hint) {
  console.error(`::error::check-spec-columns: ${message}`);
  if (hint) console.error(hint);
  process.exit(2);
}

/**
 * Маскирует строки/шаблоны/regex/комментарии пробелами ТОЙ ЖЕ длины (переводы
 * строк сохранены, кавычки-делимитеры оставлены на месте). После этого баланс
 * `{}`/`()`/`[]` и детект ключей/спредов идут по коду, а не по содержимому
 * литералов. Идентификаторы (имена полей/фрагментов) в масках уцелевают —
 * значения-строки (`op:'upsert'`) читаются из ОРИГИНАЛА по смещению.
 */
function mask(src) {
  const out = src.split('');
  const n = src.length;
  let i = 0;
  let lastSig = '';
  const blank = (from, to) => {
    for (let k = from; k < to; k++) if (out[k] !== '\n') out[k] = ' ';
  };
  // `/` стартует regex-литерал, только если предыдущий значимый символ допускает
  // выражение (присваивание/открытая скобка/двоеточие/запятая…), иначе это деление.
  const regexStart = (prev) => prev === '' || '=(,:[!&|?{;}>'.includes(prev);
  while (i < n) {
    const c = src[i];
    const c2 = src[i + 1];
    if (c === '/' && c2 === '/') {
      let j = i + 2;
      while (j < n && src[j] !== '\n') j++;
      blank(i, j);
      i = j;
      continue;
    }
    if (c === '/' && c2 === '*') {
      let j = src.indexOf('*/', i + 2);
      j = j === -1 ? n : j + 2;
      blank(i, j);
      i = j;
      continue;
    }
    if (c === "'" || c === '"') {
      let j = i + 1;
      while (j < n && src[j] !== c) {
        if (src[j] === '\\') j++;
        j++;
      }
      blank(i + 1, j);
      i = j + 1;
      lastSig = c;
      continue;
    }
    if (c === '`') {
      let j = i + 1;
      while (j < n && src[j] !== '`') {
        if (src[j] === '\\') j++;
        j++;
      }
      blank(i + 1, j);
      i = j + 1;
      lastSig = '`';
      continue;
    }
    if (c === '/' && regexStart(lastSig)) {
      let j = i + 1;
      let inClass = false;
      while (j < n) {
        const d = src[j];
        if (d === '\n') break;
        if (d === '\\') {
          j += 2;
          continue;
        }
        if (d === '[') inClass = true;
        else if (d === ']') inClass = false;
        else if (d === '/' && !inClass) break;
        j++;
      }
      let k = j + 1;
      while (k < n && /[a-z]/i.test(src[k])) k++;
      blank(i, k);
      i = k;
      lastSig = '/';
      continue;
    }
    if (!/\s/.test(c)) lastSig = c;
    i++;
  }
  return out.join('');
}

/** Конец значения от позиции i: первая top-level `,` либо закрывающая скобка родителя. */
function skipValue(masked, i) {
  const n = masked.length;
  let depth = 0;
  while (i < n) {
    const c = masked[i];
    if (c === '{' || c === '(' || c === '[') depth++;
    else if (c === '}' || c === ')' || c === ']') {
      if (depth === 0) return i;
      depth--;
    } else if (c === ',' && depth === 0) return i;
    i++;
  }
  return i;
}

/**
 * Разбирает depth-1 записи объекта, чей `{` стоит на openIdx. Возвращает список
 * `{ key, vStart, vEnd, valIsObject }` для `key: value` и `{ spread }` для `...NAME`.
 * Ключи-строки (`'hotel/delete'`) читаются из оригинала (в маске содержимое пусто).
 */
function parseObjectEntries(masked, original, openIdx) {
  const entries = [];
  const n = masked.length;
  let i = openIdx + 1;
  while (i < n) {
    while (i < n && /[\s,]/.test(masked[i])) i++;
    if (i >= n || masked[i] === '}') break;
    if (masked.startsWith('...', i)) {
      i += 3;
      const m = /^[A-Za-z_]\w*/.exec(masked.slice(i));
      if (m) {
        entries.push({ spread: m[0] });
        i += m[0].length;
      }
      i = skipValue(masked, i);
      continue;
    }
    let key;
    if (masked[i] === "'" || masked[i] === '"') {
      const q = original[i];
      let j = i + 1;
      while (j < n && original[j] !== q) {
        if (original[j] === '\\') j++;
        j++;
      }
      key = original.slice(i + 1, j);
      i = j + 1;
    } else {
      const m = /^[A-Za-z_]\w*/.exec(masked.slice(i));
      if (!m) {
        i = skipValue(masked, i);
        continue;
      }
      key = m[0];
      i += m[0].length;
    }
    while (i < n && /\s/.test(masked[i])) i++;
    if (masked[i] !== ':') {
      i = skipValue(masked, i);
      continue;
    }
    i++;
    while (i < n && /\s/.test(masked[i])) i++;
    const vStart = i;
    const valIsObject = masked[i] === '{';
    const vEnd = skipValue(masked, vStart);
    entries.push({ key, vStart, vEnd, valIsObject });
    i = vEnd;
  }
  return entries;
}

/** Строковый литерал значения на позиции vStart (из оригинала), либо null. */
function readString(original, vStart) {
  const q = original[vStart];
  if (q !== "'" && q !== '"') return null;
  let j = vStart + 1;
  while (j < original.length && original[j] !== q) {
    if (original[j] === '\\') j++;
    j++;
  }
  return original.slice(vStart + 1, j);
}

// ── Разбор типов схемы → колонки по таблице ────────────────────────────────
function parseColumns(text) {
  const byTable = {};
  const lines = text.split('\n');
  let current = null;
  let inRow = false;
  for (const line of lines) {
    const name = /^ {6}([A-Za-z_][A-Za-z0-9_]*): \{$/.exec(line);
    if (name && !inRow) {
      current = name[1];
      continue;
    }
    if (current && /^ {8}Row: \{$/.test(line)) {
      inRow = true;
      byTable[current] = byTable[current] || new Set();
      continue;
    }
    if (inRow) {
      if (/^ {8}\}/.test(line)) {
        inRow = false;
        continue;
      }
      const col = /^ {10}([A-Za-z_][A-Za-z0-9_]*)\??:/.exec(line);
      if (col) byTable[current].add(col[1]);
    }
  }
  return byTable;
}

// ── Сбор фрагментов полей (все файлы ресурсов) ─────────────────────────────
if (!existsSync(TYPES)) die(`типы схемы не найдены: ${TYPES}`);
if (!existsSync(RES_DIR)) die(`каталог ресурсов не найден: ${RES_DIR}`);

const columns = parseColumns(readFileSync(TYPES, 'utf8'));
if (Object.keys(columns).length === 0) {
  die(
    `в ${TYPES} не найдено ни одной таблицы (Row-блока)`,
    '  → ДАТЧИК СЛЕПОТЫ: пустой разбор типов = «не смог измерить», не «чисто».',
  );
}

const files = readdirSync(RES_DIR)
  .filter((f) => f.endsWith('.ts') && !f.endsWith('.test.ts') && !f.endsWith('_test.ts'))
  .map((f) => join(RES_DIR, f));

/** name → { file, masked, original, openIdx } (объект) | { alias } */
const fragments = {};
const resources = []; // { file, masked, original, openIdx }

const CONST_RE = /\bconst\s+([A-Za-z_]\w*)\s*(?::[^=\n]*)?=\s*/g;
const RES_RE = /\bconst\s+([A-Za-z_]\w*)\s*:\s*ResourceSpec\s*=\s*\{/g;

for (const file of files) {
  const original = readFileSync(file, 'utf8');
  const masked = mask(original);

  // Верхнеуровневые (depth 0) const-фрагменты и алиасы.
  for (const m of masked.matchAll(CONST_RE)) {
    const before = masked.slice(0, m.index);
    const depth = (before.match(/\{/g) || []).length - (before.match(/\}/g) || []).length;
    if (depth !== 0) continue;
    let k = m.index + m[0].length;
    while (k < masked.length && /\s/.test(masked[k])) k++;
    if (masked[k] === '{') {
      fragments[m[1]] = { file, masked, original, openIdx: k };
    } else {
      const idm = /^[A-Za-z_]\w*/.exec(masked.slice(k));
      // Алиас только на идентификатор (не `(`=функция, не пусто=regex/literal).
      if (idm && masked[k] !== '(') fragments[m[1]] = { alias: idm[0] };
    }
  }

  // ResourceSpec-экспорты (для разбора действий).
  for (const m of masked.matchAll(RES_RE)) {
    const openIdx = m.index + m[0].length - 1; // на `{`
    resources.push({ file, masked, original, openIdx });
  }
}

const fieldSetCache = new Map();
/** Множество имён полей фрагмента (спреды/алиасы резолвятся рекурсивно). */
function resolveFragment(name, seen = new Set()) {
  if (fieldSetCache.has(name)) return fieldSetCache.get(name);
  const set = new Set();
  if (seen.has(name)) return set; // цикл — оборвать
  seen.add(name);
  const frag = fragments[name];
  if (!frag) return set; // неизвестный спред — пусто (лишних колонок не добавит)
  if (frag.alias) {
    for (const k of resolveFragment(frag.alias, seen)) set.add(k);
    fieldSetCache.set(name, set);
    return set;
  }
  for (const e of parseObjectEntries(frag.masked, frag.original, frag.openIdx)) {
    if (e.spread) for (const k of resolveFragment(e.spread, seen)) set.add(k);
    else set.add(e.key);
  }
  fieldSetCache.set(name, set);
  return set;
}

/** Имена полей из литерала объекта `fields`/`forcedOnInsert` действия. */
function objectFieldNames(res, openIdx) {
  const set = new Set();
  for (const e of parseObjectEntries(res.masked, res.original, openIdx)) {
    if (e.spread) for (const k of resolveFragment(e.spread)) set.add(k);
    else set.add(e.key);
  }
  return set;
}

// ── Проверка ────────────────────────────────────────────────────────────────
const DML = new Set(['upsert', 'insert', 'delete']);
const errors = [];
let checked = 0;

for (const res of resources) {
  const top = parseObjectEntries(res.masked, res.original, res.openIdx);
  const actionsEntry = top.find((e) => e.key === 'actions' && e.valIsObject);
  if (!actionsEntry) continue;
  const actions = parseObjectEntries(res.masked, res.original, actionsEntry.vStart);
  for (const act of actions) {
    if (act.spread || !act.valIsObject) continue;
    const body = parseObjectEntries(res.masked, res.original, act.vStart);
    const opEntry = body.find((e) => e.key === 'op');
    const tableEntry = body.find((e) => e.key === 'table');
    const op = opEntry ? readString(res.original, opEntry.vStart) : null;
    const table = tableEntry ? readString(res.original, tableEntry.vStart) : null;
    if (!op || !DML.has(op) || !table) continue;
    // Действие измерено, как только это table-DML: даже неизвестная таблица —
    // это ПРОВЕРЕННЫЙ случай (ошибка 1), а не «нечего мерить» (датчик слепоты 2).
    checked++;

    const cols = columns[table];
    if (!cols) {
      errors.push(`${act.key}: таблица "${table}" не найдена в типах схемы (опечатка / дрейф имени)`);
      continue;
    }
    const names = new Set();
    for (const key of ['fields', 'forcedOnInsert']) {
      const e = body.find((x) => x.key === key && x.valIsObject);
      if (e) for (const nm of objectFieldNames(res, e.vStart)) names.add(nm);
    }
    const extra = [...names].filter((nm) => !cols.has(nm));
    if (extra.length) {
      errors.push(
        `${act.key} (${table}): поля вне колонок таблицы: ${extra.join(', ')}` +
          '\n      → колонки нет в database.types.ts. Данным без своей колонки место в `details` (jsonb),' +
          '\n        как booking-ссылке активности (TRIP-420). Если колонка должна быть — заведи миграцию.',
      );
    }
  }
}

if (checked === 0) {
  die(
    'не проверено ни одного table-DML-действия',
    '  → ДАТЧИК СЛЕПОТЫ: разбор реестра дал ноль действий — «не смог измерить», не «чисто».',
  );
}

if (errors.length) {
  console.error('::error::check-spec-columns (2y): spec-поле вне колонок таблицы (класс дефекта TRIP-420)');
  for (const e of errors) console.error(`  ✗ ${e}`);
  process.exit(1);
}

console.log(`check-spec-columns (2y): ${checked} table-DML-действий, поля ⊆ колонок таблиц — OK`);
process.exit(0);
