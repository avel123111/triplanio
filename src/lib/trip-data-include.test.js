// Держит регрессию TRIP-277 — и после TRIP-349 держит её СТРУКТУРНО.
//
// Было: экран трипа и редактор маршрута жили на РАЗНЫХ роутах, но делили одну
// запись кэша React Query на ключ, поэтому обязаны были просить одинаковый
// `include`. Редактор просил `['content']`, трип — `['content','budget']`, а
// getTripDetails при незапрошенном 'budget' не кладёт бюджетные ключи вовсе →
// заход в редактор ПЕРЕЗАПИСЫВАЛ общую запись payload'ом без бюджета, и виджет
// бюджета оставался пустым до перезагрузки.
//
// Стало: редактор — секция внутри TripView и получает уже загруженное пропами,
// а САМ ЗАПРОС собирает один модуль-дескриптор (`lib/invokeTripFn.js`): он
// называет и ключ, и include, и фетчер, экраны передают только tripId.
//
// Единственность переехала с ВЫЗЫВАТЕЛЯ на ФОРМУ, и это не ослабление. Прежнее
// «просящий ровно один» держалось, пока повод сходить за трипом был один; второй
// повод (прогрев кэша перед переходом в редактор) заставил бы завести рядом
// второй include — ровно ту регрессию, от которой правило и написано. Теперь
// читателей может быть сколько угодно, а форма у ключа одна ПО ПОСТРОЕНИЮ.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { TRIP_CONTENT_INCLUDE, TRIP_SHELL_INCLUDE } from './trip-data.js';

// Обход от ЭТОГО файла, не от cwd.
const SRC = fileURLToPath(new URL('../', import.meta.url));

function walk(dir, out = []) {
  for (const name of readdirSync(dir)) {
    const full = dir + name;
    if (statSync(full).isDirectory()) walk(full + '/', out);
    else if (/\.jsx?$/.test(name) && !name.includes('.test.')) out.push(full);
  }
  return out;
}

// Комментарии гасим ПЕРЕД разбором: первый прогон этого теста покраснел на
// строке документации `getTripDetails (include: ['content'])` в MembersLens —
// то есть на тексте, а не на коде. Ровно та же грабля, что у CI-гардов.
const strip = (src) => src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/[^\n]*/g, '$1');

const FILES = walk(SRC).map((full) => ({
  path: full.slice(SRC.length),
  src: readFileSync(full, 'utf8'),
})).map((f) => ({ ...f, code: strip(f.src) }));

test('each key keeps exactly one payload shape', () => {
  assert.deepEqual(TRIP_SHELL_INCLUDE, ['shell']);
  // Dropping 'budget' here blanks the budget widget on Overview and Budget.
  assert.deepEqual(TRIP_CONTENT_INCLUDE, ['content', 'budget']);
});

test('никто не пишет include массивом на месте', () => {
  const offenders = FILES
    .filter((f) => f.path !== 'lib/trip-data.js' && /include:\s*\[[^\]]*\]/.test(f.code))
    .map((f) => f.path);
  assert.deepEqual(
    offenders, [],
    'include объявлен литералом вместо TRIP_SHELL_INCLUDE / TRIP_CONTENT_INCLUDE — '
      + 'общая запись кэша перестанет иметь одну форму',
  );
});

test('форму общих ключей трипа собирает РОВНО ОДИН модуль', () => {
  // Правило то же (TRIP-277: один ключ = одна форма), но точка единственности
  // переехала с ВЫЗЫВАТЕЛЯ на ДЕСКРИПТОР — и от этого стала строже.
  //
  // Было: «просящий ровно один — TripView». Формулировка держалась, пока повод
  // сходить за трипом был один. Как только появился второй (прогрев кэша из
  // планировщика перед переходом в редактор), она заставила бы завести рядом
  // второй `include` — ровно ту регрессию, от которой правило и написано.
  //
  // Стало: `include` и фетчер называет ТОЛЬКО `lib/invokeTripFn.js`, экраны
  // передают tripId. Читателей запроса может быть сколько угодно, а форма у
  // ключа по-прежнему одна — теперь ПО ПОСТРОЕНИЮ, а не по договорённости.
  const shapers = FILES
    .filter((f) => f.code.includes('invokeGetTripDetails')
      && (f.code.includes('TRIP_SHELL_INCLUDE') || f.code.includes('TRIP_CONTENT_INCLUDE')))
    .map((f) => f.path);
  assert.deepEqual(
    shapers, ['lib/invokeTripFn.js'],
    'форму общего ключа собирает кто-то ещё кроме дескрипторов: рядом появится '
      + 'второй include и второй набор гейтов',
  );
});

test('единственный сборщик формы объявляет обе половины', () => {
  const mod = FILES.find((f) => f.path === 'lib/invokeTripFn.js');
  assert.ok(mod, 'lib/invokeTripFn.js не найден');
  assert.ok(mod.code.includes('TRIP_SHELL_INCLUDE'), 'дескриптор shell не просит общую константу');
  assert.ok(mod.code.includes('TRIP_CONTENT_INCLUDE'), 'дескриптор content не просит общую константу');
});

test('экраны не собирают запрос трипа сами — только дескриптором', () => {
  // Прямой вызов фетчера с общего ключа из экрана — это и есть возврат к двум
  // формам. `DocsLens` не в счёт: у него СВОЙ ключ и свой include (TRIP-399).
  const offenders = FILES
    .filter((f) => f.path.startsWith('pages/') || f.path.startsWith('components/'))
    .filter((f) => f.code.includes('TRIP_SHELL_INCLUDE') || f.code.includes('TRIP_CONTENT_INCLUDE'))
    .map((f) => f.path);
  assert.deepEqual(offenders, [], 'экран называет общий include вместо дескриптора');
});
