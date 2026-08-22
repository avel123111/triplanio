#!/usr/bin/env node
/**
 * Тесты общего разбора маркеров-исключений (scripts/ci/exempt-markers.mjs).
 *
 * ПОЧЕМУ ОТДЕЛЬНО И ЮНИТОМ. Гарды 2o и 2r проверяются end-to-end подпроцессом в
 * одноразовом git-репо (там пинуется I/O: pathspec, только добавленные строки,
 * exit-коды). Разбор ФОРМЫ маркера — чистая функция, и её три исхода (валидный /
 * опечатка имени / опечатка формы) дешевле и честнее пинить прямо, инжектя `die`,
 * который БРОСАЕТ вместо `process.exit`. Так тест видит текст отказа и не выходит
 * из процесса. Правило «гард = код, у него есть тест»: этот файл увиден красным
 * мутацией (снять пояс «не разобрался» → падает кейс «нет числа»).
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseValueExemptions } from './exempt-markers.mjs';

/** `die`, который бросает: `err.extra` несёт строки-подсказки. Валит тест, если
 *  разбор НЕ отказал там, где должен (иначе мутация пройдёт зелёной). */
const throwingDie = (msg, extra = []) => {
  const e = new Error(msg);
  e.extra = extra;
  throw e;
};

/** Собрать «дифф» из строк так, будто все они ДОБАВЛЕНЫ (`+`). */
const added = (...lines) => lines.map((l) => `+${l}`).join('\n');

const METRICS = [
  { key: 'classes' },
  { key: 'inline' },
  { key: 'dsshare', up: true }, // «только вверх»: нарушение — падение, форма всё равно `+N`
];
// Разбор возвращает объект без прототипа (`Object.create(null)`) — плоское копирование
// перед сравнением, иначе deepStrictEqual краснеет на несовпадении прототипа, а не сути.
const parse = (diff) => ({ ...parseValueExemptions(diff, { marker: 'floor-exempt', metrics: METRICS, die: throwingDie }) });

test('валидный маркер → бюджет по ключу, без отказа', () => {
  assert.deepEqual(parse(added('/* floor-exempt: classes +3 — причина */')), { classes: 3 });
});

test('несколько маркеров суммируются по ключу', () => {
  const diff = added('/* floor-exempt: classes +2 — раз */', '/* floor-exempt: classes +5 — два */');
  assert.deepEqual(parse(diff), { classes: 7 });
});

test('метрика «только вверх» использует ту же форму +N', () => {
  assert.deepEqual(parse(added('/* floor-exempt: dsshare +40 — новый экран сырьём */')), { dsshare: 40 });
});

test('неизвестное ИМЯ метрики → отказ, а не тихий ноль', () => {
  assert.throws(() => parse(added('/* floor-exempt: klasses +9 — опечатка */')), /неизвестную метрику/);
});

test('не тот ЗНАК (-N) → отказ', () => {
  assert.throws(() => parse(added('/* floor-exempt: classes -1 — знак не тот */')), /не тот ЗНАК/);
});

test('★ знак НЕ НАЗВАН (classes 1) → отказ', () => {
  assert.throws(() => parse(added('/* floor-exempt: classes 1 — знак не назван */')), /НЕ НАЗВАН ЗНАК/);
});

test('★ ФОРМА без числа вовсе (classes) → «не разобрался», а не тишина', () => {
  // Это остаток TRIP-384: строгая регулярка `<имя> +N` такую строку не берёт,
  // и без пояса она молча не даёт ничего. Пояс делает опечатку в ФОРМЕ такой же
  // громкой, как опечатку в ИМЕНИ.
  assert.throws(() => parse(added('/* floor-exempt: classes — забыл число */')), /не разобрался/);
});

test('★ кривая форма с двоеточием, но без имени (floor-exempt: +5) → «не разобрался»', () => {
  assert.throws(() => parse(added('/* floor-exempt: +5 — забыл имя метрики */')), /не разобрался/);
});

test('строка НЕ добавлена (контекст/удаление) → маркер игнорируется', () => {
  // Контекстная строка (без ведущего `+`) и `+++`-заголовок диффа не читаются.
  const diff = ' /* floor-exempt: classes +3 */\n+++ b/src/a.css';
  assert.deepEqual(parse(diff), {});
});

test('слово в прозе без «marker:» пояс не роняет', () => {
  // `line.includes("floor-exempt:")` — с двоеточием, чтобы упоминание маркера в
  // тексте не читалось как кривой маркер.
  assert.deepEqual(parse(added('// см. floor-exempt в соседнем гарде')), {});
});
