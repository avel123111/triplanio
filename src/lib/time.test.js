// Гейт правила «сколько длится плечо» (см. шапку durationMinutes в time.js).
// Run: npm test  (node --test)
//
// Правило чинили трижды и трижды теряли, потому что проверить его было нечем:
// ошибка не падает, не логируется и выглядит правдоподобным числом на экране.
// Здесь она падает.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { durationMinutes, formatMinutes, transferDuration } from './time.js';

// Подпись как в ru-локали (`trip.dur_h`/`trip.dur_m`/`trip.dur_hm`) — форматтер
// получает `t` аргументом, поэтому тест не тянет i18n.
const t = (k, v) => {
  if (k === 'trip.dur_h') return `${v.h}ч`;
  if (k === 'trip.dur_m') return `${v.m}м`;
  if (k === 'trip.dur_hm') return `${v.h}ч ${v.m}м`;
  return k;
};

const PORTO = 'Europe/Lisbon';
const MADRID = 'Europe/Madrid';

test('межпоясной перелёт: длительность считается по РЕАЛЬНОМУ времени, не по цифрам', () => {
  // Прод, трип b40704dd: Порту 16:05 (UTC+1) → Мадрид 18:15 (UTC+2). Панель
  // показывала 2 ч 10 мин — это вычитание настенных цифр с разных шкал.
  assert.equal(durationMinutes('2026-09-25T16:05:00.000Z', '2026-09-25T18:15:00.000Z', PORTO, MADRID), 70);
});

test('обратное направление: длительность РАСТЁТ, а не уменьшается', () => {
  // Мадрид 14:55 (UTC+2) → Лиссабон 15:15 (UTC+1). Наивно «20 минут» — рейса
  // такой длины не бывает, и именно так это выглядело в UI.
  assert.equal(durationMinutes('2026-09-19T14:55:00.000Z', '2026-09-19T15:15:00.000Z', MADRID, PORTO), 80);
});

test('нулевая настенная разность межпоясного рейса — это ЧАС, а не «показывать нечего»', () => {
  // Худший случай наивной арифметики: разность цифр = 0 → длительность просто
  // пропадала с экрана, хотя рейс длится час.
  assert.equal(durationMinutes('2026-09-19T10:00:00.000Z', '2026-09-19T10:00:00.000Z', MADRID, PORTO), 60);
});

test('один пояс на оба конца — обычная настенная разность', () => {
  assert.equal(durationMinutes('2026-09-15T14:55:00.000Z', '2026-09-15T17:05:00.000Z', 'Europe/Paris', MADRID), 130);
  assert.equal(durationMinutes('2026-09-22T14:09:00.000Z', '2026-09-22T16:48:00.000Z', PORTO, PORTO), 159);
});

test('смещение берётся НА ДАТУ рейса, а не константой пояса', () => {
  // Москва (+3 круглый год) → Лондон. Летом Лондон +1, зимой +0, поэтому одни и
  // те же настенные концы дают РАЗНУЮ реальную длительность.
  const dep = 'T09:00:00.000Z', arr = 'T11:00:00.000Z';
  const summer = durationMinutes(`2026-07-15${dep}`, `2026-07-15${arr}`, 'Europe/Moscow', 'Europe/London');
  const winter = durationMinutes(`2026-01-15${dep}`, `2026-01-15${arr}`, 'Europe/Moscow', 'Europe/London');
  assert.equal(summer, 240);
  assert.equal(winter, 300);
});

test('пояс известен только у одного конца — честная настенная разность, а не выдуманное смещение', () => {
  const naive = durationMinutes('2026-09-25T16:05:00.000Z', '2026-09-25T18:15:00.000Z');
  assert.equal(naive, 130);
  assert.equal(durationMinutes('2026-09-25T16:05:00.000Z', '2026-09-25T18:15:00.000Z', PORTO, null), naive);
  assert.equal(durationMinutes('2026-09-25T16:05:00.000Z', '2026-09-25T18:15:00.000Z', null, MADRID), naive);
});

test('мусорный пояс не роняет и не искажает — падаем в настенную разность', () => {
  assert.equal(durationMinutes('2026-09-25T16:05:00.000Z', '2026-09-25T18:15:00.000Z', PORTO, 'Europe/Atlantis'), 130);
});

test('нечего показывать: пустой вход, мусор, неположительная длительность', () => {
  assert.equal(durationMinutes(null, '2026-09-25T18:15:00.000Z', PORTO, MADRID), null);
  assert.equal(durationMinutes('2026-09-25T16:05:00.000Z', undefined, PORTO, MADRID), null);
  assert.equal(durationMinutes('не дата', '2026-09-25T18:15:00.000Z'), null);
  assert.equal(durationMinutes('2026-09-25T18:15:00.000Z', '2026-09-25T16:05:00.000Z'), null);
  assert.equal(durationMinutes('2026-09-25T16:05:00.000Z', '2026-09-25T16:05:00.000Z'), null);
});

test('вход формы (datetime-local, без суффикса пояса) читается так же', () => {
  // Карточка плеча в редакторе держит `startLocal`/`endLocal` в виде "…T16:05".
  assert.equal(durationMinutes('2026-09-25T16:05', '2026-09-25T18:15', PORTO, MADRID), 70);
});

test('подпись: часы, минуты, и ноль минут не дописывается', () => {
  assert.equal(formatMinutes(70, t), '1ч 10м');
  assert.equal(formatMinutes(120, t), '2ч');
  assert.equal(formatMinutes(45, t), '45м');
});

test('подписи нет, когда показывать нечего', () => {
  assert.equal(formatMinutes(null, t), null);
  assert.equal(formatMinutes(0, t), null);
  assert.equal(formatMinutes(-30, t), null);
});

test('дверь переезда сама достаёт пояса из его city_visit-концов', () => {
  const tr = { start_datetime: '2026-09-25T16:05:00.000Z', end_datetime: '2026-09-25T18:15:00.000Z' };
  assert.equal(transferDuration(tr, { timezone: PORTO }, { timezone: MADRID }, t), '1ч 10м');
});

test('дверь переезда без концов не выдумывает пояс', () => {
  const tr = { start_datetime: '2026-09-25T16:05:00.000Z', end_datetime: '2026-09-25T18:15:00.000Z' };
  assert.equal(transferDuration(tr, null, null, t), '2ч 10м');
  assert.equal(transferDuration(tr, { timezone: null }, { timezone: MADRID }, t), '2ч 10м');
});

test('дверь переезда терпит отсутствие самого переезда', () => {
  assert.equal(transferDuration(null, { timezone: PORTO }, { timezone: MADRID }, t), null);
  assert.equal(transferDuration({ start_datetime: '2026-09-25T16:05:00.000Z' }, null, null, t), null);
});
