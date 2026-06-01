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

// Start anchor always first, end anchor always last; transit ordered by
// (start_datetime, position). `position` is an auto-maintained tie-breaker
// (TRIP_EDIT_MODE_TZ §4a) that only disambiguates nodes sharing a day; it is
// kept consistent with chronology, never contradicts it. When position is
// absent (legacy/pre-backfill rows) we fall back to end_datetime so ordering
// is identical to the previous behaviour.
const posOf = (v) => (Number.isFinite(v?.position) ? v.position : null);
export function sortVisits(visits) {
  const rank = (v) => (v.kind === 'start' ? -1 : v.kind === 'end' ? 1 : 0);
  return [...visits].sort((a, b) => {
    const ra = rank(a), rb = rank(b);
    if (ra !== rb) return ra - rb;
    const sa = t(a.start_datetime) ?? 0, sb = t(b.start_datetime) ?? 0;
    if (sa !== sb) return sa - sb;
    // Equal start → explicit position tie-break first…
    const pa = posOf(a), pb = posOf(b);
    if (pa !== null && pb !== null && pa !== pb) return pa - pb;
    // …then the city that ends earlier (legacy fallback when position absent).
    const ea = t(a.end_datetime) ?? 0, eb = t(b.end_datetime) ?? 0;
    return ea - eb;
  });
}

// Recompute `position` 0..N so it stays consistent with chronology. On equal
// start_datetime the INCOMING array order wins (the on-screen tie order the
// user arranged). Returns new visit objects with `position` set. Pure — no DB.
// Used by the Edit Mode editor and by insert paths so position never drifts
// from dates (TRIP_EDIT_MODE_TZ §4a).
export function normalizePositions(visits) {
  const rank = (v) => (v.kind === 'start' ? -1 : v.kind === 'end' ? 1 : 0);
  return [...visits]
    .map((v, i) => ({ v, i }))
    .sort((A, B) => {
      const ra = rank(A.v), rb = rank(B.v);
      if (ra !== rb) return ra - rb;
      const sa = t(A.v.start_datetime) ?? 0, sb = t(B.v.start_datetime) ?? 0;
      if (sa !== sb) return sa - sb;
      return A.i - B.i; // preserve incoming order for an equal-start tie
    })
    .map((x, pos) => ({ ...x.v, position: pos }));
}

// =====================================================================
// STRUCTURED CONFLICT ENGINE — for the Edit Mode editor (TRIP_EDIT_MODE_TZ §5).
// Pure: operates on an in-memory draft, never touches the DB. Produces a sorted
// (errors first) list of structured issues so the UI can render the conflict
// panel AND gate Save (hard gate: any open issue blocks save).
// Day comparisons are done by CALENDAR DAY in each node's timezone (TZ §10.3).
// The legacy string helpers above (hotelWarnings/…/tripWarnings) stay for the
// current timeline; the two converge in Phase 5.
// =====================================================================
const dayInTz = (iso, tz) => (iso ? DateTime.fromISO(iso, { zone: 'utc' }).setZone(tz || 'UTC').startOf('day') : null);

// Same city = same external_city_id; fallback to name+country_code (TZ E2).
// Exported so the timeline's "no transfer" warning shares one identity rule
// with the editor's E1/E2 (single source of truth).
export const cityIdentity = (v) =>
  v?.external_city_id || `${(v?.city_name || '').trim().toLowerCase()}|${(v?.country_code || '').trim().toLowerCase()}`;

const activityTitle = (a) => a?.title || a?.name || 'активность';

/**
 * @param {{visits:[], hotels:[], activities:[], transfers:[]}} draft
 * @returns {Array<{level:'error'|'warn', code, message, cityId?, hotelId?, activityId?, transferId?, fromId?, toId?}>}
 */
