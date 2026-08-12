#!/usr/bin/env node
/**
 * CI guard 2r (TRIP-376, Ф0.4 эпика TRIP-374) — табло «единой двери в данные».
 *
 * Печатает ВСЕ числа эпика разом и не пускает рост ни одного. Ратчет на всех
 * числах сразу И ЕСТЬ смысл гарда: прошлый заход по дизайн-системе снизил
 * классы, вырастил пространства имён на 8 и отчитался первым числом
 * (TRIP-321 → TRIP-337 §4). Однометричный храповик это пропускает.
 *
 * ── ПОЧЕМУ ПРЕДИКАТ НАПИСАН РАНЬШЕ ЧИСЛА ────────────────────────────────────
 * Три независимых прогона по «прямой записи из браузера» дали три разных набора
 * чисел, и ни один не содержал арифметической ошибки — просто каждый отвечал на
 * СВОЙ вопрос:
 *
 *     `.from(`                 86 / 89 / 44   все вхождения (в т.ч. 26 Array.from
 *                                             и 12 storage.from) vs .from('<таблица>')
 *     Response.json многостр.   4 / 21        открывает `{` в конце строки vs
 *                                             + двухаргументная форма
 *     `ok: false`              10 / 8         все вхождения в файле vs первым
 *                                             ключом тела Response.json({
 *
 * То же, что «сырой отступ» на соседнем эпике: 962 / 1011 / 1304 (TRIP-339 §10).
 * Поэтому КАЖДОЕ решение ниже закреплено СВОЕЙ фикстурой в
 * `check-data-door.test.mjs` — файлом, ответ на котором известен по построению.
 * Совпадение с чьим-либо ориентиром не доказывает ничего: на 2o правильная и
 * сломанная реализации печатали одно и то же число 163.
 *
 * ── ЧЕМ РАЗБИРАЕМ, И ПОЧЕМУ НЕ ПАРСЕРОМ ────────────────────────────────────
 * Ни `acorn` (не берёт TypeScript), ни новой зависимости (правило #6; третий
 * парсер в репо уже дважды бил по соседнему эпику). Вместо этого — ОДИН
 * инструмент на оба дерева: гашение комментариев с сохранением строк
 * (`blankComments`) + регулярка ПО ВСЕМУ ФАЙЛУ.
 *
 * Ключевое, что закрывает главную дыру: **grep построчный, а регулярка JS — нет.**
 * `\s*` в JS проходит через `\n`, поэтому многострочная цепочка
 * `supabase\n .from('x')\n .insert(` ловится тем же выражением, что и однострочная.
 * В живом репо 17 из 44 `.from()` написаны именно так, и однострочный предикат
 * не видит ни одной.
 *
 * Комментарии гасятся ПРОБЕЛАМИ ТОЙ ЖЕ ДЛИНЫ, а не удаляются: номера строк и
 * колонок обязаны остаться на месте, иначе построчный маркер-исключение
 * молча адресует не ту строку (грабля из TRIP-339).
 *
 * ── ЕДИНИЦА СЧЁТА: ВЫЗОВ, ПО ВСЕМУ РЕПО ────────────────────────────────────
 * Не по файлу. Перенос вызова из файла в файл — правильный ход эпика, и
 * пофайловый счётчик краснел бы на каждом таком (тот же класс ошибки, что
 * пофайловый счётчик отступов в TRIP-339).
 *
 * ── МЕТРИКИ ────────────────────────────────────────────────────────────────
 * РАТЧЕТ (не растут; цель — в колонке `target`):
 *   rpcMutating   мутирующие RPC с клиента            → 0
 *   rpcReading    читающие RPC с клиента              → 0
 *   rpcGazetteer  газеттир (публичный поиск)          → 3, остаётся клиентским
 *   writes        прямые записи, таблица литералом    → 0
 *   writesVar     прямые записи, таблица переменной   → 0
 *   reads         прямые чтения, таблица литералом    → 0
 *   readsVar      прямые чтения, таблица переменной   → 0
 *   rawErrors     ответы об ошибке не по канону       → 0
 *   doubleDoor    таблиц с двумя путями записи        → 0
 *
 * ПЕЧАТНЫЕ (не ратчетятся — обоснование у каждой):
 *   edgeFunctions / edgeCallSites   Ф1 и Ф2 обязаны заводить функции
 *                                   (`getHomeScreen`, `saveEvent`, `saveExpense`…);
 *                                   анти-ратчет здесь запретил бы то, ради чего
 *                                   эпик существует. Гранулярность endpoint'ов
 *                                   проектируется в TRIP-380 — ратчет на
 *                                   неопределённой цели это ратчет на догадке.
 *   mutateSeamLines                 по той же причине: Ф1 — это СОЗДАНИЕ шва,
 *                                   ратчет от 0 блокирует собственную фазу.
 *                                   ⚠ В ТЗ A2 объявлена анти-метрикой «не растёт»;
 *                                   это тот же дефект, что у A1, и он назван
 *                                   вслух здесь, а не молча обойдён.
 *   homeScreenCalls                 метрика ПОФАЙЛОВАЯ (`src/pages/Trips.jsx`),
 *                                   обходится выносом вызовов в хук без единого
 *                                   изменения архитектуры.
 *   storageCalls / whitelistedWrites  чтобы граница не была молчаливой.
 *
 * ── ДВА ВЫХОДА: РАТЧЕТ И ТАБЛО ─────────────────────────────────────────────
 * RATCHET — сверка с BASE_REF; на PR, который ничего не переносит, зелен по
 * построению (обе стороны идентичны). Это блокирующая половина.
 * TARGET — дистанция до целей §5 эпика; ПЕЧАТАЕТСЯ ВСЕГДА, но код возврата 1
 * даёт только под `--assert-target`.
 *
 * Почему не одной блокирующей проверкой «доехали до цели»: она была бы красной
 * все Ф1–Ф6, то есть недели, а постоянно красная джоба перестаёт нести
 * информацию и её выключают (TRIP-351: «гард, красный на каждом ПРАВИЛЬНОМ
 * ходе, будет выключен»). Требование ТЗ «увидеть гард красным» закрывается
 * мутациями в тесте, а не постоянной краснотой в CI.
 *
 * ── ИЗВЕСТНЫЕ ДЫРЫ ПРЕДИКАТА (названы, потому что молчащая дыра хуже) ──────
 * 1. СТРОКОВЫЙ ДИСПАТЧ. Таблица через переменную (`supabase.from(table)`,
 *    `ENTITY_TABLE_BY_KIND[kind]`) считается — но ОТДЕЛЬНЫМ числом
 *    (`writesVar`/`readsVar`), потому что привязать её к имени таблицы нечем.
 *    Следствие: `doubleDoor` этих вызовов НЕ ВИДИТ. Спец-разбор конкретной
 *    карты не делается намеренно — он развалится на следующей такой карте.
 *    Сегодня это 5 записей + 1 чтение на 4 таблицах (hotel_stays / transfers /
 *    activities / trip_services), то есть крупнейший блок §4.C эпика.
 * 2. ФОРМЫ ОТКАЗА — ПЕРЕЧИСЛЕНИЕ. `{error}`, `{ok:false}`, `{allow:false}` и
 *    статус ≥ 400. Четвёртая форма, если её изобретут, будет невидима. Держит
 *    это не гард, а TRIP-378: отказ обязан быть 4xx, а 4xx ловится статусом.
 * 3. JSX-ТЕКСТ. `//` внутри текста JSX гасится как комментарий. Вызов, стоящий
 *    на той же строке ПОСЛЕ такого текста, потеряется (недосчёт). В живом репо
 *    таких мест нет; строковые литералы (`'https://…'`) разобраны правильно и
 *    закреплены тестом.
 * 4. `.rpc()` ЧЕРЕЗ ПЕРЕМЕННУЮ сегодня не встречается; если появится, попадёт
 *    в `rpcVariable` и потребует классификации вручную.
 * 5. Гард НЕ ЗНАЕТ, что вызов реально исполняется: мёртвый код считается
 *    наравне с живым. Это осознанно — «мёртвость» тут решается вручную по
 *    шести источникам (см. memory/triplanio-graphify-code-graph.md).
 * 6. РЕГУЛЯРКА ПОСЛЕ КЛЮЧЕВОГО СЛОВА. Признак начала регулярного литерала —
 *    предыдущий значащий СИМВОЛ, поэтому `return /https:\/\//.test(u)` за
 *    регулярку не принимается, `//` внутри неё читается как комментарий и хвост
 *    строки гаснет — вызов ПОСЛЕ такой регулярки на той же строке пропадает
 *    (НЕДОСЧЁТ, ложный зелёный). Лечится списком слов (`return`, `typeof`,
 *    `case`, `yield`…), но это правка предиката, а предикат меняют вместе с
 *    числом и апрувом, а не походя. Сегодня в дереве ноль таких мест — все пять
 *    `return /…/` не содержат `//`; фикстура на границу стоит в тесте.
 *
 * ── РАСХОЖДЕНИЯ С ОРИЕНТИРАМИ ТЗ (§2 просил объяснить) ────────────────────
 * Ориентиры ТЗ получены грубым грепом и заведомо неточны. Ниже — что даёт этот
 * предикат на `origin/dev` @ f2a6266 и ПОЧЕМУ отличается. Числа печатает сам
 * прогон; здесь они как объяснение расхождения, а не как второй источник.
 *
 *   M1  8 = 8 ✓. Наивный `.rpc(` даёт 16: 2 вхождения — текст комментария
 *           (`loadStateClassify.js:13` и его тест), ещё 6 — газеттир и чтения.
 *   M2 ~30 → 22 литералом + 5 переменной = 27.
 *   M3  11 → 9 литералом + 1 переменной = 10. Одиннадцатый в списке §4.D —
 *           `get_user_travel_stats`: это RPC, а не PostgREST; он живёт в
 *           `rpcReading`, и здесь считался бы ДВАЖДЫ.
 *   M4 167 → 193. Разложение сходится точно:
 *              167  однострочный `{ error }`      ← ровно ориентир ТЗ
 *               11  многострочная / двухаргументная форма (`deleteTrip:76`,
 *                   `viatorActivities:100`, `stay22Accommodations:92` …)
 *                9  `ok: false` статусом 200 (`callTriplanioAi`, `telegramWebhook`,
 *                   `updateTripSettings`)
 *                1  `allow: false` (`aiGate:66`) — ТРЕТЬЯ форма отказа
 *                5  только статус ≥ 400, без ключа-отказа: `{ code: … }` в
 *                   `deleteMyAccount` — ЧЕТВЁРТАЯ форма
 *           Определение сменено на «ответ об ошибке НЕ ПО КАНОНУ»: при прежнем
 *           («тело начинается с `error`») починка TRIP-378 ПОВЫШАЛА бы M4, то
 *           есть метрика краснела бы на правильном ходе.
 *   M5   4 = 4 ✓, но считать надо через `fromCalls`: сырая регулярка даёт 6,
 *           потому что `Array.from({length})` в скелетоне карточки — не запрос.
 *   A1  44 = 44 ✓. Точек вызова 59 = 58 литералом + 1 переменной
 *           (`Login.jsx:503`); грубый греп даёт 56 — теряет вызовы, у которых
 *           литерал на следующей строке.
 *   A4 «0 всегда» → 3: city_visits · trip_documents · users. Это НЕ полуперенос
 *           (`copyTrip` обязан писать `city_visits` серверно), поэтому A4 —
 *           ратчет-метрика с целью 0, а не инвариант, и печатает СПИСОК: по
 *           числу не отличить «клиент ещё пишет» от «edge законно пишет».
 *           ⚠ `notifications` в это число НЕ входит — см. `declaredTwoDoor`.
 *
 * ── ESCAPE ────────────────────────────────────────────────────────────────
 *     // door-exempt: writes +1 — временный шим Ф2, апрув Pavel
 *
 * Читается из ДОБАВЛЕННЫХ строк диффа под pathspec `src/` + `supabase/functions/`
 * — то есть ровно над тем деревом, которое меряется. Pathspec несущий: 2o без
 * него падал с кодом 2 на PR, который его вводил, потому что строки-фикстуры
 * его собственного теста читались как настоящие исключения. Маркер, названный
 * с опечаткой, — ОШИБКА, а не «исключений не просили».
 *
 * Env: BASE_REF (по умолчанию origin/dev).
 * Выход: 0 ок · 1 нарушение · 2 не смог измерить.
 */
