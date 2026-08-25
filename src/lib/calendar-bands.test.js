// @ts-check
import test from 'node:test';
import assert from 'node:assert/strict';

import { cityBands, bandStyle } from './calendar-bands.js';

/** Город в дне: `idx` — тождество ВИЗИТА (один город может встретиться дважды). */
const c = (idx, name) => ({ name, colorIdx: idx, v: { idx } });
/** Ряд из описания «какие города в каждом дне»; `null` = день без поездки. */
const row = (...days) => days.map(d => ({ cities: d ? [].concat(d) : [] }));

test('город на несколько дней подряд — одна полоса от края до края', () => {
  const [b, ...rest] = cityBands(row(c(1, 'Мадрид'), c(1, 'Мадрид'), c(1, 'Мадрид')));
  assert.equal(rest.length, 0);
  assert.deepEqual({ start: b.start, end: b.end, split: b.split }, { start: 0, end: 3, split: false });
  assert.equal(b.city.name, 'Мадрид');
});

test('★ город с ОДНОЙ ночью между двумя пересадками всё равно получает полосу', () => {
  // День 1: Мадрид. День 2: Мадрид уезжает, Барселона заезжает. День 3:
  // Барселона уезжает, Валенсия заезжает. День 4: Валенсия.
  // У Барселоны НЕТ ни одного дня, где она одна — прежняя редакция не рисовала
  // ей имя вообще. Полоса обязана существовать и иметь ненулевую ширину.
  const bands = cityBands(row(
    c(1, 'Мадрид'),
    [c(1, 'Мадрид'), c(2, 'Барселона')],
    [c(2, 'Барселона'), c(3, 'Валенсия')],
    c(3, 'Валенсия'),
  ));
  assert.deepEqual(bands.map(b => b.city.name), ['Мадрид', 'Барселона', 'Валенсия']);

  const bcn = bands[1];
  assert.equal(bcn.start, 1.5, 'заезд — во второй половине дня пересадки');
  assert.equal(bcn.end, 2.5, 'выезд — в первой половине следующей пересадки');
  assert.ok(bcn.end - bcn.start > 0, 'полоса непустая — в неё есть куда написать имя');
  assert.equal(bcn.split, true);
});

test('день пересадки делится ровно пополам и без зазора', () => {
  const bands = cityBands(row(c(1, 'A'), [c(1, 'A'), c(2, 'B')], c(2, 'B')));
  const [a, b] = bands;
  assert.equal(a.end, 1.5);
  assert.equal(b.start, 1.5, 'конец одной полосы = начало следующей, дыры нет');
  assert.equal(a.start, 0);
  assert.equal(b.end, 3);
});

test('три города в одном дне делят его на три равные доли', () => {
  const bands = cityBands(row([c(1, 'A'), c(2, 'B'), c(3, 'C')]));
  assert.deepEqual(bands.map(b => [b.start, b.end]), [[0, 1 / 3], [1 / 3, 2 / 3], [2 / 3, 1]]);
});

test('пустые дни полос не дают и не рвут соседние', () => {
  const bands = cityBands(row(null, c(1, 'A'), null, c(2, 'B'), null));
  assert.deepEqual(bands.map(b => [b.city.name, b.start, b.end]), [['A', 1, 2], ['B', 3, 4]]);
});

test('один и тот же ГОРОД двумя визитами — две полосы, не склеиваются', () => {
  // Возврат в тот же город: имя совпадает, визит другой. Склейка по имени
  // растянула бы одну полосу через весь ряд, накрыв город посередине.
  const bands = cityBands(row(c(1, 'Рим'), c(2, 'Милан'), c(3, 'Рим')));
  assert.equal(bands.length, 3);
  assert.deepEqual(bands.map(b => [b.city.name, b.start, b.end]),
    [['Рим', 0, 1], ['Милан', 1, 2], ['Рим', 2, 3]]);
});

test('пустой ряд — пустой список, без падения', () => {
  assert.deepEqual(cityBands([]), []);
  assert.deepEqual(cityBands(row(null, null)), []);
});

test('город без идентификатора визита полосы не даёт (не роняет ряд)', () => {
  const bands = cityBands([{ cities: [{ name: 'X', colorIdx: 0, v: /** @type {any} */ ({}) }] }]);
  assert.deepEqual(bands, []);
});

test('bandStyle переводит доли дня в проценты ряда', () => {
  assert.deepEqual(bandStyle({ start: 0, end: 7, city: c(1, 'A'), split: false }),
    { left: '0%', width: '100%' });
  assert.deepEqual(bandStyle({ start: 1.5, end: 2.5, city: c(1, 'A'), split: true }),
    { left: `${(1.5 / 7) * 100}%`, width: `${(1 / 7) * 100}%` });
});
