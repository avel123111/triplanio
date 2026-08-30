import { test } from 'node:test';
import assert from 'node:assert/strict';
import { dayMonth } from './dayMonth.js';

// TRIP-475 шаг 3: «день + короткий месяц» переехал с luxon на нативный `Intl`,
// и luxon ушёл из синхронного графа лендинга. Правка обязана быть НЕВИДИМОЙ —
// поэтому тест держит не «разумный вид», а ЭТАЛОНЫ, СНЯТЫЕ С LUXON ДО ПРАВКИ
// (`DateTime.fromISO(v, { zone }).setLocale(tag).toFormat('d MMM')`). Разойдись
// вывод — дата на публичной странице трипа поменяется молча, и увидит это
// пользователь, а не мы.
//
// В наборе намеренно: даты без времени и с временем, зона `utc` и настоящие
// зоны, границы месяца и года, и тот самый случай `2026-11-01` +
// `America/Los_Angeles`, на котором наивный перевод съезжал на сутки назад.
const GOLDEN = [
  ["ru-RU", "2026-08-05", null, "5 авг."],
  ["ru-RU", "2026-01-01", "utc", "1 янв."],
  ["ru-RU", "2026-02-28", null, "28 февр."],
  ["ru-RU", "2026-11-01", "America/Los_Angeles", "1 нояб."],
  ["ru-RU", "2026-05-15T22:00:00Z", "Asia/Tokyo", "16 мая"],
  ["ru-RU", "2026-12-31T23:30:00Z", "utc", "31 дек."],
  ["ru-RU", "2026-07-04T10:00:00+03:00", "utc", "4 июл."],
  ["ru-RU", "2026-03-09", "Europe/Madrid", "9 мар."],
  ["ru-RU", "2026-01-01T00:30:00Z", "Europe/Moscow", "1 янв."],
  ["ru-RU", "2026-06-30T23:00:00Z", "Australia/Sydney", "1 июл."],
  ["en-US", "2026-08-05", null, "5 Aug"],
  ["en-US", "2026-01-01", "utc", "1 Jan"],
  ["en-US", "2026-02-28", null, "28 Feb"],
  ["en-US", "2026-11-01", "America/Los_Angeles", "1 Nov"],
  ["en-US", "2026-05-15T22:00:00Z", "Asia/Tokyo", "16 May"],
  ["en-US", "2026-12-31T23:30:00Z", "utc", "31 Dec"],
  ["en-US", "2026-07-04T10:00:00+03:00", "utc", "4 Jul"],
  ["en-US", "2026-03-09", "Europe/Madrid", "9 Mar"],
  ["en-US", "2026-01-01T00:30:00Z", "Europe/Moscow", "1 Jan"],
  ["en-US", "2026-06-30T23:00:00Z", "Australia/Sydney", "1 Jul"],
  ["es-ES", "2026-08-05", null, "5 ago"],
  ["es-ES", "2026-01-01", "utc", "1 ene"],
  ["es-ES", "2026-02-28", null, "28 feb"],
  ["es-ES", "2026-11-01", "America/Los_Angeles", "1 nov"],
  ["es-ES", "2026-05-15T22:00:00Z", "Asia/Tokyo", "16 may"],
  ["es-ES", "2026-12-31T23:30:00Z", "utc", "31 dic"],
  ["es-ES", "2026-07-04T10:00:00+03:00", "utc", "4 jul"],
  ["es-ES", "2026-03-09", "Europe/Madrid", "9 mar"],
  ["es-ES", "2026-01-01T00:30:00Z", "Europe/Moscow", "1 ene"],
  ["es-ES", "2026-06-30T23:00:00Z", "Australia/Sydney", "1 jul"],
];

test('день+месяц: вывод совпадает с прежним luxon-выводом побуквенно', () => {
  for (const [tag, value, zone, expected] of GOLDEN) {
    assert.equal(
      dayMonth(value, zone ?? undefined, tag),
      expected,
      `${tag} · ${value} · зона ${zone ?? '(нет)'} — вывод разошёлся с эталоном luxon`,
    );
  }
});

test('пустое и мусорное значение дают пустую строку, а не «Invalid Date»', () => {
  for (const bad of [null, undefined, '', 'не-дата', '2026-13-45']) {
    assert.equal(dayMonth(bad, undefined, 'ru-RU'), '', `на входе ${JSON.stringify(bad)}`);
  }
});

test('незнакомая зона не роняет и не съедает дату (фолбэк на UTC)', () => {
  assert.equal(dayMonth('2026-08-05T12:00:00Z', 'Марс/Кратер', 'ru-RU'), '5 авг.');
});

test('дата без времени зону НЕ применяет — иначе съезжает на сутки', () => {
  // Полночь UTC в лос-анджелесской зоне это ещё предыдущий день; luxon печатал
  // 1 ноября, потому что трактовал дату как полночь В ЗОНЕ. Держим то же.
  assert.equal(dayMonth('2026-11-01', 'America/Los_Angeles', 'ru-RU'), '1 нояб.');
  assert.equal(dayMonth('2026-11-01', 'Australia/Sydney', 'ru-RU'), '1 нояб.');
});

test('время во входе зону применяет', () => {
  // 22:00 UTC 15 мая в Токио — уже 16-е. Этим дата-без-времени и отличается.
  assert.equal(dayMonth('2026-05-15T22:00:00Z', 'Asia/Tokyo', 'ru-RU'), '16 мая');
  assert.equal(dayMonth('2026-05-15T22:00:00Z', 'utc', 'ru-RU'), '15 мая');
});
