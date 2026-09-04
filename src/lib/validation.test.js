// Unit tests for the unified validation engine (Ф1). Run: npm test  (node --test)
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { validateEntity, validateTrip, primaryIssues, transferAiCityAdvisories, isFieldRequired, sameCity } from './validation.js';

const codes = (issues) => issues.map((i) => i.code).sort();
const has = (issues, code) => issues.some((i) => i.code === code);

const VISIT = {
  id: 'c1', city_name: 'Lisbon', country_code: 'PT', timezone: 'UTC', kind: 'transit',
  start_date: '2026-07-07', end_date: '2026-07-10', position: 1,
};

// ---------- Hotel ----------
test('hotel: valid -> no issues', () => {
  const issues = validateEntity('hotel', { id: 'h1', name: 'Memmo', checkIn: '2026-07-07T15:00:00', checkOut: '2026-07-10T10:00:00' }, { visit: VISIT });
  assert.deepEqual(issues, []);
});
test('hotel: blank name + missing dates', () => {
  const issues = validateEntity('hotel', { id: 'h1', name: '  ', checkIn: '', checkOut: '' }, { visit: VISIT });
  assert.ok(has(issues, 'HOTEL_NAME_REQUIRED'));
  assert.ok(has(issues, 'HOTEL_CHECKIN_REQUIRED'));
  assert.ok(has(issues, 'HOTEL_CHECKOUT_REQUIRED'));
});
test('hotel: checkout <= checkin -> HOTEL_ORDER', () => {
  const issues = validateEntity('hotel', { id: 'h1', name: 'X', checkIn: '2026-07-09T15:00:00', checkOut: '2026-07-08T10:00:00' }, { visit: VISIT });
  assert.ok(has(issues, 'HOTEL_ORDER'));
});
test('hotel: out-of-bounds -> error (was soft warn)', () => {
  const issues = validateEntity('hotel', { id: 'h1', name: 'X', checkIn: '2026-07-05T15:00:00', checkOut: '2026-07-12T10:00:00' }, { visit: VISIT });
  assert.ok(has(issues, 'HOTEL_CHECKIN_OOB'));
  assert.ok(has(issues, 'HOTEL_CHECKOUT_OOB'));
  assert.ok(issues.every((i) => i.level === 'error'));
});

// ---------- Activity ----------
test('activity: end required + order', () => {
  const issues = validateEntity('activity', { id: 'a1', title: 'Fado', start: '2026-07-08T20:00:00', end: '' }, { visit: VISIT });
  assert.ok(has(issues, 'ACT_END_REQUIRED'));
});
test('activity: out-of-bounds', () => {
  const issues = validateEntity('activity', { id: 'a1', title: 'Fado', start: '2026-07-06T20:00:00', end: '2026-07-06T22:00:00' }, { visit: VISIT });
  assert.ok(has(issues, 'ACT_START_OOB'));
});

