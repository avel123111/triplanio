// Derive a trip's date range from its CityVisits (uses UTC ISO).
import { DateTime } from 'luxon';

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

// Разложить интервал до старта (мс) на плитки отсчёта {d, h, m}.
// Отрицательный/нулевой интервал (старт уже наступил) → нули: карточка отсчёта
// не должна показывать «-1 день», пока минутный тик не переключит героя.
export function countdownParts(diffMs) {
  const ms = Math.max(0, diffMs);
  return {
    d: Math.floor(ms / 864e5),
    h: Math.floor((ms % 864e5) / 36e5),
    m: Math.floor((ms % 36e5) / 6e4),
  };
}

export function latestEventDate(visits = []) {
  const { end } = computeTripRange(visits);
  return end ? DateTime.fromISO(end) : null;
}

export function isTripInPast(visits = []) {
  // Trip is "past" only if it has dates AND its overall end_date is strictly before today.
  // Trips with no dates at all are considered ACTIVE.
  if (!visits || visits.length === 0) return false;
  const { end } = computeTripRange(visits);
  if (!end) return false; // no dates known → active
  const now = new Date();
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  return new Date(end) < today;
}