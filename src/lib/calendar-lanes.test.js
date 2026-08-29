// @ts-check
import test from 'node:test';
import assert from 'node:assert/strict';

import { eventLanes } from './calendar-lanes.js';

/** «HH:mm» → минуты от полуночи — той же единицей, что у отрезков дня. */
const at = (hhmm) => {
  const [h, m] = hhmm.split(':').map(Number);
  return h * 60 + m;
};
/** Отрезок из «HH:mm» или «HH:mm-HH:mm»; без конца — час (так рисуется МОМЕНТ). */
const span = (s) => {
  const [a, b] = s.split('-');
  return { from: at(a), to: b ? at(b) : at(a) + 60 };
};
const lanes = (times) => eventLanes(times.map(span));

test('★ пара пересекающихся событий НЕ жмёт остальной день', () => {
  // Ровно случай со скрина: перелёт 07:40, выезд 11:00 и пара 14:00/14:10.
  // Пополам делят колонку ТОЛЬКО двое последних.
  const out = lanes(['07:40', '11:00', '14:00', '14:10']);
  assert.deepEqual(out, [
    { lane: 0, lanes: 1 },
    { lane: 0, lanes: 1 },
    { lane: 0, lanes: 2 },
    { lane: 1, lanes: 2 },
  ]);
});

test('событие впритык (конец = начало) — свой кластер, полная ширина', () => {
  assert.deepEqual(lanes(['16:00', '17:00']), [
    { lane: 0, lanes: 1 },
    { lane: 0, lanes: 1 },
  ]);
});

test('три одновременных делят колонку на три', () => {
  const out = lanes(['09:00', '09:15', '09:30']);
  assert.deepEqual(out.map(o => o.lanes), [3, 3, 3]);
  assert.deepEqual(out.map(o => o.lane), [0, 1, 2]);
});

test('цепочка A↔B, B↔C (A с C не пересекается) — один кластер на две дорожки', () => {
  // Стандартное поведение календарей: ширину внутри кластера делят поровну,
  // чтобы ни один блок не лёг поверх чужого текста.
  const out = lanes(['10:00', '10:30', '11:00']);
  assert.deepEqual(out, [
    { lane: 0, lanes: 2 },
    { lane: 1, lanes: 2 },
    { lane: 0, lanes: 2 },
  ]);
});

test('порядок входа сохраняется — результат ложится на исходный массив', () => {
  const out = lanes(['14:10', '07:40', '14:00']);
  assert.deepEqual(out, [
    { lane: 1, lanes: 2 },
    { lane: 0, lanes: 1 },
    { lane: 0, lanes: 2 },
  ]);
});

test('пустой день и один день — без дорожек и на всю ширину', () => {
  assert.deepEqual(eventLanes([]), []);
  assert.deepEqual(lanes(['08:00']), [{ lane: 0, lanes: 1 }]);
});

test('★ пересечение считается по РЕАЛЬНОМУ отрезку, а не по слоту в час', () => {
  // Получасовая активность 10:00–10:30 не пересекается с 10:45 (по слоту в час —
  // пересекалась), а длинная 10:00–14:00 пересекается с перелётом в 12:00
  // (по слоту в час — не пересекалась).
  assert.deepEqual(lanes(['10:00-10:30', '10:45-11:15']).map(o => o.lanes), [1, 1]);
  assert.deepEqual(lanes(['10:00-14:00', '12:00-13:00']).map(o => o.lanes), [2, 2]);
});

test('нулевой/отрицательный отрезок не съедает дорожку навсегда', () => {
  // Кривые данные (конец = начало) не должны занимать дорожку до конца дня.
  assert.deepEqual(eventLanes([{ from: 600, to: 600 }, { from: 660, to: 720 }]).map(o => o.lanes), [1, 1]);
});