// ---------- Transfer (single) ----------
const FROM = { ...VISIT, id: 'c1' };
const TO = { id: 'c2', city_name: 'Porto', timezone: 'UTC', kind: 'transit', start_date: '2026-07-10', end_date: '2026-07-12' };
test('transfer: no city -> TR_NO_CITY only', () => {
  const issues = validateEntity('transfer', { id: 't1', start: '2026-07-10T12:00:00', end: '2026-07-10T15:00:00' }, {});
  assert.deepEqual(codes(issues), ['TR_NO_CITY']);
});
test('transfer: same-day departure (gap 0) ok', () => {
  const issues = validateEntity('transfer', { id: 't1', start: '2026-07-10T12:00:00', end: '2026-07-10T15:00:00' }, { fromVisit: FROM, toVisit: TO });
  assert.deepEqual(issues, []);
});
test('transfer: +1 day departure -> TR_DEP_DAY warning (tolerance is 0)', () => {
  const issues = validateEntity('transfer', { id: 't1', start: '2026-07-11T00:20:00', end: '2026-07-11T02:00:00' }, { fromVisit: FROM, toVisit: TO });
  const dep = issues.find((i) => i.code === 'TR_DEP_DAY');
  assert.ok(dep, 'a one-day gap now flags TR_DEP_DAY');
  assert.equal(dep.level, 'warning', 'day mismatch is advisory, not blocking');
});
test('transfer: +3 days departure -> TR_DEP_DAY warning', () => {
  const issues = validateEntity('transfer', { id: 't1', start: '2026-07-13T12:00:00', end: '2026-07-13T15:00:00' }, { fromVisit: FROM, toVisit: TO });
  assert.ok(has(issues, 'TR_DEP_DAY'));
});
test('transfer: late wall-clock departure in an eastern tz stays on the leave day (no false TR_DEP_DAY)', () => {
  // Regression (TRIP-195): event datetimes are NAIVE wall-clock. A 21:35 departure
  // in Yekaterinburg (UTC+5) stored as +00 must count as the SAME day the traveller
  // leaves — not roll to the next day via setZone(city tz). Overnight arrival next
  // morning in Moscow lands on that city's day. Exact data from trip f3079dda.
  const YEKB = { id: 'y1', city_name: 'Yekaterinburg', timezone: 'Asia/Yekaterinburg', kind: 'start', start_date: '2026-07-05', end_date: '2026-07-05' };
  const MOW = { id: 'm1', city_name: 'Moscow', timezone: 'Europe/Moscow', kind: 'waypoint', start_date: '2026-07-06', end_date: '2026-07-06' };
  const issues = validateEntity('transfer', { id: 't1', start: '2026-07-05T21:35:00+00', end: '2026-07-06T01:05:00+00' }, { fromVisit: YEKB, toVisit: MOW });
  assert.ok(!has(issues, 'TR_DEP_DAY'), 'departure lands on the leave day');
  assert.ok(!has(issues, 'TR_ARR_DAY'), 'arrival lands on the reach day');
});
test('transfer: wrong date order -> TR_ORDER is a blocking error', () => {
  const issues = validateEntity('transfer', { id: 't1', start: '2026-07-10T15:00:00', end: '2026-07-10T12:00:00' }, { fromVisit: FROM, toVisit: TO });
  const ord = issues.find((i) => i.code === 'TR_ORDER');
  assert.ok(ord);
  assert.equal(ord.level, 'error');
});
test('hotel: wrong date order -> HOTEL_ORDER is a blocking error', () => {
  const issues = validateEntity('hotel', { id: 'h1', name: 'Memmo', checkIn: '2026-07-10T15:00:00', checkOut: '2026-07-08T10:00:00' }, { visit: VISIT });
  const ord = issues.find((i) => i.code === 'HOTEL_ORDER');
  assert.ok(ord);
  assert.equal(ord.level, 'error');
});

// ---------- Transfer (layover) ----------
test('layover: <2 segments -> SEG_MIN', () => {
  const issues = validateEntity('transfer', { id: 't1', hasLayovers: true, segments: [{ start: 'x', end: 'y' }] });
  assert.deepEqual(codes(issues), ['SEG_MIN']);
});
test('layover: backstep + missing layover city', () => {
  const segs = [
    { start: '2026-07-10T08:00:00', end: '2026-07-10T10:00:00', toCity: null },
    { start: '2026-07-10T09:00:00', end: '2026-07-10T12:00:00' },
  ];
  const issues = validateEntity('transfer', { id: 't1', hasLayovers: true, segments: segs });
  assert.ok(has(issues, 'SEG_BACKSTEP'));
  assert.ok(has(issues, 'SEG_CITY_REQUIRED'));
});
test('layover: endpoints aligned with trip days -> no day errors', () => {
  const segs = [
    { start: '2026-07-10T08:00:00', end: '2026-07-10T10:00:00', toCity: { city_name: 'Madrid' } },
    { start: '2026-07-10T11:00:00', end: '2026-07-10T16:00:00' },
  ];
  const issues = validateEntity('transfer', { id: 't1', hasLayovers: true, segments: segs }, { fromVisit: FROM, toVisit: TO });
  assert.ok(!has(issues, 'TR_DEP_DAY'));
  assert.ok(!has(issues, 'TR_ARR_DAY'));
});
test('layover: first departure far from the leave day -> TR_DEP_DAY (arrival is no longer checked)', () => {
  const segs = [
    { start: '2026-07-15T08:00:00', end: '2026-07-15T10:00:00', toCity: { city_name: 'Madrid' } },
    { start: '2026-07-20T11:00:00', end: '2026-07-20T16:00:00' },
  ];
  const issues = validateEntity('transfer', { id: 't1', hasLayovers: true, segments: segs }, { fromVisit: FROM, toVisit: TO });
  assert.ok(has(issues, 'TR_DEP_DAY'));
  assert.ok(!has(issues, 'TR_ARR_DAY'), 'arrival defines the next city start now — not flagged');
});

