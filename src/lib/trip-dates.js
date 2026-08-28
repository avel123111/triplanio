// Derive a trip's date range from its CityVisits (uses UTC ISO).
import { DateTime } from 'luxon';
import { naiveDayKey } from './naive-time.js';
import { transitVisits } from './trip-cities.js';

export function computeTripRange(visits = []) {
  let minStart = null;
  let maxEnd = null;
  for (const v of visits) {
    const s = v.start_date ? new Date(v.start_date).getTime() : null;
    const e = v.end_date ? new Date(v.end_date).getTime() : s;
    if (s !== null && (minStart === null || s < minStart)) minStart = s;
    if (e !== null && (maxEnd === null || e > maxEnd)) maxEnd = e;
  }
  return {
    start: minStart ? new Date(minStart).toISOString() : null,
    end: maxEnd ? new Date(maxEnd).toISOString() : null,
  };
}

// THE date-range rule for the whole app (TRIP-230): a range whose two ends
// render identically is ONE date, never "12 июл – 12 июл". Screens differ in how
// they format a single date (with/without year, short/long month, own locale
// source), so `formatOne` stays theirs — only the joining rule lives here, and
// that is what every local copy of it got wrong.
// Collapsing compares the FORMATTED ends, not the raw ones: two timestamps
// within one day must collapse too, and only the rendered form knows that.
// `start`/`end` are whatever `formatOne` understands (ISO string, Date, …).
export function formatDateRange(start, end, formatOne, sep = ' – ') {
  const s = start ? formatOne(start) : '';
  const e = end ? formatOne(end) : '';
  if (!s || !e) return s || e || '';
  return s === e ? s : `${s}${sep}${e}`;
}

export function formatTripRange(visits = [], noDatesLabel = 'No dates yet') {
  const { start, end } = computeTripRange(visits);
  if (!start) return noDatesLabel;
  const s = DateTime.fromISO(start);
  const e = end ? DateTime.fromISO(end) : s;
  if (s.hasSame(e, 'day')) return s.toFormat('d MMM yyyy');
  if (s.hasSame(e, 'year')) return `${s.toFormat('d MMM')} – ${e.toFormat('d MMM yyyy')}`;
  return `${s.toFormat('d MMM yyyy')} – ${e.toFormat('d MMM yyyy')}`;
}

export function latestEventDate(visits = []) {
  const { end } = computeTripRange(visits);
  return end ? DateTime.fromISO(end) : null;
}

// ─── Где трип относительно СЕГОДНЯ ──────────────────────────────────────────
//
// ★ ЕДИНСТВЕННОЕ правило. До TRIP-4xx их было два и они расходились: список
// партиционировался `isTripInPast()`, а виджет «ближайшая поездка» делал свой
// проход с условием `startMs <= now`. Пока вкладки «Активные»/«Прошедшие» были
// разнесены, расхождение не бросалось в глаза; на одной странице оно видно
// сразу, поэтому предикат ровно один, а `isTripInPast` — его частный случай.
//
// ★ СРАВНИВАЕМ ДНИ, А НЕ МОМЕНТЫ. `city_visits.start_date/end_date` — колонки
// типа `date`: приезжают как «2026-09-08» и парсятся как UTC-ПОЛНОЧЬ. Прежний
// `isTripInPast` брал `today` из ЛОКАЛЬНЫХ Y/M/D и сравнивал его с этим
// UTC-моментом — в отрицательных таймзонах (вся Америка) «2026-08-26» читалось
// как 25-е 20:00 по местному и трип уезжал в «прошедшие» НА ДЕНЬ РАНЬШЕ срока.
// Поэтому обе стороны приводятся к календарному ключу «yyyy-LL-dd» (он же
// сравнивается лексикографически) — у дня нет часового пояса, и ловушки нет по
// построению.

/** Сегодняшний календарный день пользователя ключом «yyyy-LL-dd». */
export function todayKey() {
  return DateTime.now().toFormat('yyyy-LL-dd');
}