export function computeTripValidation({ visits = [], hotels = [], activities = [], transfers = [] } = {}) {
  const issues = [];
  const push = (level, code, message, extra = {}) => issues.push({ level, code, message, ...extra });

  const ordered = sortVisits(visits);                 // (start, position) aware
  const byId = new Map(visits.map((v) => [v.id, v]));
  const orderIndex = new Map(ordered.map((v, i) => [v.id, i]));
  const isAnchor = (v) => v.kind === 'start' || v.kind === 'end';

  // ---- A. Nodes (dates) ----
  for (const v of ordered) {
    if (isAnchor(v)) continue;                         // anchors: dates null by design — skip A1/A2
    if (!v.start_datetime || !v.end_datetime) {
      push('error', 'A1', `У города «${v.city_name}» не заданы даты.`, { cityId: v.id });
      continue;
    }
    const s = dayInTz(v.start_datetime, v.timezone), e = dayInTz(v.end_datetime, v.timezone);
    if (s && e && e < s) push('error', 'A2', `У города «${v.city_name}» конец раньше начала.`, { cityId: v.id });
  }

  // A3. Adjacency between consecutive dated nodes: border day (gap 0/1) OK;
  // gap > 1 day → warning; overlap (gap < 0) → warning. Skip pairs touching anchors.
  for (let i = 0; i < ordered.length - 1; i++) {
    const a = ordered[i], b = ordered[i + 1];
    const aEnd = dayInTz(a.end_datetime, a.timezone), bStart = dayInTz(b.start_datetime, b.timezone);
    if (!aEnd || !bStart) continue;
    const gap = bStart.diff(aEnd, 'days').days;
    if (gap > 1) push('warn', 'A3-gap', `Разрыв больше дня между «${a.city_name}» и «${b.city_name}».`, { fromId: a.id, toId: b.id });
    else if (gap < 0) push('warn', 'A3-overlap', `«${a.city_name}» и «${b.city_name}» наслаиваются.`, { fromId: a.id, toId: b.id });
  }

  // ---- B. Hotels (out-of-bounds only — Pavel 2026-06-01) + orphan ----
  for (const h of hotels) {
    const v = h.city_visit_id ? byId.get(h.city_visit_id) : null;
    if (!v) { push('error', 'B3', `Бронь «${h.name || 'отель'}» без города.`, { hotelId: h.id }); continue; }
    const ci = dayInTz(h.check_in_datetime, v.timezone), co = dayInTz(h.check_out_datetime, v.timezone);
    const vs = dayInTz(v.start_datetime, v.timezone), ve = dayInTz(v.end_datetime, v.timezone);
    if (ci && vs && ci < vs) push('warn', 'B1', `Заезд в «${h.name}» раньше прибытия в ${v.city_name}.`, { hotelId: h.id, cityId: v.id });
    if (co && ve && co > ve) push('warn', 'B2', `Выезд из «${h.name}» позже выезда из ${v.city_name}.`, { hotelId: h.id, cityId: v.id });
  }

  // ---- C. Activities (out-of-bounds) + orphan ----
  for (const a of activities) {
    const v = a.city_visit_id ? byId.get(a.city_visit_id) : null;
    if (!v) { push('error', 'C3', `«${activityTitle(a)}» без города.`, { activityId: a.id }); continue; }
    const as = dayInTz(a.start_datetime, v.timezone), ae = dayInTz(a.end_datetime || a.start_datetime, v.timezone);
    const vs = dayInTz(v.start_datetime, v.timezone), ve = dayInTz(v.end_datetime, v.timezone);
    if (as && vs && as < vs) push('warn', 'C1', `«${activityTitle(a)}» начинается раньше прибытия в ${v.city_name}.`, { activityId: a.id, cityId: v.id });
    if (ae && ve && ae > ve) push('warn', 'C2', `«${activityTitle(a)}» заканчивается позже выезда из ${v.city_name}.`, { activityId: a.id, cityId: v.id });
  }

  // ---- D. Transfers ----
  for (const tr of transfers) {
    const f = tr.from_city_visit_id ? byId.get(tr.from_city_visit_id) : null;
    const to = tr.to_city_visit_id ? byId.get(tr.to_city_visit_id) : null;
    if (!f || !to) {
      push('error', 'D6', `Переезд ${tr.from_city_name || ''} → ${tr.to_city_name || ''} висит без города.`, { transferId: tr.id });
      continue;
    }
    // D1/D2: departure day must equal the from-city's last day.
    const dep = dayInTz(tr.start_datetime, f.timezone), fend = dayInTz(f.end_datetime, f.timezone);
    if (dep && fend && +dep !== +fend) {
      push('warn', dep > fend ? 'D1' : 'D2', `Вылет ${f.city_name} → ${to.city_name} не в день выезда из ${f.city_name}.`, { transferId: tr.id });
    }
    // D3/D4: arrival day must equal the to-city's first day.
    const arr = dayInTz(tr.end_datetime, to.timezone), tstart = dayInTz(to.start_datetime, to.timezone);
    if (arr && tstart && +arr !== +tstart) {
      push('warn', arr > tstart ? 'D4' : 'D3', `Прилёт ${f.city_name} → ${to.city_name} не в день въезда в ${to.city_name}.`, { transferId: tr.id });
    }
    // D5: ends must be strictly forward-adjacent in the (start, position) order
    // (covers non-adjacent AND back-in-time, since to must be exactly from+1).
    const fi = orderIndex.get(f.id), ti = orderIndex.get(to.id);
    if (fi != null && ti != null && ti !== fi + 1) {
      push('warn', 'D5', `Маршрут не сходится: ${f.city_name} → ${to.city_name} не соседние узлы.`, { transferId: tr.id });
    }
  }

  // ---- E. Trip-level sequence ----
  const pairCount = new Map();                          // "fromId>toId" → count
  for (const tr of transfers) {
    if (!tr.from_city_visit_id || !tr.to_city_visit_id) continue;
    const k = `${tr.from_city_visit_id}>${tr.to_city_visit_id}`;
    pairCount.set(k, (pairCount.get(k) || 0) + 1);
  }
  for (let i = 0; i < ordered.length - 1; i++) {
    const a = ordered[i], b = ordered[i + 1];
    const cnt = pairCount.get(`${a.id}>${b.id}`) || 0;
    const sameCity = cityIdentity(a) === cityIdentity(b);
    if (!sameCity && cnt === 0) push('warn', 'E1', `Нет переезда: ${a.city_name} → ${b.city_name}.`, { fromId: a.id, toId: b.id });   // E2: same-city consecutive → no E1
    if (cnt > 1) push('warn', 'E3', `Дубликат переезда ${a.city_name} → ${b.city_name} (${cnt}).`, { fromId: a.id, toId: b.id });
  }

  issues.sort((x, y) => (x.level === y.level ? 0 : x.level === 'error' ? -1 : 1));
  return issues;
}

// "10:30 (Europe/Rome)" formatter helper kept here to avoid widening lib/time.js
export function timeWithTz(utcIso, tz, fmt = 'HH:mm') {
  if (!utcIso) return '';
  return `${DateTime.fromISO(utcIso, { zone: 'utc' }).setZone(tz || 'UTC').toFormat(fmt)} (${tz || 'UTC'})`;
}