// ---------- AI city-mismatch advisories (ephemeral, parse-time) ----------
test('advisory: single transfer city matches trip -> no advisory', () => {
  const data = { transfers: [{ from_city: 'Lisbon', to_city: 'Porto' }] };
  assert.deepEqual(transferAiCityAdvisories(data, FROM, TO), []);
});
test('advisory: single transfer endpoints differ -> FROM + TO', () => {
  const data = { transfers: [{ from_city: 'Madrid', to_city: 'Moscow' }] };
  const adv = transferAiCityAdvisories(data, FROM, TO);
  assert.ok(has(adv, 'AI_CITY_MISMATCH_FROM'));
  assert.ok(has(adv, 'AI_CITY_MISMATCH_TO'));
  assert.ok(adv.every((i) => i.level === 'warning'));
});
test('advisory: layover leg connection mismatch -> AI_LAYOVER_CITY_MISMATCH', () => {
  const data = { transfers: [
    { from_city: 'Lisbon', to_city: 'Madrid' },
    { from_city: 'Barcelona', to_city: 'Porto' }, // arrives Madrid, next departs Barcelona
  ] };
  const adv = transferAiCityAdvisories(data, FROM, TO);
  assert.ok(has(adv, 'AI_LAYOVER_CITY_MISMATCH'));
});
test('advisory: blank AI cities -> nothing to compare', () => {
  const data = { transfers: [{}] };
  assert.deepEqual(transferAiCityAdvisories(data, FROM, TO), []);
});

// ---------- Service ----------
test('service: required + order', () => {
  const issues = validateEntity('service', { id: 's1', name: '', pickupAddress: '', pickup: '2026-07-09T10:00:00', dropoff: '2026-07-08T10:00:00', isEdit: false });
  assert.ok(has(issues, 'SVC_NAME_REQUIRED'));
  assert.ok(has(issues, 'SVC_PICKUP_ADDR_REQUIRED'));
  assert.ok(has(issues, 'SVC_ORDER'));
});

// ---------- City ----------
test('city: anchors skipped', () => {
  assert.deepEqual(validateEntity('city', { id: 'a', kind: 'start' }), []);
});
test('city: dates required', () => {
  const issues = validateEntity('city', { id: 'c', kind: 'transit', city_name: 'X' });
  assert.ok(has(issues, 'CITY_DATES_REQUIRED'));
});

// ---------- Trip meta ----------
test('trip: title/start/cities/unresolved', () => {
  const issues = validateEntity('trip', { title: '', startDate: '', cities: [{ city_name: 'Rome', latitude: null }] });
  assert.ok(has(issues, 'TRIP_TITLE_REQUIRED'));
  assert.ok(has(issues, 'TRIP_START_REQUIRED'));
  assert.ok(has(issues, 'TRIP_CITY_UNRESOLVED'));
  assert.ok(!has(issues, 'TRIP_NO_CITIES'));
});

// ---------- validateTrip (cross-entity) ----------
test('validateTrip: 1-day overlap OK, 2-day overlap -> CITY_OVERLAP error', () => {
  const a = { ...VISIT, id: 'a', end_date: '2026-07-10' };
  const b1 = { id: 'b', city_name: 'B', kind: 'transit', timezone: 'UTC', start_date: '2026-07-09', end_date: '2026-07-12', position: 2 };
  assert.ok(!has(validateTrip({ visits: [a, b1] }), 'CITY_OVERLAP'));
  const b2 = { ...b1, start_date: '2026-07-08' };
  assert.ok(has(validateTrip({ visits: [a, b2] }), 'CITY_OVERLAP'));
});
test('validateTrip: duplicate transfer -> DUP_TRANSFER warning', () => {
  const a = { ...VISIT, id: 'a', position: 1 };
  const b = { id: 'b', city_name: 'B', kind: 'transit', timezone: 'UTC', start_date: '2026-07-10', end_date: '2026-07-12', position: 2 };
  const tr = { from_city_visit_id: 'a', to_city_visit_id: 'b', start_datetime: '2026-07-10T12:00:00', end_datetime: '2026-07-10T16:00:00' };
  const issues = validateTrip({ visits: [a, b], transfers: [{ id: 't1', ...tr }, { id: 't2', ...tr }] });
  const dup = issues.find((i) => i.code === 'DUP_TRANSFER');
  assert.ok(dup && dup.level === 'warning');
});
test('validateTrip: orphan hotel -> HOTEL_NO_CITY', () => {
  const issues = validateTrip({ visits: [VISIT], hotels: [{ id: 'h', name: 'X', city_visit_id: 'missing' }] });
  assert.ok(has(issues, 'HOTEL_NO_CITY'));
});

