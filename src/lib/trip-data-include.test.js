// Держит регрессию TRIP-277 — и после TRIP-349 держит её СТРУКТУРНО.
//
// Было: экран трипа и редактор маршрута жили на РАЗНЫХ роутах, но делили одну
// запись кэша React Query на ключ, поэтому обязаны были просить одинаковый
// `include`. Редактор просил `['content']`, трип — `['content','budget']`, а
// getTripDetails при незапрошенном 'budget' не кладёт бюджетные ключи вовсе →
// заход в редактор ПЕРЕЗАПИСЫВАЛ общую запись payload'ом без бюджета, и виджет
// бюджета оставался пустым до перезагрузки.
//
// Стало: редактор — секция внутри TripView и получает уже загруженное пропами.
// Просящий остался ОДИН, то есть разъехаться двум include больше негде. Это
// сильнее прежнего правила («оба обязаны просить одинаково»), поэтому тест
// проверяет именно единственность: заведут второго читателя со своим include —
// вернётся и старый баг, и второй набор гейтов рядом с первым.
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

test('у общих ключей трипа РОВНО ОДИН читатель', () => {
  // Читатель = файл, который сам запрашивает трип через getTripDetails с общим
  // include. Именно из ДВУХ читателей и вырос TRIP-277.
  const readers = FILES
    .filter((f) => f.code.includes('invokeGetTripDetails')
      && (f.code.includes('TRIP_SHELL_INCLUDE') || f.code.includes('TRIP_CONTENT_INCLUDE')))
    .map((f) => f.path);
  assert.deepEqual(
    readers, ['pages/TripView.jsx'],
    'трип грузит кто-то ещё кроме TripView; секции обязаны получать shell/content '
      + 'ПРОПАМИ, иначе рядом появится второй include и второй набор гейтов',
  );
});

test('единственный читатель просит обе половины через общие константы', () => {
  const view = FILES.find((f) => f.path === 'pages/TripView.jsx');
  assert.ok(view, 'pages/TripView.jsx не найден');
  assert.ok(view.code.includes('TRIP_SHELL_INCLUDE'), 'TripView не просит shell через общую константу');
  assert.ok(view.code.includes('TRIP_CONTENT_INCLUDE'), 'TripView не просит content через общую константу');
});