import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync, readdirSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, relative, sep } from 'node:path';

const BASE_REF = process.env.BASE_REF || 'origin/dev';
const EXEMPT = 'door-exempt';

/* ─────────────────────────────── манифесты ──────────────────────────────── */

/** Клиентские RPC. Имя, которого здесь нет, — НАРУШЕНИЕ, а не молчаливая
 *  корзина: новый RPC с клиента обязан быть классифицирован осознанно. */
const RPC = {
  rpcMutating: [
    'set_city_nights', 'set_trip_start_date', 'add_city', 'remove_city',
    'reorder_cities', 'add_layover_transfer', 'create_trip', 'send_chat_message',
  ],
  rpcReading: ['get_user_travel_stats'],
  // Публичный поиск: отказывать нечего, неоднозначности «пусто vs нельзя» не
  // существует, дёргается на каждое нажатие клавиши. Остаётся клиентским (§4.B).
  rpcGazetteer: ['search_gazetteer', 'search_gazetteer_batch', 'nearest_cities'],
};

/** Записи, чья ошибка НИКОГДА не показывается пользователю (критерий границы
 *  §4.C). Печатаются отдельной строкой, чтобы граница не была молчаливой. */
const WRITE_WHITELIST = new Set(['notifications', 'chat_reads', 'partner_clicks']);