/**
 * Фаза трипа: 'past' | 'ongoing' | 'upcoming' | 'undated'.
 * Трип без дат — НЕ прошедший (он в активной ленте, как и было).
 * @param {any[]} visits
 * @param {string} [today] календарный ключ «сегодня» (для тестов и одного
 *   общего «сегодня» на весь рендер списка)
 * @returns {'past'|'ongoing'|'upcoming'|'undated'}
 */
export function tripPhase(visits = [], today = todayKey()) {
  const { start, end } = computeTripRange(visits);
  if (!start) return 'undated';
  // `computeTripRange` уже подставила start вместо отсутствующего end, так что
  // односторонних диапазонов здесь не бывает.
  const s = naiveDayKey(start);
  const e = naiveDayKey(end || start);
  if (!s || !e) return 'undated';
  if (e < today) return 'past';
  if (s > today) return 'upcoming';
  return 'ongoing';
}

export function isTripInPast(visits = [], today = todayKey()) {
  return tripPhase(visits, today) === 'past';
}

/**
 * Прогресс идущего трипа для виджета: «день {day} из {total}, осталось {left}».
 * Для НЕ идущего — null (у будущего дня нет, у прошедшего он не нужен).
 *
 * `total` = календарные дни включительно (25 авг – 1 сен → 8). Это то же число,
 * что отдаёт `tripDuration(null, visits).days` из `trip-stats.js` (nights + 1);
 * оба конца пиньте тестом — второй источник числа дней завести здесь легче
 * всего, а расходятся такие числа молча.
 * @returns {{ day: number, total: number, left: number } | null}
 */
export function tripProgress(visits = [], today = todayKey()) {
  if (tripPhase(visits, today) !== 'ongoing') return null;
  const { start, end } = computeTripRange(visits);
  const s = DateTime.fromISO(/** @type {string} */ (naiveDayKey(start)));
  const e = DateTime.fromISO(/** @type {string} */ (naiveDayKey(end || start)));
  const t = DateTime.fromISO(today);
  const total = Math.round(e.diff(s, 'days').days) + 1;
  const day = Math.round(t.diff(s, 'days').days) + 1;
  return { day, total, left: total - day };
}

/**
 * Визит, накрывающий сегодняшний день, — «сейчас {город}» в виджете.
 * Только transit-визиты: старт/финиш/waypoint городами не считаются нигде в
 * приложении (правило `trip-cities.js`), и здесь тоже.
 */
export function currentCityVisit(visits = [], today = todayKey()) {
  for (const v of transitVisits(visits)) {
    const s = v.start_date ? naiveDayKey(v.start_date) : null;
    if (!s) continue;
    const e = naiveDayKey(v.end_date || v.start_date);
    if (s <= today && today <= /** @type {string} */ (e)) return v;
  }
  return null;
}

/**
 * Порядок АКТИВНОЙ ленты — и он же решает, какой трип попадёт в виджет:
 * виджет берёт голову этого массива, своего отбора у него нет (два отбора и
 * были причиной расхождения выше).
 *
 *   1. идущие      — кончается раньше (он раньше всех потребует действий и
 *                    раньше всех перестанет быть активным);
 *   2. будущие     — начинается раньше;
 *   3. без дат     — в конце, порядком вызывателя (у него created_at desc).
 *
 * Сортировка СТАБИЛЬНАЯ (Array.prototype.sort в ES2019+), поэтому равные ключи
 * сохраняют порядок входа.
 * @template T
 * @param {T[]} trips
 * @param {(t: T) => any[]} getVisits
 * @param {string} [today]
 * @returns {T[]}
 */
export function sortActiveTrips(trips = [], getVisits, today = todayKey()) {
  const RANK = { ongoing: 0, upcoming: 1, undated: 2, past: 3 };
  const keyed = trips.map((tr) => {
    const visits = getVisits(tr) || [];
    const phase = tripPhase(visits, today);
    const { start, end } = computeTripRange(visits);
    return { tr, rank: RANK[phase], when: phase === 'ongoing' ? (end || '') : (start || '') };
  });
  keyed.sort((a, b) => (a.rank - b.rank) || (a.when < b.when ? -1 : a.when > b.when ? 1 : 0));
  return keyed.map((k) => k.tr);
}