// Centralized non-blocking validation rules for the new data model.
// All functions return array of warning strings (never throw).

import { DateTime } from 'luxon';

const t = (iso) => (iso ? new Date(iso).getTime() : null);

/**
 * datetime-local inputs let the user type just a date (e.g. "2026-07-07")
 * without a time. The browser accepts that value, but downstream code
 * (localToUtc → entity save) silently drops it, so the user sees a "saved"
 * dialog with no actual change persisted.
 *
 * Returns true if the value is set BUT doesn't contain a time portion —
 * meaning Save should be blocked and an error shown.
 *
 * Empty values are NOT considered missing-time: an empty field is a separate
 * "required" concern handled by each form individually.
 */
export function isDateOnlyMissingTime(value) {
  if (!value || typeof value !== 'string') return false;
  // datetime-local values are "YYYY-MM-DDTHH:mm" — anything without the T
  // (or with T but no digits after it) means no time was entered.
  const m = value.match(/^\d{4}-\d{2}-\d{2}T(\d{2}):(\d{2})/);
  return !m;
}

export function hotelWarnings(hotel, visit, otherHotels = []) {
  const w = [];
  if (!hotel || !visit) return w;
  const tz = visit.timezone || 'UTC';
  const ci = hotel.check_in_datetime ? DateTime.fromISO(hotel.check_in_datetime, { zone: 'utc' }).setZone(tz) : null;
  const co = hotel.check_out_datetime ? DateTime.fromISO(hotel.check_out_datetime, { zone: 'utc' }).setZone(tz) : null;
  const vs = visit.start_datetime ? DateTime.fromISO(visit.start_datetime, { zone: 'utc' }).setZone(tz) : null;
  const ve = visit.end_datetime ? DateTime.fromISO(visit.end_datetime, { zone: 'utc' }).setZone(tz) : null;
  // Check-in must be on/after the visit start day (same day allowed)
  if (ci && vs && ci.startOf('day') < vs.startOf('day')) w.push('Check-in is before arrival in the city.');
  // Check-out must be on/before the visit end day (same day allowed)
  if (co && ve && co.startOf('day') > ve.startOf('day')) w.push('Check-out is after departure from the city.');
  const ciMs = hotel.check_in_datetime ? new Date(hotel.check_in_datetime).getTime() : null;
  const coMs = hotel.check_out_datetime ? new Date(hotel.check_out_datetime).getTime() : null;
  for (const h of otherHotels) {
    if (h.id === hotel.id) continue;
    const oCi = h.check_in_datetime ? new Date(h.check_in_datetime).getTime() : null;
    const oCo = h.check_out_datetime ? new Date(h.check_out_datetime).getTime() : null;
    if (ciMs !== null && coMs !== null && oCi !== null && oCo !== null && ciMs < oCo && oCi < coMs) {
      w.push(`Overlaps with hotel "${h.name}".`);
    }
  }
  return w;
}

export function activityWarnings(act, visit) {
  const w = [];
  if (!act || !visit) return w;
  const as = t(act.start_datetime);
  const ae = t(act.end_datetime);
  const vs = t(visit.start_datetime);
  const ve = t(visit.end_datetime);
  if (as !== null && vs !== null && as < vs) w.push('Activity starts before arrival in the city.');
  if (ae !== null && ve !== null && ae > ve) w.push('Activity ends after departure from the city.');
  return w;
}

export function transferWarnings(transfer, fromVisit, toVisit) {
  const w = [];
  if (!transfer || !fromVisit || !toVisit) return w;

  // Compare in the local timezone of each city, by calendar day,
  // so a same-day arrival (e.g. 11 Sep 10:00 → arrive in city that starts 11 Sep) is OK.
  const fromTz = fromVisit.timezone || 'UTC';
  const toTz = toVisit.timezone || 'UTC';

  const dep = transfer.start_datetime ? DateTime.fromISO(transfer.start_datetime, { zone: 'utc' }).setZone(fromTz) : null;
  const arr = transfer.end_datetime ? DateTime.fromISO(transfer.end_datetime, { zone: 'utc' }).setZone(toTz) : null;
  const fromEnd = fromVisit.end_datetime ? DateTime.fromISO(fromVisit.end_datetime, { zone: 'utc' }).setZone(fromTz) : null;
  const toStart = toVisit.start_datetime ? DateTime.fromISO(toVisit.start_datetime, { zone: 'utc' }).setZone(toTz) : null;

  // Departure must not be later than the last calendar day of the from-visit
  if (dep && fromEnd && dep.startOf('day') > fromEnd.startOf('day')) {
    w.push(`Departure is after leaving ${fromVisit.city_name}.`);
  }
  // Arrival must not be earlier than the first calendar day of the to-visit
  if (arr && toStart && arr.startOf('day') < toStart.startOf('day')) {
    w.push(`Arrival is before starting visit in ${toVisit.city_name}.`);
  }
  return w;
}

