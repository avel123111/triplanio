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