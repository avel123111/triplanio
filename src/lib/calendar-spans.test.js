// @ts-check
import test from 'node:test';
import assert from 'node:assert/strict';

import { eventSegments, eventDuration, minutesOf, DAY_MIN, POINT_MIN } from './calendar-spans.js';

/** Событие потока в форме, в которой его кладёт `buildEventStream`. */
const ev = (type, date, time, endDate, endTime) => ({ type, date, time, endDate, endTime });
const at = (s) => { const [h, m] = s.split(':').map(Number); return h * 60 + m; };

test('★ активность рисуется РЕАЛЬНОЙ длительностью, а не часом', () => {
  // Случай со скрина: 10:00–12:00 рисовалось как 10:00–11:00.
  const [s, ...rest] = eventSegments(ev('activity', '2026-09-08', '10:00', '2026-09-08', '12:00'));
  assert.equal(rest.length, 0);
  assert.deepEqual({ from: s.from, to: s.to }, { from: at('10:00'), to: at('12:00') });
  assert.equal(s.dateKey, '2026-09-08');
});

test('переезд — тоже интервал, от вылета до прилёта', () => {
  const [s] = eventSegments(ev('flight', '2026-09-11', '12:00', '2026-09-11', '14:10'));
  assert.deepEqual({ from: s.from, to: s.to }, { from: at('12:00'), to: at('14:10') });
});

test('★ момент (заезд/выезд/дедлайн/авто) — ровно час от указанного времени', () => {
  for (const type of ['hotel-checkin', 'hotel-checkout', 'hotel-deadline', 'car-pickup', 'car-return']) {
    const [s, ...rest] = eventSegments(ev(type, '2026-09-12', '15:00'));
    assert.equal(rest.length, 0, type);
    assert.equal(s.to - s.from, POINT_MIN, type);
  }
});

test('★ интервал через полночь — ДВА отрезка: хвост дня и начало следующего', () => {
  const segs = eventSegments(ev('flight', '2026-09-11', '23:00', '2026-09-12', '07:00'));
  assert.deepEqual(segs, [
    { dateKey: '2026-09-11', from: at('23:00'), to: DAY_MIN, contPrev: false, contNext: true },
    { dateKey: '2026-09-12', from: 0, to: at('07:00'), contPrev: true, contNext: false },
  ]);
});

test('интервал длиннее суток — целые сутки посередине', () => {
  const segs = eventSegments(ev('activity', '2026-09-08', '18:00', '2026-09-10', '09:00'));
  assert.deepEqual(segs.map(s => [s.dateKey, s.from, s.to]), [
    ['2026-09-08', at('18:00'), DAY_MIN],
    ['2026-09-09', 0, DAY_MIN],
    ['2026-09-10', 0, at('09:00')],
  ]);
  assert.deepEqual(segs.map(s => [s.contPrev, s.contNext]), [[false, true], [true, true], [true, false]]);
});

test('интервал ровно до полуночи — ОДИН отрезок, пустого второго дня нет', () => {
  const segs = eventSegments(ev('activity', '2026-09-08', '22:00', '2026-09-09', '00:00'));
  assert.equal(segs.length, 1);
  assert.deepEqual([segs[0].to, segs[0].contNext], [DAY_MIN, false]);
});

test('★ выдуманный час МОМЕНТА через полночь не переносится — обрезается сутками', () => {
  const segs = eventSegments(ev('hotel-checkin', '2026-09-12', '23:30'));
  assert.equal(segs.length, 1);
  assert.deepEqual([segs[0].from, segs[0].to, segs[0].contNext], [at('23:30'), DAY_MIN, false]);
});

test('кривые данные падают на час, а не на отрицательную высоту', () => {
  // конца нет · конец раньше начала · конец не разобран · день конца мусорный
  assert.equal(eventDuration(ev('activity', '2026-09-08', '10:00'), at('10:00')), POINT_MIN);
  assert.equal(eventDuration(ev('activity', '2026-09-08', '10:00', '2026-09-08', '09:00'), at('10:00')), POINT_MIN);
  assert.equal(eventDuration(ev('activity', '2026-09-08', '10:00', '2026-09-08', 'нет'), at('10:00')), POINT_MIN);
  assert.equal(eventDuration(ev('activity', '2026-09-08', '10:00', 'что-то', '12:00'), at('10:00')), POINT_MIN);
});

test('событие без времени или без дня на ось часов не едет (оно в «весь день»)', () => {
  assert.deepEqual(eventSegments(ev('transfer', '2026-09-11', '')), []);
  assert.deepEqual(eventSegments(ev('transfer', null, '12:00')), []);
  assert.deepEqual(eventSegments(null), []);
});

test('minutesOf — час/минуты в пределах суток, иначе null', () => {
  assert.equal(minutesOf('00:00'), 0);
  assert.equal(minutesOf('23:59'), 1439);
  assert.equal(minutesOf('9:05'), 545);
  for (const bad of ['', null, '24:00', '12:60', 'полдень']) assert.equal(minutesOf(bad), null, String(bad));
});