/** Чат вне скоупа эпика: Realtime проверяет SELECT-политику подписчика, отзыв
 *  SELECT убил бы подписку (§4.D). */
const CHAT_TABLES = new Set(['chats', 'chat_messages', 'chat_reads']);

const WRITE_OPS = new Set(['insert', 'update', 'upsert', 'delete']);

/** Ратчет-метрики. Ключ — то, что называет маркер-исключение, поэтому он часть
 *  контракта и не переименовывается походя. `target` — цель из §5 эпика. */
const METRICS = [
  { key: 'rpcMutating', label: 'мутирующих RPC с клиента', target: 0 },
  { key: 'rpcReading', label: 'читающих RPC с клиента', target: 0 },
  { key: 'rpcGazetteer', label: 'RPC газеттира (остаются)', target: 3 },
  { key: 'writes', label: 'прямых записей (таблица литералом)', target: 0 },
  { key: 'writesVar', label: 'прямых записей через переменную', target: 0 },
  { key: 'reads', label: 'прямых чтений (таблица литералом)', target: 0 },
  { key: 'readsVar', label: 'прямых чтений через переменную', target: 0 },
  { key: 'rawErrors', label: 'сырых ответов об ошибке', target: 0 },
  { key: 'doubleDoor', label: 'таблиц с двумя дверями записи', target: 0 },
];

