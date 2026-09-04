// @ts-check
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  buildPreparation, cityNights, cityNeedsHotel, hotelCoversCity, routeLegs,
} from './trip-preparation.js';

// Узлы маршрута. `geonameid` несёт идентичность города (cityIdentity), поэтому
// он обязателен: без него два узла сравниваются как ОДИН город и стык исчезает.
const city = (id, gn, start, end, extra = {}) => ({
  id, geonameid: gn, city_name: `C${gn}`, kind: 'transit',
  start_date: start, end_date: end, position: id, ...extra,
});
const anchor = (id, gn, kind) => ({ id, geonameid: gn, city_name: `A${gn}`, kind });

// Маршрут: старт(1) → город A(2, 3 ночи) → город B(3, 2 ночи) → финиш(4).
const VISITS = [
  anchor('n1', 100, 'start'),
  city('n2', 200, '2026-05-01', '2026-05-04'),
  city('n3', 300, '2026-05-04', '2026-05-06'),
  anchor('n4', 100, 'end'),
];

test('cityNights: разница дат в днях, без дат — 0', () => {
  assert.equal(cityNights({ start_date: '2026-05-01', end_date: '2026-05-04' }), 3);
  assert.equal(cityNights({ start_date: '2026-05-01', end_date: null }), 0);
  assert.equal(cityNights({}), 0);
});

test('cityNeedsHotel: путевая точка и город без ночей отеля не требуют', () => {
  assert.equal(cityNeedsHotel(city('x', 1, '2026-05-01', '2026-05-03')), true);
  assert.equal(cityNeedsHotel(city('x', 1, '2026-05-01', '2026-05-01')), false);
  assert.equal(cityNeedsHotel(city('x', 1, '2026-05-01', '2026-05-03', { kind: 'waypoint' })), false);
});

test('hotelCoversCity: привязка по city_visit_id, иначе перекрытие дат', () => {
  const v = city('n2', 200, '2026-05-01', '2026-05-04');
  assert.equal(hotelCoversCity({ city_visit_id: 'n2' }, v), true);
  // Привязанный к ДРУГОМУ городу отель этот город не покрывает, даже если даты совпали.
  assert.equal(hotelCoversCity({
    city_visit_id: 'nX', check_in_datetime: '2026-05-01T14:00', check_out_datetime: '2026-05-04T11:00',
  }, v), false);
  assert.equal(hotelCoversCity({
    check_in_datetime: '2026-05-01T14:00', check_out_datetime: '2026-05-04T11:00',
  }, v), true);
  assert.equal(hotelCoversCity({
    check_in_datetime: '2026-06-01T14:00', check_out_datetime: '2026-06-04T11:00',
  }, v), false);
});

test('routeLegs: стыки идут по соседним узлам, включая якоря', () => {
  const legs = routeLegs(VISITS);
  assert.deepEqual(legs.map((l) => [l.from.id, l.to.id]), [['n1', 'n2'], ['n2', 'n3'], ['n3', 'n4']]);
});

test('routeLegs: пара с ТЕМ ЖЕ городом стыком не считается', () => {
  const split = [
    anchor('n1', 100, 'start'),
    city('n2', 200, '2026-05-01', '2026-05-03'),
    city('n3', 200, '2026-05-03', '2026-05-05'), // тот же город, сплит стоянки
    anchor('n4', 100, 'end'),
  ];
  assert.deepEqual(routeLegs(split).map((l) => [l.from.id, l.to.id]), [['n1', 'n2'], ['n3', 'n4']]);
});

test('buildPreparation: знаменатель = ночлеги + стыки текущего маршрута', () => {
  const p = buildPreparation({ visits: VISITS, hotels: [], transfers: [] });
  assert.equal(p.stays.length, 2);
  assert.equal(p.legs.length, 3);
  assert.equal(p.total, 5);
  assert.equal(p.done, 0);
  assert.equal(p.pct, 0);
});

