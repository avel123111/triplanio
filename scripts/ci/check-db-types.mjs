#!/usr/bin/env node
/**
 * CI guard 2t (TRIP-383, Ф0.5 эпика TRIP-374) — дрейф типов БД: закоммиченный
 * `supabase/functions/_shared/database.types.ts` обязан совпадать с типами,
 * сгенерированными из `supabase/migrations/**`.
 *
 * ЗАЧЕМ. Шов Ф1 (`_shared/mutate.ts`) пишется на типы схемы, а не на `any`.
 * Типы — генерируемый артефакт: он стареет молча. Миграция добавляет колонку,
 * типы остаются прежними — и шов продолжает компилироваться, потому что новой
 * колонки в типе просто нет, а лишнее поле в `insert` TypeScript у объекта
 * без индексной сигнатуры отвергнет, зато ПРОПУЩЕННОЕ обязательное поле
 * выглядит как «его и не должно быть». Устаревшие типы хуже отсутствующих:
 * отсутствующие видно, устаревшие ВРУТ с видом проверенного.
 *
 * ★★ ГЛАВНОЕ ОГРАНИЧЕНИЕ СПОСОБА — назвать вслух, потому что его легко принять
 * за большее. Генерация типов читает ЖИВУЮ базу. В CI живой базы нет (и звать
 * её оттуда нельзя: PR с новой миграцией к этому моменту ещё не задеплоен, то
 * есть сверка с живой dev была бы КРАСНОЙ на каждом правильном ходе, а такой
 * гард выключают). Поэтому 2t сверяет **МИГРАЦИИ ↔ ТИПЫ**, а не dev/prod ↔ типы:
 *   · ЛОВИТ: «миграция поменяла схему, а типы не перегенерили»;
 *   · НЕ ЛОВИТ: правку схемы мимо миграции (дашборд, ручной SQL) — она уводит
 *     живую БД от репо, и типы останутся верными ОТНОСИТЕЛЬНО РЕПО, будучи
 *     неверными относительно базы. Этот класс закрывает не 2t, а инвариант
 *     авто-деплоя «репо == dev == prod» (TRIP-68/73: `db push` катит
 *     `supabase/migrations/**` в оба проекта) и живой ассерт ярусов.
 * ЗАМЕР НА ВВОДЕ ГАРДА (2026-08-09, живые каталоги обоих проектов): dev
 * `nydhzevdizkfaxdlikgc` и prod `tizscxrpuopobgcxbekf` идентичны — 41 таблица,
 * 6 вью, 472 колонки, 104 функции, 0 нативных enum, ОДИНАКОВЫЕ md5 сигнатур
 * колонок и функций; журналы миграций по 96 записей с максимумом
 * `20260805210500` = ровно 96 файлов в `supabase/migrations/`. Сверка сделана
 * С ДАТЧИКОМ: тем же запросом снят `count(city_visits)` — 534 против 226,
 * то есть отвечали ДВЕ РАЗНЫЕ базы, а не одна дважды.
 *
 * ПОЧЕМУ ОТДЕЛЬНАЯ ДЖОБА, а не шаг в `guards`. Производящая половина требует
 * Docker и Supabase CLI (поднять postgres, накатить миграции), а `guards`
 * намеренно живёт на стандартной библиотеке без `npm ci` — по той же причине
 * отдельно живут 2o/2p/2q.
 *
 * ★ РАЗДЕЛЕНИЕ «ПРОИЗВЕСТИ» И «СУДИТЬ» — то, что даёт гарду тест. Поднимает
 * базу и генерирует джоба; ЭТОТ файл только судит два текста, поэтому его
 * тест кормится фикстурами и не требует ни Docker, ни сети
 * (`scripts/ci/check-db-types.test.mjs`).
 *
 * ★★ ДАТЧИК СЛЕПОТЫ. Пустая база генерирует ВАЛИДНЫЙ файл (`Tables: { [_ in
 * never]: never }`), и сверка двух пустых была бы зелёной по построению, а
 * сверка пустого с настоящим — красной по НЕВЕРНОЙ причине («типы устарели»
 * вместо «база не поднялась»). Поэтому обе стороны сначала проверяются на
 * признак жизни, и его отсутствие = код 2 «не смог измерить», а не 1 и тем
 * более не 0: «нечего проверять» и «проверено, чисто» не должны печатать
 * одинаковый вердикт (TRIP-282).
 *
 * ★ ЕДИНСТВЕННОЕ, ЧТО НЕ СВЕРЯЕТСЯ, — `__InternalSupabase.PostgrestVersion`:
 * это версия РАНТАЙМА PostgREST, а не схемы. Облако и локальный стек стоят на
 * разных версиях, и сверка этого ключа красила бы PR за то, что CLI обновил
 * образ. Исключение НАЗВАНО, узкое (один ключ) и ПЕЧАТАЕТСЯ на каждом прогоне
 * обоими значениями — маркера-обхода на что-либо ещё у 2t нет намеренно.
 *
 * ЗАПУСК: `node scripts/ci/check-db-types.mjs <путь-к-сгенерированному-файлу>`
 * (или `GENERATED_TYPES=<путь>`); закоммиченный артефакт берётся из
 * `COMMITTED_TYPES` либо из пути по умолчанию.
 *
 * КОДЫ ВЫХОДА: 0 — совпало · 1 — дрейф · 2 — не смог измерить.
 */
import { readFileSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';

const COMMITTED = process.env.COMMITTED_TYPES || 'supabase/functions/_shared/database.types.ts';
const GENERATED = process.argv[2] || process.env.GENERATED_TYPES || '';

/** Признак жизни: в типах есть корень схемы и хотя бы одна таблица/вью. */
const ROW_RE = /^\s*Row: \{$/gm;
const looksLikeTypes = (text) => text.includes('export type Database') && countRows(text) > 0;
const countRows = (text) => (text.match(ROW_RE) || []).length;

/** Версия рантайма PostgREST — см. шапку: печатается, но не сверяется. */
const PGRST_RE = /(PostgrestVersion:\s*)(["'])(.*?)\2/;
const pgrstVersion = (text) => text.match(PGRST_RE)?.[3] ?? '(нет ключа)';

/** Сверяется СМЫСЛ файла, а не его перенос строк: CRLF и хвостовые пробелы. */
const normalize = (text) =>
  text
    .replace(/\r\n/g, '\n')
    .replace(PGRST_RE, '$1$2<не сверяется>$2')
    .split('\n')
    .map((line) => line.replace(/[ \t]+$/, ''))
    .join('\n')
    .replace(/\n+$/, '\n');

function die(message, hint) {
  console.error(`::error::check-db-types: ${message}`);
  if (hint) console.error(hint);
  process.exit(2);
}

if (!GENERATED) {
  die(
    'не передан путь к сгенерированному файлу',
    '  → джоба обязана сперва поднять базу и вызвать `supabase gen types typescript --local`,\n' +
      '    а сюда передать путь к её выводу: node scripts/ci/check-db-types.mjs <файл>',
  );
}

for (const [label, path] of [
  ['сгенерированный', GENERATED],
  ['закоммиченный', COMMITTED],
]) {
  if (!existsSync(path)) {
    die(
      `${label} файл типов не найден: ${resolve(path)}`,
      label === 'закоммиченный'
        ? `  → артефакт обязан лежать в репо: ${COMMITTED}. Если он удалён — это и есть дрейф,\n` +
          '    верни его тем же `supabase gen types typescript`, а не руками.'
        : '  → шаг генерации не отработал; красить PR за это нельзя, но и печатать OK — тем более.',
    );
  }
}

const generatedRaw = readFileSync(GENERATED, 'utf8');
const committedRaw = readFileSync(COMMITTED, 'utf8');
// Датчик жизни считается по НОРМАЛИЗОВАННОМУ тексту, а не по сырому: предикат,
// чувствительный к форме записи, — дыра по построению (TRIP-388). Первая
// редакция считала по сырому, и файл с CRLF (`Row: {\r`) выпадал из наблюдения
// ЦЕЛИКОМ — гард печатал «не смог измерить» на здоровой генерации. Поймал тест.
const generated = normalize(generatedRaw);
const committed = normalize(committedRaw);

for (const [label, path, text] of [
  ['сгенерированный', GENERATED, generated],
  ['закоммиченный', COMMITTED, committed],
]) {
  if (!looksLikeTypes(text)) {
    die(
      `${label} файл (${path}) не похож на типы схемы: ${countRows(text)} таблиц/вью, ` +
        `корень схемы ${text.includes('export type Database') ? 'есть' : 'отсутствует'}`,
      '  → ДАТЧИК СЛЕПОТЫ (см. шапку): пустая база генерирует ВАЛИДНЫЙ файл без единой таблицы,\n' +
        '    и сверка с ним ответила бы не на тот вопрос. Это «не смог измерить», а не «типы устарели».',
    );
  }
}

console.log(
  `check-db-types: сгенерировано ${countRows(generated)} таблиц/вью, ` +
    `закоммичено ${countRows(committed)}; ` +
    `PostgrestVersion сгенерированный ${pgrstVersion(generatedRaw)} / ` +
    `закоммиченный ${pgrstVersion(committedRaw)} (не сверяется — см. шапку)`,
);

if (generated === committed) {
  console.log(`check-db-types: OK — ${COMMITTED} совпадает с типами из supabase/migrations/**`);
  process.exit(0);
}

const a = committed.split('\n');
const b = generated.split('\n');
const LIMIT = 40;
const shown = [];
for (let i = 0; i < Math.max(a.length, b.length) && shown.length < LIMIT; i += 1) {
  if (a[i] === b[i]) continue;
  if (a[i] !== undefined) shown.push(`  ${i + 1}- закоммичено: ${a[i]}`);
  if (b[i] !== undefined) shown.push(`  ${i + 1}+ из миграций: ${b[i]}`);
}

console.error(
  '::error::check-db-types: типы БД разошлись с миграциями — ' +
    `${COMMITTED} не совпадает с тем, что генерируется из supabase/migrations/**`,
);
console.error(shown.join('\n'));
if (shown.length >= LIMIT) console.error(`  … показаны первые ${LIMIT} расхождений`);
console.error(
  '\n  → перегенерируй артефакт и закоммить его вместе с миграцией:\n' +
    `     supabase gen types typescript --local --schema public > ${COMMITTED}\n` +
    '     (локально это `supabase db start` + та же команда; правка файла руками — не лечение:\n' +
    '      он обязан быть воспроизводимым выводом генератора)',
);
process.exit(1);
