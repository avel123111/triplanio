// formatDateRange — THE app-wide rule for joining two dates into a range.
// Regression guard for TRIP-230: the map lens (and three more screens) each had
// their own join and printed "12 июл – 12 июл" for start/finish nodes and
// 0-night layovers. Run: npm test (node --test)
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { formatDateRange } from './trip-dates.js';

// Stand-in for a screen's own single-date formatter (day + short month).
const fmtDM = (iso) => {
  const d = new Date(iso);
  return `${d.getUTCDate()} ${['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'][d.getUTCMonth()]}`;
};

test('a real range keeps both ends', () => {
  assert.equal(formatDateRange('2026-07-12', '2026-07-16', fmtDM), '12 Jul – 16 Jul');
});

test('both ends on the same day collapse to ONE date', () => {
  assert.equal(formatDateRange('2026-07-12', '2026-07-12', fmtDM), '12 Jul');
});

test('ends that RENDER the same collapse, even if the raw values differ', () => {
  // Same calendar day, different times — a 0-night layover as stored.
  assert.equal(formatDateRange('2026-07-12T08:00:00Z', '2026-07-12T23:30:00Z', fmtDM), '12 Jul');
});

test('one known end renders alone, not as a half-empty range', () => {
  assert.equal(formatDateRange('2026-07-12', null, fmtDM), '12 Jul');
  assert.equal(formatDateRange(null, '2026-07-16', fmtDM), '16 Jul');
});

test('no dates at all render as an empty string', () => {
  assert.equal(formatDateRange(null, null, fmtDM), '');
  assert.equal(formatDateRange('', '', fmtDM), '');
});

test('the separator is overridable without touching the collapse rule', () => {
  assert.equal(formatDateRange('2026-07-12', '2026-07-16', fmtDM, ' - '), '12 Jul - 16 Jul');
  assert.equal(formatDateRange('2026-07-12', '2026-07-12', fmtDM, ' - '), '12 Jul');
});

// ─── Фаза трипа во времени ───────────────────────────────────────────────────
// Регрессия-гейт: до этого правил было ДВА (список — `isTripInPast`, виджет —
// свой проход с `startMs <= now`), и оба сравнивали ЛОКАЛЬНУЮ полночь с
// UTC-полуночью `date`-колонки. Здесь правило одно и оно в днях, поэтому
// «сегодня» задаётся аргументом — тест не зависит от таймзоны машины.
import {
  tripPhase, isTripInPast, tripProgress, currentCityVisit, sortActiveTrips,
} from './trip-dates.js';
import { tripDuration } from './trip-stats.js';

const city = (start, end, kind = 'transit') => ({ kind, start_date: start, end_date: end });
const TODAY = '2026-08-27';

test('tripPhase различает четыре положения относительно сегодня', () => {
  assert.equal(tripPhase([city('2026-08-20', '2026-08-26')], TODAY), 'past');
  assert.equal(tripPhase([city('2026-08-25', '2026-09-01')], TODAY), 'ongoing');
  assert.equal(tripPhase([city('2026-09-08', '2026-09-16')], TODAY), 'upcoming');
  assert.equal(tripPhase([], TODAY), 'undated');
  assert.equal(tripPhase([city(null, null)], TODAY), 'undated');
});

test('день старта и день финиша — ещё ИДЁТ, не «будущее» и не «прошедшее»', () => {
  // Ровно то, что теряли оба прежних предиката: в день старта виджет выбрасывал
  // трип (`startMs <= now`), а в отрицательных таймзонах день финиша уже читался
  // как прошедший.
  assert.equal(tripPhase([city('2026-08-27', '2026-09-01')], TODAY), 'ongoing');
  assert.equal(tripPhase([city('2026-08-20', '2026-08-27')], TODAY), 'ongoing');
  assert.equal(isTripInPast([city('2026-08-20', '2026-08-27')], TODAY), false);
});

test('трип без дат не прошедший — он остаётся в активной ленте', () => {
  assert.equal(isTripInPast([], TODAY), false);
  assert.equal(isTripInPast([city(null, null)], TODAY), false);
});

test('tripProgress считает день, всего и остаток; у не идущего его нет', () => {
  const visits = [city('2026-08-25', '2026-09-01')];
  assert.deepEqual(tripProgress(visits, TODAY), { day: 3, total: 8, left: 5 });
  assert.deepEqual(tripProgress(visits, '2026-08-25'), { day: 1, total: 8, left: 7 });
  assert.deepEqual(tripProgress(visits, '2026-09-01'), { day: 8, total: 8, left: 0 });
  assert.equal(tripProgress([city('2026-09-08', '2026-09-16')], TODAY), null);
  assert.equal(tripProgress([], TODAY), null);
});

test('число дней у прогресса и у tripDuration не может разойтись', () => {
  // Два дома одного числа: `total` виджета и `tripDuration().days` экрана трипа.
  // Пин обоих концов — расхождение таких чисел не видно ни одному гарду.
  for (const [s, e] of [['2026-08-25', '2026-09-01'], ['2026-08-27', '2026-08-27'], ['2026-12-28', '2027-01-04']]) {
    const visits = [city(s, e)];
    assert.equal(tripProgress(visits, s)?.total, tripDuration(null, visits).days || 1);
  }
});

test('currentCityVisit берёт transit-город, накрывающий сегодня', () => {
  const visits = [
    city('2026-08-24', '2026-08-24', 'start'),
    city('2026-08-25', '2026-08-28'),
    city('2026-08-28', '2026-09-01'),
  ];
  assert.equal(currentCityVisit(visits, TODAY)?.start_date, '2026-08-25');
  // Стартовый якорь городом не считается даже когда накрывает день.
  assert.equal(currentCityVisit([city('2026-08-27', '2026-08-27', 'start')], TODAY), null);
  assert.equal(currentCityVisit(visits, '2026-09-30'), null);
});

test('порядок активных: идущее (кончается раньше) → будущее (старт раньше) → без дат', () => {
  const trips = [
    { id: 'future-late', v: [city('2026-10-01', '2026-10-05')] },
    { id: 'undated', v: [] },
    { id: 'ongoing-late', v: [city('2026-08-20', '2026-09-10')] },
    { id: 'future-soon', v: [city('2026-09-08', '2026-09-16')] },
    { id: 'ongoing-soon', v: [city('2026-08-25', '2026-08-29')] },
  ];
  assert.deepEqual(
    sortActiveTrips(trips, (t) => t.v, TODAY).map((t) => t.id),
    ['ongoing-soon', 'ongoing-late', 'future-soon', 'future-late', 'undated'],
  );
});

test('виджет — голова того же массива, что рисует ленту', () => {
  // Свойство, ради которого правило одно: что первое в ленте, то и в виджете.
  const trips = [
    { id: 'a', v: [city('2026-09-08', '2026-09-16')] },
    { id: 'b', v: [city('2026-08-25', '2026-08-29')] },
  ];
  assert.equal(sortActiveTrips(trips, (t) => t.v, TODAY)[0].id, 'b');
});