const die = (msg, extra = []) => {
  console.error(`::error::check-data-door: ${msg}`);
  extra.forEach((l) => console.error(`  ${l}`));
  process.exit(2);
};

/* ───────────────────────────── разбор исходника ─────────────────────────── */

/**
 * Гасит комментарии ПРОБЕЛАМИ ТОЙ ЖЕ ДЛИНЫ (переводы строк сохраняются), не
 * трогая содержимое строковых литералов — имена таблиц лежат именно там.
 *
 * Знает про регулярные литералы: без этого `/\/\//` съедало бы хвост строки и
 * вызов после него молча исчезал (ложный ЗЕЛЁНЫЙ). Признак начала регулярки —
 * предыдущий значащий символ из списка ниже либо начало файла; это стандартная
 * эвристика, и она НЕ полна: перед регуляркой может стоять ключевое СЛОВО
 * (`return /\/\//.test(u)`), а список знает только символы. Ошибка в эту сторону
 * НЕДОСЧЁТ, а не перебор, — см. дыру 6 в списке ниже; сегодня в дереве таких мест
 * нет (все пять `return /…/` без `//` внутри), но молчащей эту границу оставлять
 * нельзя.
 *
 * `split('')` (кодовые ЕДИНИЦЫ), а не `Array.from` (кодовые ТОЧКИ): индексы
 * гасилки обязаны совпадать с индексами `src[i]`, иначе на файле с суррогатной
 * парой (эмодзи — сегодня их три) вся разметка съезжает на число пар, первый
 * символ комментария выживает, а столько же символов СЛЕДУЮЩЕЙ строки гасится.
 * Тот же `split('')` у 2l и 2n.
 */
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
      // регулярный литерал — проскочить до непроэкранированного `/`
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

/** Номер строки (1-based) по индексу символа. */
const lineAt = (src, idx) => src.slice(0, idx).split('\n').length;

/**
 * Индекс закрывающей кавычки литерала, начинающегося на `src[i]`, либо сам `i`,
 * если там не кавычка.
 *
 * Скобка или запятая ВНУТРИ строки не структурная, и разбор без этого рвётся
 * ровно на текстах ошибок: `Response.json({ error: 'нет доступа (403)' })`
 * закрывается по скобке из сообщения, а тела ошибок только из таких и состоят.
 * Сегодня ни одно из 193 живых мест этим не задето — но «не задето сегодня» не
 * повод оставлять разбор, у которого недосчёт зависит от текста строки.
 */
function skipString(src, i) {
  const q = src[i];
  if (q !== "'" && q !== '"' && q !== '`') return i;
  for (let j = i + 1; j < src.length; j++) {
    if (src[j] === '\\') { j++; continue; }
    if (src[j] === q) return j;
  }
  return src.length - 1;
}

/** Индекс парной закрывающей скобки к `src[open]`. */
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

/** Аргументы вызова верхнего уровня (текстом), от `(` до парной `)`. */
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

