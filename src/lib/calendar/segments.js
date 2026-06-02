// Helpers for the calendar lane bars (cities / hotels).
//
// Each calendar cell (a day) can host 1..N "segments" - short-lived membership
// of a single city or hotel that day. When there are 2-3 segments in the same
// cell, we split the cell into equal columns (no time-weighted slicing).

import { DateTime } from 'luxon';

// Stable color palette: a string key (city id / hotel id) maps to a fixed slot
// so the same city/hotel always gets the same color across the calendar.
//
// We keep palettes separate per kind so a city and a hotel in the same day
// don't accidentally collide on the same color.
const CITY_PALETTE = [
  'bg-blue-600 text-white',
  'bg-rose-500 text-white',
  'bg-emerald-600 text-white',
  'bg-amber-500 text-white',
  'bg-violet-600 text-white',
  'bg-cyan-600 text-white',
  'bg-orange-600 text-white',
  'bg-pink-600 text-white',
];

const HOTEL_PALETTE = [
  'bg-teal-500 text-white',
  'bg-fuchsia-500 text-white',
  'bg-lime-600 text-white',
  'bg-sky-500 text-white',
  'bg-indigo-500 text-white',
  'bg-yellow-500 text-slate-900',
];

function hashString(s) {
  let h = 0;
  for (let i = 0; i < s.length; i++) h = ((h << 5) - h + s.charCodeAt(i)) | 0;
  return Math.abs(h);
}

export function cityColor(key) {
  if (!key) return CITY_PALETTE[0];
  return CITY_PALETTE[hashString(String(key)) % CITY_PALETTE.length];
}

export function hotelColor(key) {
  if (!key) return HOTEL_PALETTE[0];
  return HOTEL_PALETTE[hashString(String(key)) % HOTEL_PALETTE.length];
}

// Given a list of "spans" { key, label, start (UTC ISO), end (UTC ISO), tz }
// and a target day (Luxon DateTime in local TZ), return the ordered list of
// segments occupying that day. Each entry: { key, label }. Segments are
// rendered as equal slices (50/50, 33/33/33...) per product spec.
//
// A span is included for the day if its [start, end] interval intersects
// the day's [00:00, 24:00) range (in the span's own TZ, then compared in UTC).
export function segmentsForDay(spans, day /* DateTime */) {
  const dayStart = day.startOf('day').toUTC();
  const dayEnd = day.endOf('day').toUTC();
  const out = [];
  for (const sp of spans) {
    const tz = sp.tz || 'UTC';
    const s = DateTime.fromISO(sp.start, { zone: 'utc' }).setZone(tz);
    const e = DateTime.fromISO(sp.end || sp.start, { zone: 'utc' }).setZone(tz);
    if (e.toUTC() < dayStart || s.toUTC() > dayEnd) continue;
    out.push({ key: sp.key, label: sp.label, startUtc: s.toUTC().toMillis() });
  }
  // Stable ordering by start time so two cells in the same day stay consistent.
  out.sort((a, b) => a.startUtc - b.startUtc);
  return out.map(({ key, label }) => ({ key, label }));
}