test('buildPreparation: покрытые ночлеги и стыки идут в числитель', () => {
  const p = buildPreparation({
    visits: VISITS,
    hotels: [{ id: 'h1', city_visit_id: 'n2' }],
    transfers: [{ id: 't1', from_city_visit_id: 'n2', to_city_visit_id: 'n3' }],
  });
  assert.equal(p.done, 2);
  assert.equal(p.total, 5);
  assert.equal(p.stays[0].booked, true);
  assert.deepEqual(p.stays[0].bookings.map((h) => h.id), ['h1']);
  assert.equal(p.stays[1].booked, false);
  assert.deepEqual(p.legs.map((l) => l.booked), [false, true, false]);
});

test('★ОТМЕРШАЯ БРОНЬ НЕ УЧИТЫВАЕТСЯ: переезд между несоседними узлами', () => {
  // n1 → n3 в маршруте не стык (между ними n2). Такой переезд валидатор метит
  // TR_NOT_ADJACENT; здесь он просто не покрывает ни одного стыка.
  const p = buildPreparation({
    visits: VISITS,
    hotels: [],
    transfers: [{ id: 'dead', from_city_visit_id: 'n1', to_city_visit_id: 'n3' }],
  });
  assert.equal(p.done, 0);
  assert.equal(p.total, 5);
  assert.ok(p.legs.every((l) => l.bookings.length === 0));
});

test('★ОТМЕРШАЯ БРОНЬ НЕ УЧИТЫВАЕТСЯ: отель удалённого города', () => {
  const p = buildPreparation({
    visits: VISITS,
    hotels: [{ id: 'orphan', city_visit_id: 'gone' }],
    transfers: [],
  });
  assert.equal(p.done, 0);
  assert.ok(p.stays.every((s) => !s.booked));
});

test('buildPreparation: всё забронировано → pct = 1', () => {
  const p = buildPreparation({
    visits: VISITS,
    hotels: [{ id: 'h1', city_visit_id: 'n2' }, { id: 'h2', city_visit_id: 'n3' }],
    transfers: [
      { id: 't1', from_city_visit_id: 'n1', to_city_visit_id: 'n2' },
      { id: 't2', from_city_visit_id: 'n2', to_city_visit_id: 'n3' },
      { id: 't3', from_city_visit_id: 'n3', to_city_visit_id: 'n4' },
    ],
  });
  assert.equal(p.done, 5);
  assert.equal(p.pct, 1);
});

test('buildPreparation: пустой маршрут — не «готово», а нечего готовить', () => {
  const p = buildPreparation({ visits: [], hotels: [], transfers: [] });
  assert.equal(p.total, 0);
  assert.equal(p.pct, 0);
});

test('★НЕОПОЗНАННЫЙ ГОРОД НЕ РАВЕН НЕОПОЗНАННОМУ: стыки не схлопываются в ноль', () => {
  // Узлы без `geonameid`/`city_name_en`/`external_city_id`: `cityIdentity`
  // отдаёт по пустой строке на каждый. Сравнение «в лоб» делало их ОДНИМ
  // городом, и весь маршрут терял ВСЕ стыки разом — секция «Переезды» просто
  // не рисовалась, молча и без ошибки.
  const bare = (id, start, end) => ({ id, city_name: `Город ${id}`, kind: 'transit', start_date: start, end_date: end, position: id });
  const visits = [bare('a', '2026-05-01', '2026-05-03'), bare('b', '2026-05-03', '2026-05-05'), bare('c', '2026-05-05', '2026-05-07')];
  assert.equal(routeLegs(visits).length, 2);
  // При этом РЕАЛЬНОЕ совпадение города (сплит стоянки) стыком по-прежнему не становится.
  const same = [
    { id: 'a', geonameid: 5, kind: 'transit', start_date: '2026-05-01', end_date: '2026-05-03', position: 1 },
    { id: 'b', geonameid: 5, kind: 'transit', start_date: '2026-05-03', end_date: '2026-05-05', position: 2 },
  ];
  assert.equal(routeLegs(same).length, 0);
});
