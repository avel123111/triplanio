// Unit tests for the unified validation engine (Ф1). Run: npm test  (node --test)
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { validateEntity, validateTrip, primaryIssues } from './validation.js';

const codes = (issues) => issues.map((i) => i.code).sort();
const has = (issues, code) => issues.some((i) => i.code === code);

const VISIT = {
  id: 'c1', city_name: 'Lisbon', country_code: 'PT', timezone: 'UTC', kind: 'transit',
  start_datetime: '2026-07-07T12:00:00', end_datetime: '2026-07-10T11:00:00', position: 1,
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
const TO = { id: 'c2', city_name: 'Porto', timezone: 'UTC', kind: 'transit', start_datetime: '2026-07-10T18:00:00', end_datetime: '2026-07-12T11:00:00' };
test('transfer: no city -> TR_NO_CITY only', () => {
  const issues = validateEntity('transfer', { id: 't1', start: '2026-07-10T12:00:00', end: '2026-07-10T15:00:00' }, {});
  assert.deepEqual(codes(issues), ['TR_NO_CITY']);
});
test('transfer: same-day departure (gap 0) ok', () => {
  const issues = validateEntity('transfer', { id: 't1', start: '2026-07-10T12:00:00', end: '2026-07-10T15:00:00' }, { fromVisit: FROM, toVisit: TO });
  assert.deepEqual(issues, []);
});
test('transfer: +1 day departure within tolerance (00:20 case)', () => {
  const issues = validateEntity('transfer', { id: 't1', start: '2026-07-11T00:20:00', end: '2026-07-11T02:00:00' }, { fromVisit: FROM, toVisit: TO });
  assert.ok(!has(issues, 'TR_DEP_DAY'));
});
test('transfer: +3 days departure -> TR_DEP_DAY error', () => {
  const issues = validateEntity('transfer', { id: 't1', start: '2026-07-13T12:00:00', end: '2026-07-13T15:00:00' }, { fromVisit: FROM, toVisit: TO });
  assert.ok(has(issues, 'TR_DEP_DAY'));
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
  const a = { ...VISIT, id: 'a', end_datetime: '2026-07-10T11:00:00' };
  const b1 = { id: 'b', city_name: 'B', kind: 'transit', timezone: 'UTC', start_datetime: '2026-07-09T12:00:00', end_datetime: '2026-07-12T11:00:00', position: 2 };
  assert.ok(!has(validateTrip({ visits: [a, b1] }), 'CITY_OVERLAP'));
  const b2 = { ...b1, start_datetime: '2026-07-08T12:00:00' };
  assert.ok(has(validateTrip({ visits: [a, b2] }), 'CITY_OVERLAP'));
});
test('validateTrip: duplicate transfer -> DUP_TRANSFER warning', () => {
  const a = { ...VISIT, id: 'a', position: 1 };
  const b = { id: 'b', city_name: 'B', kind: 'transit', timezone: 'UTC', start_datetime: '2026-07-10T18:00:00', end_datetime: '2026-07-12T11:00:00', position: 2 };
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

test('primaryIssues: transfer structure beats entity', () => {
  const issues = [
    { level: 'error', code: 'TR_NO_CITY', scope: 'structure', entityKind: 'transfer', entityId: 't1' },
    { level: 'error', code: 'TR_DEP_DAY', scope: 'entity', entityKind: 'transfer', entityId: 't1' },
  ];
  const p = primaryIssues(issues);
  assert.equal(p.length, 1);
  assert.equal(p[0].code, 'TR_NO_CITY');
});