/** Ключи ВЕРХНЕГО уровня объектного литерала: `{ a: 1, b: { c: 2 } }` → a, b. */
function topLevelKeys(objText) {
  const t = objText.trim();
  if (!t.startsWith('{')) return [];
  const inner = t.slice(1, t.lastIndexOf('}'));
  const keys = [];
  let depth = 0;
  let start = 0;
  const flush = (piece) => {
    const m = piece.trim().match(/^['"`]?([A-Za-z_$][\w$]*)['"`]?\s*:([\s\S]*)$/);
    if (m) keys.push([m[1], m[2].trim()]);
    else {
      const short = piece.trim().match(/^([A-Za-z_$][\w$]*)$/); // сокращённая запись
      if (short) keys.push([short[1], short[1]]);
    }
  };
  for (let i = 0; i < inner.length; i++) {
    const end = skipString(inner, i);
    if (end !== i) { i = end; continue; }
    const c = inner[i];
    if ('([{'.includes(c)) depth++;
    else if (')]}'.includes(c)) depth--;
    else if (c === ',' && depth === 0) {
      flush(inner.slice(start, i));
      start = i + 1;
    }
  }
  flush(inner.slice(start));
  return keys;
}

/** ★ ТОЛЬКО «КАТАЛОГА НЕТ» ПРОЩАЕТСЯ. Голый `catch` прощал и нечитаемое дерево:
 *  файлов 0 с обеих сторон, все дельты нули, табло печатает «ратчет держится» —
 *  то есть «не смог измерить» в одежде «измерил, чисто». Собственная шапка этого
 *  гарда запрещает ровно это. */
function walk(dir, exts, out = []) {
  let entries;
  try {
    entries = readdirSync(dir, { withFileTypes: true });
  } catch (e) {
    if (e.code === 'ENOENT') return out;
    die(`не могу прочитать ${dir}: ${e.message}`, ['Дерево, которое не читается, — это не «дерева нет».']);
  }
  for (const e of entries.sort((a, b) => a.name.localeCompare(b.name))) {
    if (e.name === 'node_modules' || e.name.startsWith('.')) continue;
    const p = join(dir, e.name);
    if (e.isDirectory()) walk(p, exts, out);
    else if (exts.some((x) => e.name.endsWith(x))) out.push(p);
  }
  return out;
}

/* ───────────────────────────── сами измерения ───────────────────────────── */

/**
 * Все `.from(<arg>)` в тексте с их операцией. Регулярка идёт ПО ВСЕМУ ФАЙЛУ,
 * поэтому многострочная цепочка ловится тем же кодом, что и однострочная.
 * Бакет Storage отличается от таблицы по префиксу `storage` — имя `trips` носят
 * и бакет, и таблица, и без этого `doubleDoor` получила бы фантом.
 */
function fromCalls(src) {
  const calls = [];
  const re = /\.from\s*\(/g;
  for (const m of src.matchAll(re)) {
    const open = m.index + m[0].length - 1;
    const close = matchParen(src, open);
    if (close === -1) continue;

    const before = src.slice(Math.max(0, m.index - 60), m.index).replace(/\s+$/, '');
    if (/(^|[.\s])storage$/.test(before)) { calls.push({ storage: true, line: lineAt(src, m.index) }); continue; }
    if (/(^|[^\w$.])Array$/.test(before)) continue; // Array.from(…) — не запрос

    const arg = src.slice(open + 1, close).trim();
    const lit = arg.match(/^['"`]([a-z_][a-z0-9_]*)['"`]$/i);

    // первая операция после закрывающей скобки: `.from('x')\n .insert(` тоже
    const tail = src.slice(close + 1, close + 200);
    const op = tail.match(/^\s*\.\s*([A-Za-z_$][\w$]*)/);
    calls.push({
      table: lit ? lit[1] : null,
      variable: !lit,
      op: op ? op[1] : null,
      line: lineAt(src, m.index),
      storage: false,
    });
  }
  return calls;
}

/** `Response.json(...)`, разобранный на «это отказ или успех». */
function responseJsonCalls(src) {
  const out = [];
  for (const m of src.matchAll(/Response\s*\.\s*json\s*\(/g)) {
    const open = m.index + m[0].length - 1;
    const close = matchParen(src, open);
    if (close === -1) continue;
    const args = splitArgs(src, open, close);
    const line = lineAt(src, m.index);

    // (1) явный статус ≥ 400 во втором аргументе
    const initText = args[1] ?? '';
    const st = initText.match(/status\s*:\s*(\d{3})/);
    if (st && Number(st[1]) >= 400) { out.push({ error: true, line, why: `status ${st[1]}` }); continue; }

    // (2) признак отказа ключом ВЕРХНЕГО уровня тела. Перечисление — известная
    //     дыра, названная в шапке; четвёртую форму держит TRIP-378 (отказ = 4xx).
    const keys = topLevelKeys(args[0] ?? '');
    const refusal = keys.find(([k, v]) =>
      k === 'error' || ((k === 'ok' || k === 'allow') && /^false\b/.test(v)));
    out.push(refusal ? { error: true, line, why: `{ ${refusal[0]} }` } : { error: false, line });
  }
  return out;
}

/** Полный замер текущего дерева относительно `cwd`. */
function measure(cwd) {
  const m = {
    rpcMutating: 0, rpcReading: 0, rpcGazetteer: 0, rpcVariable: 0,
    writes: 0, writesVar: 0, reads: 0, readsVar: 0,
    rawErrors: 0, doubleDoor: [],
    edgeFunctions: 0, edgeCallSites: 0, mutateSeamLines: 0,
    homeScreenCalls: 0, storageCalls: 0, whitelistedWrites: 0,
    unknownRpc: [], srcWriteTables: [], edgeWriteTables: [], declaredTwoDoor: [],
  };
  const RPC_OF = new Map();
  for (const [bucket, names] of Object.entries(RPC)) for (const n of names) RPC_OF.set(n, bucket);

  const srcWrite = new Set();
  const edgeWrite = new Set();
  /** Таблицы, чья прямая запись из браузера ОБЪЯВЛЕНА исключением — белый
   *  список §4.C И чат §4.D, обе причины ведут сюда. Держатся отдельно от
   *  `srcWrite` — см. `declaredTwoDoor`. */
  const declared = new Set();

  /* ── фронт ── */
  for (const file of walk(join(cwd, 'src'), ['.js', '.jsx'])) {
    const rel = relative(cwd, file).split(sep).join('/');
    const src = blankComments(readFileSync(file, 'utf8'));

    const calls = fromCalls(src);
    for (const c of calls) {
      if (c.storage) { m.storageCalls++; continue; }
      const isWrite = c.op && WRITE_OPS.has(c.op);
      const isRead = c.op === 'select';
      if (!isWrite && !isRead) continue;
      if (c.variable) { if (isWrite) m.writesVar++; else m.readsVar++; continue; }
      if (isWrite) {
        if (WRITE_WHITELIST.has(c.table) || CHAT_TABLES.has(c.table)) { m.whitelistedWrites++; declared.add(c.table); continue; }
        srcWrite.add(c.table);
        m.writes++;
      } else {
        if (CHAT_TABLES.has(c.table)) continue;
        m.reads++;
      }
    }

    for (const r of src.matchAll(/\.rpc\s*\(/g)) {
      const open = r.index + r[0].length - 1;
      const close = matchParen(src, open);
      if (close === -1) continue;
      const first = (splitArgs(src, open, close)[0] ?? '').trim();
      const lit = first.match(/^['"`]([a-z_][a-z0-9_]*)['"`]$/i);
      if (!lit) { m.rpcVariable++; continue; }
      const bucket = RPC_OF.get(lit[1]);
      if (!bucket) { m.unknownRpc.push(`${rel}:${lineAt(src, r.index)} ${lit[1]}`); continue; }
      m[bucket]++;
    }

    // Модуль, ОБЪЯВЛЯЮЩИЙ шов, не является его точкой вызова.
    const invokes = rel === 'src/lib/invokeFn.js' ? 0 : [...src.matchAll(/invokeFn\s*\(/g)].length;
    m.edgeCallSites += invokes;
    if (rel === 'src/pages/Trips.jsx') {
      // Через `fromCalls`, а не сырой регуляркой: иначе `Array.from({length})`
      // в скелетоне карточки считается запросом к данным (замерено: 6 вместо 4).
      m.homeScreenCalls =
        calls.filter((c) => !c.storage).length +
        [...src.matchAll(/\.rpc\s*\(/g)].length + invokes;
    }
  }

  /* ── edge ── */
  const fnRoot = join(cwd, 'supabase', 'functions');
  try {
    m.edgeFunctions = readdirSync(fnRoot, { withFileTypes: true })
      .filter((e) => e.isDirectory() && e.name !== '_shared').length;
  } catch { /* дерева нет — 0 */ }
  try { m.mutateSeamLines = readFileSync(join(fnRoot, '_shared', 'mutate.ts'), 'utf8').split('\n').length; }
  catch { /* шва ещё нет */ }

  for (const file of walk(fnRoot, ['.ts'])) {
    const rel = relative(cwd, file).split(sep).join('/');
    const src = blankComments(readFileSync(file, 'utf8'));

    for (const c of fromCalls(src)) {
      if (c.storage || c.variable || !c.op || !WRITE_OPS.has(c.op)) continue;
      edgeWrite.add(c.table);
    }
    // `_shared/http.ts` ЕСТЬ канон — `Response.json` внутри `jsonError` это то,
    // через что остальные обязаны ходить, а не нарушение.
    if (rel.endsWith('_shared/http.ts')) continue;
    for (const c of responseJsonCalls(src)) if (c.error) m.rawErrors++;
  }

  m.srcWriteTables = [...srcWrite].sort();
  m.edgeWriteTables = [...edgeWrite].sort();
  m.doubleDoor = m.srcWriteTables.filter((t) => edgeWrite.has(t));
  /** ★ ТАБЛИЦА ИЗ БЕЛОГО СПИСКА В `doubleDoor` НЕ ПОПАДАЕТ, И ЭТО РЕШЕНИЕ, А НЕ
   *  УПУЩЕНИЕ. `notifications` пишется браузером (флаг `read`) и edge (9 вставок),
   *  и по §4.C прямая запись флага остаётся НАВСЕГДА — то есть цель 0 была бы
   *  недостижима по уже принятой причине, а недостижимая цель не метрика.
   *  Молчаливым это не делается: такие таблицы печатаются отдельной строкой. */
  m.declaredTwoDoor = [...declared].filter((t) => edgeWrite.has(t)).sort();
  return m;
}

/* ─────────────────────────────── режим --json ───────────────────────────── */

const argv = process.argv.slice(2).filter((a) => a !== '--');
const wantJson = argv.includes('--json');
const wantTarget = argv.includes('--assert-target');
const unknownFlags = argv.filter((a) => a !== '--json' && a !== '--assert-target');
if (unknownFlags.length) {
  die(`неизвестный флаг ${unknownFlags.join(' ')}.`, [
    'Baseline-файла нет и --write нет: потолок — базовая ветка (см. TRIP-282).',
  ]);
}

if (wantJson) {
  process.stdout.write(JSON.stringify(measure(process.cwd()), null, 1));
  process.exit(0);
}

/* ──────────────────────────────── ратчет ────────────────────────────────── */

const git = (args) =>
  execFileSync('git', args, { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024, stdio: ['ignore', 'pipe', 'pipe'] });

try {
  git(['rev-parse', '--verify', `${BASE_REF}^{commit}`]);
} catch {
  // НЕ пропуск. Табло, которое ничего не измерило, не должно печатать «ок».
  die(`BASE_REF ${BASE_REF} не резолвится — дистанцию мерить не от чего.`, [
    'Нужна полная базовая ветка: `git fetch --no-tags origin <base>` +',
    'actions/checkout с `fetch-depth: 0`.',
  ]);
}

// Всё ниже резолвится от cwd. Запуск из подкаталога без этого измеряет пустоту
// и называет её чистотой — ровно так 2l печатал «0 changed file(s) — OK».
const root = git(['rev-parse', '--show-toplevel']).trim();
process.chdir(root);

const holder = mkdtempSync(join(tmpdir(), 'data-door-'));
const basePath = join(holder, 'base');

/** ★ УБОРКА ВИСИТ НА `exit`, А НЕ НА `finally`. `die()` зовёт `process.exit`, а
 *  тот НЕ разматывает стек — `finally` пропускается ровно на тех путях «не смог
 *  измерить», которые и текут. На 2o это нашёл `code-simplifier`, а не тесты. */
process.on('exit', () => {
  try { git(['worktree', 'remove', '--force', basePath]); } catch { /* add мог не состояться */ }
  rmSync(holder, { recursive: true, force: true });
});

try {
  git(['worktree', 'add', '--detach', basePath, BASE_REF]);
} catch (e) {
  die(`не могу выложить ${BASE_REF} в ворктри: ${e.stderr || e.message}`);
}

/**
 * `door-exempt: <метрика> +N — причина` из ДОБАВЛЕННЫХ строк диффа под тем же
 * деревом, которое меряется. Pathspec несущий: без него любая строка репо,
 * упомянувшая маркер, выдаёт бюджет — и первым же об это спотыкается
 * собственный тест гарда (2o так и упал с кодом 2 на вводящем его PR).
 *
 * Считается ПОСЛЕ `worktree add`: путь «умереть на опечатке» обязан проходить
 * через тот же exit-hook, что и остальные пути «не смог измерить», иначе
 * инвариант про утечку не проверяется ни одним тестом.
 */
function allowances() {
  let diff;
  try {
    diff = git(['diff', '--unified=0', `${BASE_REF}...HEAD`, '--', 'src/', 'supabase/functions/']);
  } catch (e) {
    die(`не могу сдиффить против ${BASE_REF}: ${e.stderr || e.message}`);
  }
  const known = new Set(METRICS.map((m) => m.key));
  const out = Object.create(null);
  const re = new RegExp(`${EXEMPT}:\\s*([a-zA-Z][\\w-]*)\\s*\\+(\\d+)`, 'g');
  for (const line of diff.split('\n')) {
    if (!line.startsWith('+') || line.startsWith('+++')) continue;
    const found = [...line.matchAll(re)];
    /** ★ МАРКЕР, КОТОРЫЙ НЕ РАЗОБРАЛСЯ, — ОШИБКА, А НЕ ТИШИНА. `door-exempt:
     *  writes 1` (без плюса) регулярка не берёт, и без этой проверки строка
     *  молча не даёт ничего: автор написал исключение, увидел красноту и не
     *  понимает, почему. Шапка обещает, что опечатка не читается как
     *  «исключений не просили», — это делает обещание правдой. Форма маркера =
     *  ровно то, что гард печатает в подсказке при пробитии. */
    if (!found.length && line.includes(`${EXEMPT}:`)) {
      die(`маркер ${EXEMPT} не разобрался — ожидается «${EXEMPT}: <метрика> +N — причина».`, [
        `маркер был: ${line.slice(1).trim()}`,
        `известные метрики: ${[...known].join(', ')}`,
      ]);
    }
    for (const mm of found) {
      if (!known.has(mm[1])) {
        die(`исключение называет неизвестную метрику \`${mm[1]}\` — опечатка не должна читаться как «исключений не просили».`, [
          `известные метрики: ${[...known].join(', ')}`,
          `маркер был: ${line.slice(1).trim()}`,
        ]);
      }
      out[mm[1]] = (out[mm[1]] ?? 0) + Number(mm[2]);
    }
  }
  return out;
}

const exempt = allowances();
const base = measure(basePath);
const head = measure(root);

const val = (m, key) => (Array.isArray(m[key]) ? m[key].length : m[key]);

/* ─────────────────────────────── печать ─────────────────────────────────── */

const rows = METRICS.map((m) => {
  const was = val(base, m.key);
  const now = val(head, m.key);
  const allowed = exempt[m.key] ?? 0;
  return { ...m, was, now, allowed, over: now - was - allowed, distance: Math.max(0, now - m.target) };
});

const width = Math.max(...rows.map((r) => r.label.length));
console.log(`check-data-door (2r): HEAD vs ${BASE_REF} — табло эпика TRIP-374`);
for (const r of rows) {
  const delta = r.now - r.was;
  const sign = delta > 0 ? `+${delta}` : delta < 0 ? `${delta}` : '=';
  const note = r.allowed ? `  (${EXEMPT} +${r.allowed})` : '';
  const dist = r.distance ? `  до цели ${r.target}: ещё ${r.distance}` : '  цель достигнута';
  console.log(`  ${r.label.padEnd(width)}  ${String(r.was).padStart(4)} → ${String(r.now).padStart(4)}  ${sign}${note}${dist}`);
}

if (head.doubleDoor.length) {
  // По ЧИСЛУ не отличить «клиент ещё пишет» от «edge законно пишет» — поэтому
  // список, а не счётчик (тот же приём, что со списком токенов в 2o).
  console.log(`  ─ две двери записи: ${head.doubleDoor.join(' · ')}`);
}
if (head.declaredTwoDoor.length) {
  console.log(`  ─ две двери ПО ОБЪЯВЛЕНИЮ (белый список §4.C, вне ратчета): ${head.declaredTwoDoor.join(' · ')}`);
}
console.log(
  `  ─ печатается, НЕ ратчетится: edge-функций ${head.edgeFunctions} · точек вызова ${head.edgeCallSites}` +
  ` · _shared/mutate.ts ${head.mutateSeamLines} стр.` +
  ` · вызовов на главной (Trips.jsx) ${head.homeScreenCalls}` +
  ` · storage ${head.storageCalls} · записей по белому списку ${head.whitelistedWrites}`,
);
if (head.rpcVariable) console.log(`  ─ .rpc() через переменную: ${head.rpcVariable} (требует классификации вручную)`);

/* ─────────────────────────────── вердикты ───────────────────────────────── */

if (head.unknownRpc.length) {
  console.error('::error::check-data-door: клиентский RPC вне манифеста — его корзину выбирают осознанно, а не по умолчанию');
  for (const u of head.unknownRpc) console.error(`  ✗ ${u}`);
  console.error('');
  console.error('  Допиши имя в RPC-манифест этого гарда (мутирующий / читающий / газеттир).');
  console.error('  Молчаливая корзина означала бы, что новый RPC с клиента не виден табло.');
  process.exit(1);
}

const broken = rows.filter((r) => r.over > 0);
if (broken.length) {
  console.error('::error::check-data-door: движение к единой двери пошло назад (TRIP-374 §5)');
  for (const r of broken) {
    console.error(`  ✗ ${r.label}: ${r.was} → ${r.now} (+${r.now - r.was}${r.allowed ? `, разрешено +${r.allowed}` : ''})`);
  }
  if (broken.some((r) => r.key === 'doubleDoor')) {
    const fresh = head.doubleDoor.filter((t) => !base.doubleDoor.includes(t));
    if (fresh.length) console.error(`      новые таблицы с двумя дверями: ${fresh.join(' · ')}`);
    console.error('      Объект либо целиком за дверью, либо целиком нет: полуперенос — это');
    console.error('      механизм, которым «общая оболочка при форкнутом состоянии» разъехалась (TRIP-293).');
  }
  console.error('');
  console.error('  Табло храповит ВСЕ числа сразу именно затем, чтобы «одно снизили, другое');
  console.error('  вырастили» перестало быть возможным (TRIP-337 §4).');
  console.error('');
  console.error('  Если рост согласован — пометь строку в этом же PR, причина и апрув в тексте:');
  console.error(`      // ${EXEMPT}: ${broken[0].key} +${broken[0].now - broken[0].was - broken[0].allowed} — причина + апрув Pavel`);
  process.exit(1);
}

const far = rows.filter((r) => r.distance > 0);
if (wantTarget && far.length) {
  console.error('::error::check-data-door --assert-target: до целей эпика ещё не доехали');
  for (const r of far) console.error(`  ✗ ${r.label}: ${r.now}, цель ${r.target}`);
  process.exit(1);
}

console.log(far.length ? `  ратчет держится; до цели осталось метрик: ${far.length}.` : '  все цели эпика достигнуты.');
process.exit(0);