// ---------- primaryIssues ----------
test('primaryIssues: collapses hotel B1+B2 to one', () => {
  const issues = validateEntity('hotel', { id: 'h1', name: 'X', checkIn: '2026-07-05T15:00:00', checkOut: '2026-07-12T10:00:00' }, { visit: VISIT });
  assert.equal(issues.length, 2);
  assert.equal(primaryIssues(issues).length, 1);
});
// ---------- Budget forms ----------
test('expense: title/amount/category required; amount must be > 0', () => {
  assert.deepEqual(codes(validateEntity('expense', { title: '', amount: '', categoryId: '' })).sort(),
    ['EXP_AMOUNT_REQUIRED', 'EXP_CATEGORY_REQUIRED', 'EXP_TITLE_REQUIRED']);
  assert.ok(has(validateEntity('expense', { title: 'X', amount: '0', categoryId: 'c1' }), 'EXP_AMOUNT_REQUIRED'));
  assert.deepEqual(validateEntity('expense', { title: 'X', amount: '12.5', categoryId: 'c1' }), []);
});
test('category: name required', () => {
  assert.ok(has(validateEntity('category', { name: '  ' }), 'CAT_NAME_REQUIRED'));
  assert.deepEqual(validateEntity('category', { name: 'Food' }), []);
});
test('fx: invalid non-empty rate is error; empty is ignored', () => {
  assert.deepEqual(validateEntity('fx', { rates: { USD: '', EUR: '1.1' } }), []);
  const bad = validateEntity('fx', { rates: { USD: '-1', GBP: 'abc' } });
  assert.equal(bad.length, 2);
  assert.ok(bad.every((i) => i.code === 'FX_RATE_INVALID'));
});

test('document: title required', () => {
  assert.ok(has(validateEntity('document', { title: '' }), 'DOC_TITLE_REQUIRED'));
  assert.deepEqual(validateEntity('document', { title: 'Visa' }), []);
});
test('invite: email mode vs offline mode', () => {
  assert.ok(has(validateEntity('invite', { mode: 'email', email: 'bad' }), 'INV_EMAIL_INVALID'));
  assert.deepEqual(validateEntity('invite', { mode: 'email', email: 'a@b.com' }), []);
  assert.ok(has(validateEntity('invite', { mode: 'offline', name: '' }), 'INV_NAME_REQUIRED'));
  assert.deepEqual(validateEntity('invite', { mode: 'offline', name: 'Joe' }), []);
});

// ---------- isFieldRequired (звёздочка на экране) ----------
// Экран рисует звёздочку по ЭТОМУ ответу, поэтому тест держит ровно то, на что
// жалуются глазами: обязательное поле без звёздочки и звёздочка на
// необязательном. Оба направления проверяются на каждой сущности.
const req = (kind, draft, ctx, field) => isFieldRequired(kind, draft, ctx, field);

test('required: не зависит от того, заполнено ли поле сейчас', () => {
  // Ровно та ошибка, ради которой это делалось: пока поле заполнено, ошибки в
  // списке нет - но обязательным оно быть не перестало.
  const filled = { id: 'h1', name: 'Memmo', checkIn: '2026-07-07T15:00:00', checkOut: '2026-07-10T10:00:00' };
  assert.equal(req('hotel', filled, { visit: VISIT }, 'name'), true);
  assert.equal(req('hotel', {}, { visit: VISIT }, 'name'), true);
});

test('required: обязательные и необязательные поля по сущностям', () => {
  assert.deepEqual(
    ['name', 'checkIn', 'checkOut', 'notes'].map((f) => req('hotel', {}, { visit: VISIT }, f)),
    [true, true, true, false],
  );
  assert.deepEqual(
    ['title', 'start', 'end', 'address'].map((f) => req('activity', {}, { visit: VISIT }, f)),
    [true, true, true, false],
  );
  assert.deepEqual(
    ['title', 'amount', 'categoryId', 'note'].map((f) => req('expense', {}, {}, f)),
    [true, true, true, false],
  );
  assert.deepEqual(['name', 'colour'].map((f) => req('category', {}, {}, f)), [true, false]);
  assert.deepEqual(['title', 'notes'].map((f) => req('document', {}, {}, f)), [true, false]);
});

test('required: условная обязательность считается от черновика', () => {
  // Адрес получения обязателен только при СОЗДАНИИ - на редактировании звёздочки
  // быть не должно.
  const car = { service_kind: 'car_rental' };
  assert.equal(req('service', car, {}, 'pickupAddress'), true);
  assert.equal(req('service', { ...car, isEdit: true }, {}, 'pickupAddress'), false);
  // У eSIM/страховки из всех полей обязательно только название.
  assert.equal(req('service', { service_kind: 'esim' }, {}, 'name'), true);
  assert.equal(req('service', { service_kind: 'esim' }, {}, 'pickup'), false);
});

