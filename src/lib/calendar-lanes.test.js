// @ts-check
import test from 'node:test';
import assert from 'node:assert/strict';

import { eventLanes } from './calendar-lanes.js';

/** «HH:mm» → минуты от полуночи — тем же ключом, каким тайм-грид кладёт startMin. */
const at = (hhmm) => {
  const [h, m] = hhmm.split(':').map(Number);
  return h * 60 + m;
};
const lanes = (times, slot) => eventLanes(times.map(at), slot);

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

test('slotMin — та же длительность, какой сетка рисует блок', () => {
  // При получасовом блоке 14:00 и 14:10 всё ещё пересекаются, а 14:00 и 14:30 — нет.
  assert.deepEqual(lanes(['14:00', '14:30'], 30).map(o => o.lanes), [1, 1]);
  assert.deepEqual(lanes(['14:00', '14:10'], 30).map(o => o.lanes), [2, 2]);
});
