import { DateTime } from 'luxon';
import { parseNaive } from '@/lib/naive-time';

/**
 * The trip data model treats every stored ISO datetime as a NAIVE wall-clock
 * value. Timezones are intentionally ignored on both read and write:
 *
 *   - User types "24 May 13:00" in a form  → stored as "2026-05-24T13:00:00.000Z"
 *   - Stored "2026-05-24T13:00:00.000Z"    → displayed as "24 May 13:00"
 *
 * The `ianaTz` argument is kept on these helpers for backward compatibility
 * with existing call sites but is **ignored**. CityVisit.timezone still exists
 * in the DB (used for weather, geo helpers, etc.) but is NOT used for time
 * display anywhere on the trip timeline / dialogs.
 */

// Convert datetime-local string ("yyyy-MM-dd'T'HH:mm") → ISO with trailing Z,
// preserving wall-clock digits (no UTC offset math).
export function localToUtc(localDateTime, _ianaTz) {
  if (!localDateTime) return null;
  // Normalise to "yyyy-MM-ddTHH:mm:00.000Z" — strip any tz suffix the input
  // might already carry, default seconds/ms to zero.
  const stripped = localDateTime.replace(/(Z|[+-]\d{2}:?\d{2})$/i, '');
  // Accept "yyyy-MM-ddTHH:mm" or "yyyy-MM-ddTHH:mm:ss"
  const m = stripped.match(/^(\d{4}-\d{2}-\d{2})T(\d{2}):(\d{2})(?::(\d{2}))?/);
  if (!m) return null;
  const [, date, hh, mm, ss] = m;
  return `${date}T${hh}:${mm}:${ss || '00'}.000Z`;
}

// Convert stored ISO → datetime-local string ("yyyy-MM-dd'T'HH:mm"),
// reading the value as naive wall-clock (ignores any tz suffix).
export function utcToLocalInput(utcIso, _ianaTz) {
  const dt = parseNaive(utcIso);
  return dt ? dt.toFormat("yyyy-LL-dd'T'HH:mm") : '';
}

export function formatInTz(utcIso, _ianaTz, fmt = 'HH:mm') {
  const dt = parseNaive(utcIso);
  return dt ? dt.toFormat(fmt) : '';
}

export function formatDateInTz(utcIso, _ianaTz) {
  const dt = parseNaive(utcIso);
  return dt ? dt.toFormat('dd LLL yyyy') : '';
}

export function formatFullInTz(utcIso, _ianaTz) {
  const dt = parseNaive(utcIso);
  return dt ? dt.toFormat('dd LLL, HH:mm') : '';
}

export function dayKey(utcIso, _ianaTz) {
  const dt = parseNaive(utcIso);
  return dt ? dt.toFormat('yyyy-LL-dd') : '';
}

export function dayLabel(utcIso, _ianaTz) {
  const dt = parseNaive(utcIso);
  return dt ? dt.toFormat('cccc, dd LLLL yyyy') : '';
}

// Check overlap between two stored ranges (handles reversed start/end).
// Reads each ISO as naive wall-clock — same semantics as everywhere else.
export function rangesOverlap(aStart, aEnd, bStart, bEnd) {
  if (!aStart || !bStart) return false;
  const aS = parseNaive(aStart)?.toMillis() ?? 0;
  const aE = parseNaive(aEnd || aStart)?.toMillis() ?? aS;
  const bS = parseNaive(bStart)?.toMillis() ?? 0;
  const bE = parseNaive(bEnd || bStart)?.toMillis() ?? bS;
  const aLo = Math.min(aS, aE), aHi = Math.max(aS, aE);
  const bLo = Math.min(bS, bE), bHi = Math.max(bS, bE);
  return aLo < bHi && bLo < aHi;
}

export function diffHours(utcA, utcB) {
  const a = parseNaive(utcA)?.toMillis() ?? null;
  const b = parseNaive(utcB)?.toMillis() ?? null;
  if (a === null || b === null) return 0;
  return (b - a) / 3_600_000;
}