test('required: приглашение - обязательность зависит от режима', () => {
  assert.equal(req('invite', { mode: 'offline' }, {}, 'name'), true);
  assert.equal(req('invite', { mode: 'email' }, {}, 'name'), false);
  // Пустой e-mail даёт INV_EMAIL_INVALID - обязательность БЕЗ суффикса _REQUIRED,
  // поэтому считать её по имени кода было бы неверно.
  assert.equal(req('invite', { mode: 'email' }, {}, 'email'), true);
  assert.equal(req('invite', { mode: 'link' }, {}, 'email'), false);
});

test('required: считается по гейту ФОРМЫ, а не по сырому вердикту', () => {
  // Редактор события понижает до совета всё, чего нет в его `BLOCKING_CODES`,
  // поэтому сохраняется и без названия. Звёздочка обязана следовать за этим
  // гейтом - иначе поле помечено обязательным, а форма его не требует.
  // Набор скопирован из EventEditDialog дословно: `endsWith('_ORDER')` дал бы
  // ДРУГОЙ список (без `SEG_BACKSTEP`, зато с `INS_DATE_ORDER`/`CITY_ORDER`) -
  // тест проверял бы гейт, которого в приложении нет.
  const car = { service_kind: 'car_rental' };
  const EED_BLOCKING = new Set(['HOTEL_ORDER', 'ACT_ORDER', 'TR_ORDER', 'SVC_ORDER', 'SEG_ORDER', 'SEG_BACKSTEP']);
  const blocksInEventEditor = (i) => EED_BLOCKING.has(i.code);
  assert.equal(req('service', car, {}, 'name'), true);                                   // сырой вердикт
  assert.equal(isFieldRequired('service', car, {}, 'name', blocksInEventEditor), false);  // гейт формы
  // Формы на useHybridValidation блокируют по любой ошибке - там звёздочка есть.
  assert.equal(req('expense', {}, {}, 'title'), true);
});

test('required: курс валюты необязателен (пусто = авто-курс)', () => {
  assert.equal(req('fx', { rates: { USD: '1.1' } }, {}, 'rate.USD'), false);
});

test('required: сегменты переезда адресуются по своему токену', () => {
  const draft = {
    hasLayovers: true,
    segments: [
      { start: '2026-07-07T10:00:00', end: '2026-07-07T12:00:00', toCity: { city_name: 'Porto' } },
      { start: '2026-07-07T14:00:00', end: '2026-07-07T16:00:00' },
    ],
  };
  const ctx = { fromVisit: VISIT, toVisit: { ...VISIT, id: 'c2', city_name: 'Porto' } };
  assert.equal(req('transfer', draft, ctx, 'seg0.start'), true);
  assert.equal(req('transfer', draft, ctx, 'seg1.end'), true);
  assert.equal(req('transfer', draft, ctx, 'seg0.note'), false);
});

test('primaryIssues: transfer structure beats entity', () => {
  const issues = [
    { level: 'error', code: 'TR_NO_CITY', scope: 'structure', entityKind: 'transfer', entityId: 't1' },
    { level: 'error', code: 'TR_DEP_DAY', scope: 'entity', entityKind: 'transfer', entityId: 't1' },
  ];
  const p = primaryIssues(issues);
  assert.equal(p.length, 1);
  assert.equal(p[0].code, 'TR_NO_CITY');
});

test('★sameCity: НЕОПОЗНАННЫЙ ГОРОД НЕ РАВЕН НЕОПОЗНАННОМУ', () => {
  // Узел без geonameid/city_name_en/external_city_id даёт ПУСТУЮ идентичность.
  // Сравнение «в лоб» делало два таких узла одним городом — и лента переставала
  // предупреждать «Нет переезда», а «Подготовка» теряла стыки. Молча.
  const bare = (id) => ({ id, city_name: `Город ${id}` });
  assert.equal(sameCity(bare('a'), bare('b')), false);
  // Опознанные сравниваются как раньше — по geonameid, потом по имени+стране.
  assert.equal(sameCity({ geonameid: 5 }, { geonameid: 5 }), true);
  assert.equal(sameCity({ geonameid: 5 }, { geonameid: 6 }), false);
  assert.equal(sameCity({ city_name_en: 'Rome', country_code: 'IT' }, { city_name_en: 'rome', country_code: 'it' }), true);
  // Опознанный и неопознанный — тем более разные.
  assert.equal(sameCity({ geonameid: 5 }, bare('b')), false);
});
