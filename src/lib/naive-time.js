/**
 * Naive datetime utilities for the trip timeline.
 *
 * The trip timeline treats every ISO datetime as a *naive local* timestamp —
 * it ignores any "Z" or timezone offset in the string and reads year/month/day/
 * hour/minute as wall-clock values. This is intentional: the timeline is the
 * one place in the app where the user reads dates as "what was typed in",
 * regardless of what timezone the city / event was stored with.
 *
 * Storage in the DB is unchanged (still UTC ISO). These helpers are used
 * ONLY by the timeline views.
 */
import { DateTime } from 'luxon';

/**
 * Parse an ISO string as a naive Luxon DateTime in UTC, ignoring any timezone
 * offset present in the string. "2026-06-04T14:30:00.000Z" → 2026-06-04 14:30.
 * Returns null for falsy / invalid input.
 */
export function parseNaive(iso) {
  if (!iso || typeof iso !== 'string') return null;
  // Strip the trailing "Z" or any explicit offset like "+02:00" / "-0500".
  const stripped = iso.replace(/(Z|[+-]\d{2}:?\d{2})$/i, '');
  const dt = DateTime.fromISO(stripped, { zone: 'utc' });
  return dt.isValid ? dt : null;
}

/** "yyyy-LL-dd" day key for grouping events into days. */
export function naiveDayKey(iso) {
  const dt = parseNaive(iso);
  return dt ? dt.toFormat('yyyy-LL-dd') : null;
}

/** Format a naive ISO using a Luxon format string. */
export function formatNaive(iso, fmt, locale) {
  const dt = parseNaive(iso);
  if (!dt) return '';
  return locale ? dt.setLocale(locale).toFormat(fmt) : dt.toFormat(fmt);
}

/** Milliseconds since epoch for the naive value — used for sorting. */
export function naiveMillis(iso) {
  const dt = parseNaive(iso);
  return dt ? dt.toMillis() : 0;
}