// Validations for a group of connecting transfers between the SAME two cities.
// Rules:
//  - max 3 segments
//  - no two transfers may overlap (start of one before end of another)
//  - last transfer's end must not be later than the start of the next city visit
export const MAX_TRANSFER_SEGMENTS = 3;

export function transferGroupWarnings(transfers, fromVisit, toVisit) {
  const w = [];
  if (!Array.isArray(transfers) || transfers.length === 0) return w;

  if (transfers.length > MAX_TRANSFER_SEGMENTS) {
    w.push(`Максимум ${MAX_TRANSFER_SEGMENTS} трансфера между двумя городами.`);
  }

  const sorted = [...transfers].sort((a, b) =>
    new Date(a.start_datetime || 0) - new Date(b.start_datetime || 0)
  );

  // Pairwise overlap check
  for (let i = 0; i < sorted.length - 1; i++) {
    const a = sorted[i];
    const b = sorted[i + 1];
    const aEnd = t(a.end_datetime);
    const bStart = t(b.start_datetime);
    if (aEnd !== null && bStart !== null && bStart < aEnd) {
      w.push(`Сегмент ${i + 2} начинается до окончания сегмента ${i + 1}.`);
    }
  }

  // Last segment's arrival must be ≤ toVisit start day
  if (toVisit?.start_datetime) {
    const toTz = toVisit.timezone || 'UTC';
    const toStart = DateTime.fromISO(toVisit.start_datetime, { zone: 'utc' }).setZone(toTz);
    const last = sorted[sorted.length - 1];
    if (last?.end_datetime) {
      const arr = DateTime.fromISO(last.end_datetime, { zone: 'utc' }).setZone(toTz);
      if (arr.startOf('day') > toStart.startOf('day')) {
        w.push(`Прибытие последнего сегмента позже даты въезда в ${toVisit.city_name}.`);
      }
    }
  }
  return w;
}

// For the full trip: find duplicate transfers and large gaps between events.
export function tripWarnings(visits, transfers, _hotels, _activities) {
  const w = [];
  const sortedVisits = sortVisits(visits);
  for (let i = 0; i < sortedVisits.length - 1; i++) {
    const a = sortedVisits[i], b = sortedVisits[i + 1];
    const between = transfers.filter(tr => tr.from_city_visit_id === a.id && tr.to_city_visit_id === b.id);
    if (between.length > MAX_TRANSFER_SEGMENTS) {
      w.push({ kind: 'duplicate_transfer', from: a, to: b, message: `Слишком много трансферов (${between.length}) между ${a.city_name} → ${b.city_name}.` });
    }
    // Group-level overlap / boundary warnings
    if (between.length > 1) {
      const groupWarns = transferGroupWarnings(between, a, b);
      for (const gw of groupWarns) {
        w.push({ kind: 'transfer_group', from: a, to: b, message: `${a.city_name} → ${b.city_name}: ${gw}` });
      }
    }
  }
  // Large gaps (>24h) — only when both dates exist and both visits are transit
  for (let i = 0; i < sortedVisits.length - 1; i++) {
    const a = sortedVisits[i], b = sortedVisits[i + 1];
    if (a.kind === 'start' || a.kind === 'end' || b.kind === 'start' || b.kind === 'end') continue;
    const aEnd = t(a.end_datetime);
    const bStart = t(b.start_datetime);
    if (aEnd === null || bStart === null) {
      if (a.kind === 'transit' && (a.start_datetime == null || a.end_datetime == null)) {
        w.push({ kind: 'missing_dates', visit: a, message: `У города ${a.city_name} не заданы даты.` });
      }
      continue;
    }
    const gapHours = (bStart - aEnd) / 3_600_000;
    if (gapHours > 24) {
      w.push({ kind: 'gap', from: a, to: b, message: `Gap of ${Math.round(gapHours)}h between ${a.city_name} and ${b.city_name}.` });
    }
  }
  return w;
}

// Start anchor always first, end anchor always last; transit sorted by start_datetime only.
export function sortVisits(visits) {
  const rank = (v) => (v.kind === 'start' ? -1 : v.kind === 'end' ? 1 : 0);
  return [...visits].sort((a, b) => {
    const ra = rank(a), rb = rank(b);
    if (ra !== rb) return ra - rb;
    const sa = t(a.start_datetime) ?? 0, sb = t(b.start_datetime) ?? 0;
    return sa - sb;
  });
}

// "10:30 (Europe/Rome)" formatter helper kept here to avoid widening lib/time.js
export function timeWithTz(utcIso, tz, fmt = 'HH:mm') {
  if (!utcIso) return '';
  return `${DateTime.fromISO(utcIso, { zone: 'utc' }).setZone(tz || 'UTC').toFormat(fmt)} (${tz || 'UTC'})`;
}