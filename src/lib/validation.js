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
 * Returns true if the value is set BUT doesn't contain a time portion -  * meaning Save should be blocked and an error shown.
 *
 * Empty values are NOT considered missing-time: an empty field is a separate
 * "required" concern handled by each form individually.
 */
export function isDateOnlyMissingTime(value) {
  if (!value || typeof value !== 'string') return false;
  // datetime-local values are "YYYY-MM-DDTHH:mm" - anything without the T
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
  // Large gaps (>24h) - only when both dates exist and both visits are transit
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
// user arranged). Returns new visit objects with `position` set. Pure - no DB.
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
// STRUCTURED CONFLICT ENGINE - for the Edit Mode editor (TRIP_EDIT_MODE_TZ §5).
// Pure: operates on an in-memory draft, never touches the DB. Produces a sorted
// (errors first) list of structured issues so the UI can render the conflict
// panel AND gate Save (hard gate: any open issue blocks save).
// Day comparisons are done by CALENDAR DAY in each node's timezone (TZ §10.3).
// The legacy string helpers above (hotelWarnings/…/tripWarnings) stay for the
// current timeline; the two converge in Phase 5.
// =====================================================================
const dayInTz = (iso, tz) => (iso ? DateTime.fromISO(iso, { zone: 'utc' }).setZone(tz || 'UTC').startOf('day') : null);
// Calendar day (YYYY-MM-DD) in a node's tz, as a plain date. Use this for
// CROSS-node day gaps (A3): two nodes may have different timezones, and diffing
// their tz-local startOf('day') would leak the offset and report a phantom
// sub-day overlap. Comparing plain ISO dates parsed in one zone gives an exact
// integer day gap.
const calDay = (iso, tz) => (iso ? DateTime.fromISO(iso, { zone: 'utc' }).setZone(tz || 'UTC').toISODate() : null);
const dayGap = (fromIso, fromTz, toIso, toTz) => {
  const a = calDay(fromIso, fromTz), b = calDay(toIso, toTz);
  if (!a || !b) return null;
  return Math.round(DateTime.fromISO(b, { zone: 'utc' }).diff(DateTime.fromISO(a, { zone: 'utc' }), 'days').days);
};

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
    if (isAnchor(v)) continue;                         // anchors: dates null by design - skip A1/A2
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
    if (!a.end_datetime || !b.start_datetime) continue;
    const gap = dayGap(a.end_datetime, a.timezone, b.start_datetime, b.timezone); // integer calendar-day gap
    if (gap == null) continue;
    if (gap > 1) push('warn', 'A3-gap', `Разрыв больше дня между «${a.city_name}» и «${b.city_name}».`, { fromId: a.id, toId: b.id });
    else if (gap < 0) push('warn', 'A3-overlap', `«${a.city_name}» и «${b.city_name}» наслаиваются.`, { fromId: a.id, toId: b.id });
    // gap === 0 (стыковка) и gap === 1 (соседние дни / ночной перелёт) - OK
  }

  // ---- B. Hotels (out-of-bounds only - Pavel 2026-06-01) + orphan ----
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
  // Strict per-transfer hierarchy: emit AT MOST ONE issue per transfer, by
  // root-cause priority, so a single mistake doesn't fan out into 3+ warnings.
  //   D6 (dangling) → D5 (not adjacent) → D2 (date mismatch).
  // Date checks are SUPPRESSED while the transfer is structurally broken (no
  // city / not adjacent) - the "expected" days are undefined then. Once the
  // structural issue is fixed, the date issue (if any) surfaces next.
  for (const tr of transfers) {
    const f = tr.from_city_visit_id ? byId.get(tr.from_city_visit_id) : null;
    const to = tr.to_city_visit_id ? byId.get(tr.to_city_visit_id) : null;
    if (!f || !to) {
      push('error', 'D6', `Переезд ${tr.from_city_name || ''} → ${tr.to_city_name || ''} висит без города.`, { transferId: tr.id });
      continue;
    }
    // D5: ends must be strictly forward-adjacent in the (start, position) order
    // (covers non-adjacent AND back-in-time, since to must be exactly from+1).
    const fi = orderIndex.get(f.id), ti = orderIndex.get(to.id);
    if (fi != null && ti != null && ti !== fi + 1) {
      push('warn', 'D5', `Маршрут не сходится: ${f.city_name} → ${to.city_name} не соседние узлы.`, { transferId: tr.id });
      continue; // structural - date alignment is meaningless until adjacency is fixed
    }
    // D2: departure must be on the from-city checkout day AND arrival on the
    // to-city check-in day. Both facets merged into ONE warning naming whichever
    // end(s) don't line up.
    const dep = dayInTz(tr.start_datetime, f.timezone), fend = dayInTz(f.end_datetime, f.timezone);
    const arr = dayInTz(tr.end_datetime, to.timezone), tstart = dayInTz(to.start_datetime, to.timezone);
    const depOff = dep && fend && +dep !== +fend;
    const arrOff = arr && tstart && +arr !== +tstart;
    if (depOff || arrOff) {
      const msg = (depOff && arrOff)
        ? `Даты переезда ${f.city_name} → ${to.city_name} не совпадают: вылет не в день выезда из ${f.city_name}, прилёт не в день въезда в ${to.city_name}.`
        : depOff
          ? `Вылет ${f.city_name} → ${to.city_name} не в день выезда из ${f.city_name}.`
          : `Прилёт ${f.city_name} → ${to.city_name} не в день въезда в ${to.city_name}.`;
      push('warn', 'D2', msg, { transferId: tr.id });
    }
  }

  // ---- E. Trip-level sequence ----
  const pairCount = new Map();                          // "fromId>toId" → count
  for (const tr of transfers) {
    if (!tr.from_city_visit_id || !tr.to_city_visit_id) continue;
    const k = `${tr.from_city_visit_id}>${tr.to_city_visit_id}`;
    pairCount.set(k, (pairCount.get(k) || 0) + 1);
  }
  // NB: E1 («нет переезда между соседями») НЕ конфликт в Edit Mode (решение Pavel) -   // отсутствие переезда показывается коннектором «+ Добавить переезд» в сетке и
  // плашкой в таймлайне, но НЕ блокирует сохранение. Здесь оставлен только E3 (дубликат).
  for (let i = 0; i < ordered.length - 1; i++) {
    const a = ordered[i], b = ordered[i + 1];
    const cnt = pairCount.get(`${a.id}>${b.id}`) || 0;
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

// =====================================================================
// UNIFIED VALIDATION ENGINE (Ф1) - single source of truth for ALL forms.
// PURE: no DB, no UI, no i18n text. Each rule returns an Issue carrying a
// stable CODE; the UI resolves the text via t('validation.' + code, values).
//
//   Issue = {
//     level: 'error' | 'warning',   // error blocks save, warning does not
//     code,                         // e.g. 'HOTEL_CHECKIN_OOB'
//     scope: 'field' | 'entity' | 'structure',
//     field?,                       // canonical token for inline highlight
//     entityKind?, entityId?,       // single-entity reference (Edit Mode)
//     fromId?, toId?,               // paired structure issue
//     values?,                      // interpolation params for t()
//   }
//
// Dates are UTC ISO strings (or null); timezone comes from ctx. The modal
// adapter converts its local form fields to UTC ISO (incomplete -> null) before
// calling, so "date without time" collapses into a clean *_REQUIRED.
// Spec: VALIDATION_RULES_2026-06-03.md. computeTripValidation/*Warnings above
// stay until the UI is migrated (Ф2-Ф5), then are removed.
// =====================================================================

export const TRANSFER_DAY_TOLERANCE = 1; // +/-1 calendar day (red-eye / 00:20 flights)

const isBlank = (s) => s == null || String(s).trim() === '';
const _ms = (iso) => (iso ? new Date(iso).getTime() : null);
// Integer calendar-day difference day(b) - day(a), each in its own tz. null if missing.
const dayDiff = (isoA, tzA, isoB, tzB) => dayGap(isoA, tzA, isoB, tzB);

const mk = (level, code, scope, extra = {}) => ({ level, code, scope, ...extra });

// ---- per-entity validators (L1 field + L2 entity-in-context) ----

function validateHotel(d = {}, ctx = {}) {
  const out = [];
  const visit = ctx.visit || null;
  const ref = { entityKind: 'hotel', entityId: d.id, values: { city: visit?.city_name } };
  if (isBlank(d.name)) out.push(mk('error', 'HOTEL_NAME_REQUIRED', 'field', { field: 'name', ...ref }));
  if (!d.checkIn) out.push(mk('error', 'HOTEL_CHECKIN_REQUIRED', 'field', { field: 'checkIn', ...ref }));
  if (!d.checkOut) out.push(mk('error', 'HOTEL_CHECKOUT_REQUIRED', 'field', { field: 'checkOut', ...ref }));
  if (d.checkIn && d.checkOut && _ms(d.checkOut) <= _ms(d.checkIn)) {
    out.push(mk('error', 'HOTEL_ORDER', 'field', { field: 'checkOut', ...ref }));
  }
  if (visit) {
    const tz = visit.timezone;
    const ci = dayInTz(d.checkIn, tz), co = dayInTz(d.checkOut, tz);
    const vs = dayInTz(visit.start_datetime, tz), ve = dayInTz(visit.end_datetime, tz);
    if (ci && vs && ci < vs) out.push(mk('error', 'HOTEL_CHECKIN_OOB', 'entity', { field: 'checkIn', ...ref }));
    if (co && ve && co > ve) out.push(mk('error', 'HOTEL_CHECKOUT_OOB', 'entity', { field: 'checkOut', ...ref }));
  }
  return out;
}

function validateActivity(d = {}, ctx = {}) {
  const out = [];
  const visit = ctx.visit || null;
  const ref = { entityKind: 'activity', entityId: d.id, values: { city: visit?.city_name, title: d.title } };
  if (isBlank(d.title)) out.push(mk('error', 'ACT_TITLE_REQUIRED', 'field', { field: 'title', ...ref }));
  if (!d.start) out.push(mk('error', 'ACT_START_REQUIRED', 'field', { field: 'start', ...ref }));
  if (!d.end) out.push(mk('error', 'ACT_END_REQUIRED', 'field', { field: 'end', ...ref }));
  if (d.start && d.end && _ms(d.end) <= _ms(d.start)) {
    out.push(mk('error', 'ACT_ORDER', 'field', { field: 'end', ...ref }));
  }
  if (visit) {
    const tz = visit.timezone;
    const as = dayInTz(d.start, tz), ae = dayInTz(d.end, tz);
    const vs = dayInTz(visit.start_datetime, tz), ve = dayInTz(visit.end_datetime, tz);
    if (as && vs && as < vs) out.push(mk('error', 'ACT_START_OOB', 'entity', { field: 'start', ...ref }));
    if (ae && ve && ae > ve) out.push(mk('error', 'ACT_END_OOB', 'entity', { field: 'end', ...ref }));
  }
  return out;
}

function validateTransferSingle(d = {}, ctx = {}) {
  const out = [];
  const from = ctx.fromVisit || null, to = ctx.toVisit || null;
  const ref = { entityKind: 'transfer', entityId: d.id, values: { from: from?.city_name, to: to?.city_name } };
  if (!from || !to) { out.push(mk('error', 'TR_NO_CITY', 'structure', ref)); return out; }
  if (!d.start) out.push(mk('error', 'TR_DEP_REQUIRED', 'field', { field: 'start', ...ref }));
  if (!d.end) out.push(mk('error', 'TR_ARR_REQUIRED', 'field', { field: 'end', ...ref }));
  if (d.start && d.end && _ms(d.end) <= _ms(d.start)) {
    out.push(mk('error', 'TR_ORDER', 'field', { field: 'end', ...ref }));
  }
  const depGap = dayDiff(from.end_datetime, from.timezone, d.start, from.timezone);
  if (depGap != null && Math.abs(depGap) > TRANSFER_DAY_TOLERANCE) {
    out.push(mk('error', 'TR_DEP_DAY', 'entity', { field: 'start', ...ref }));
  }
  const arrGap = dayDiff(to.start_datetime, to.timezone, d.end, to.timezone);
  if (arrGap != null && Math.abs(arrGap) > TRANSFER_DAY_TOLERANCE) {
    out.push(mk('error', 'TR_ARR_DAY', 'entity', { field: 'end', ...ref }));
  }
  return out;
}

function validateTransferLayover(d = {}) {
  const out = [];
  const segs = Array.isArray(d.segments) ? d.segments : [];
  const ref = { entityKind: 'transfer', entityId: d.id };
  if (segs.length < 2) { out.push(mk('error', 'SEG_MIN', 'entity', ref)); return out; }
  let prevArr = null;
  segs.forEach((s, i) => {
    const f = `seg${i}`;
    if (!s.start) out.push(mk('error', 'SEG_DEP_REQUIRED', 'field', { field: `${f}.start`, ...ref }));
    if (!s.end) out.push(mk('error', 'SEG_ARR_REQUIRED', 'field', { field: `${f}.end`, ...ref }));
    if (s.start && s.end && _ms(s.end) <= _ms(s.start)) out.push(mk('error', 'SEG_ORDER', 'field', { field: `${f}.end`, ...ref }));
    if (prevArr != null && s.start && _ms(s.start) < prevArr) out.push(mk('error', 'SEG_BACKSTEP', 'field', { field: `${f}.start`, ...ref }));
    if (s.end) prevArr = _ms(s.end);
    if (i < segs.length - 1 && isBlank(s.toCity?.city_name)) out.push(mk('error', 'SEG_CITY_REQUIRED', 'field', { field: `${f}.toCity`, ...ref }));
  });
  return out;
}

function validateService(d = {}, ctx = {}) {
  const out = [];
  const ref = { entityKind: 'service', entityId: d.id };
  if (isBlank(d.name)) out.push(mk('error', 'SVC_NAME_REQUIRED', 'field', { field: 'name', ...ref }));
  if (!d.isEdit && isBlank(d.pickupAddress)) out.push(mk('error', 'SVC_PICKUP_ADDR_REQUIRED', 'field', { field: 'pickupAddress', ...ref }));
  if (!d.pickup) out.push(mk('error', 'SVC_PICKUP_REQUIRED', 'field', { field: 'pickup', ...ref }));
  if (!d.dropoff) out.push(mk('error', 'SVC_DROPOFF_REQUIRED', 'field', { field: 'dropoff', ...ref }));
  if (d.pickup && d.dropoff && _ms(d.dropoff) <= _ms(d.pickup)) out.push(mk('error', 'SVC_ORDER', 'field', { field: 'dropoff', ...ref }));
  const trip = ctx.trip || null;
  if (trip?.start_date && trip?.end_date && d.pickup && d.dropoff) {
    const ps = String(d.pickup).slice(0, 10), de = String(d.dropoff).slice(0, 10);
    if (ps < trip.start_date || de > trip.end_date) out.push(mk('warning', 'SVC_OUT_OF_TRIP', 'entity', { field: 'pickup', ...ref }));
  }
  return out;
}

function validateCity(d = {}) {
  const out = [];
  if (d.kind === 'start' || d.kind === 'end') return out; // anchors: dates null by design
  const ref = { entityKind: 'city', entityId: d.id, values: { city: d.city_name } };
  if (!d.start_datetime || !d.end_datetime) { out.push(mk('error', 'CITY_DATES_REQUIRED', 'field', { field: 'start', ...ref })); return out; }
  const s = dayInTz(d.start_datetime, d.timezone), e = dayInTz(d.end_datetime, d.timezone);
  if (s && e && e < s) out.push(mk('error', 'CITY_ORDER', 'field', { field: 'end', ...ref }));
  return out;
}

function validateTripMeta(d = {}) {
  const out = [];
  if (isBlank(d.title)) out.push(mk('error', 'TRIP_TITLE_REQUIRED', 'field', { field: 'title' }));
  if (isBlank(d.startDate)) out.push(mk('error', 'TRIP_START_REQUIRED', 'field', { field: 'startDate' }));
  const cities = Array.isArray(d.cities) ? d.cities : [];
  if (cities.length === 0) out.push(mk('error', 'TRIP_NO_CITIES', 'structure', {}));
  cities.forEach((c, i) => {
    if (!isBlank(c.city_name) && c.latitude == null) out.push(mk('error', 'TRIP_CITY_UNRESOLVED', 'field', { field: `city.${i}`, values: { city: c.city_name } }));
  });
  return out;
}

// ---- Non-structural forms (budget): L1 field rules only ----

function validateExpense(d = {}) {
  const out = [];
  const ref = { entityKind: 'expense', entityId: d.id };
  if (isBlank(d.title)) out.push(mk('error', 'EXP_TITLE_REQUIRED', 'field', { field: 'title', ...ref }));
  const amt = Number(d.amount);
  if (isBlank(d.amount) || !Number.isFinite(amt) || amt <= 0) out.push(mk('error', 'EXP_AMOUNT_REQUIRED', 'field', { field: 'amount', ...ref }));
  if (isBlank(d.categoryId)) out.push(mk('error', 'EXP_CATEGORY_REQUIRED', 'field', { field: 'categoryId', ...ref }));
  return out;
}

function validateCategory(d = {}) {
  const out = [];
  if (isBlank(d.name)) out.push(mk('error', 'CAT_NAME_REQUIRED', 'field', { field: 'name', entityKind: 'category', entityId: d.id }));
  return out;
}

// d.rates: { [code]: rawString }. Only a NON-EMPTY invalid input is an error
// (empty = "use auto rate"). Missing-rate hints stay in the dialog (warning).
function validateFx(d = {}) {
  const out = [];
  const rates = d.rates || {};
  for (const code of Object.keys(rates)) {
    const raw = rates[code];
    if (raw === '' || raw == null) continue;
    const n = Number(raw);
    if (!Number.isFinite(n) || n <= 0) out.push(mk('error', 'FX_RATE_INVALID', 'field', { field: `rate.${code}`, values: { code } }));
  }
  return out;
}

// Facade for the MODAL: validate ONE entity (L1 + L2).
export function validateEntity(kind, draft = {}, ctx = {}) {
  switch (kind) {
    case 'hotel': return validateHotel(draft, ctx);
    case 'activity': return validateActivity(draft, ctx);
    case 'transfer': return draft.hasLayovers ? validateTransferLayover(draft) : validateTransferSingle(draft, ctx);
    case 'service': return validateService(draft, ctx);
    case 'city': return validateCity(draft);
    case 'trip': return validateTripMeta(draft);
    case 'expense': return validateExpense(draft);
    case 'category': return validateCategory(draft);
    case 'fx': return validateFx(draft);
    default: return [];
  }
}

// Facade for EDIT MODE / timeline (L3): whole trip. Reuses validateEntity per
// entity + adds cross-entity structure rules. Replaces computeTripValidation
// at Ф2; kept side-by-side until the UI is migrated.
export function validateTrip({ visits = [], hotels = [], activities = [], transfers = [] } = {}) {
  const issues = [];
  const ordered = sortVisits(visits);
  const byId = new Map(visits.map((v) => [v.id, v]));
  const orderIndex = new Map(ordered.map((v, i) => [v.id, i]));

  // A. city nodes (required / order)
  for (const v of ordered) issues.push(...validateCity(v));

  // A3. adjacency between consecutive dated nodes (cross-entity, paired)
  for (let i = 0; i < ordered.length - 1; i++) {
    const a = ordered[i], b = ordered[i + 1];
    if (!a.end_datetime || !b.start_datetime) continue;
    const gap = dayGap(a.end_datetime, a.timezone, b.start_datetime, b.timezone);
    if (gap == null) continue;
    if (gap > 1) issues.push(mk('warning', 'CITY_GAP', 'structure', { fromId: a.id, toId: b.id, values: { a: a.city_name, b: b.city_name } }));
    else if (gap < -1) issues.push(mk('error', 'CITY_OVERLAP', 'structure', { fromId: a.id, toId: b.id, values: { a: a.city_name, b: b.city_name } }));
    // gap in {-1, 0, 1} OK (1-day overlap allowed, border day, night transfer)
  }

  // B/C. hotels & activities (orphan + in-context)
  for (const h of hotels) {
    const v = h.city_visit_id ? byId.get(h.city_visit_id) : null;
    if (!v) { issues.push(mk('error', 'HOTEL_NO_CITY', 'structure', { entityKind: 'hotel', entityId: h.id, values: { name: h.name } })); continue; }
    issues.push(...validateHotel({ id: h.id, name: h.name, checkIn: h.check_in_datetime, checkOut: h.check_out_datetime }, { visit: v }));
  }
  for (const a of activities) {
    const v = a.city_visit_id ? byId.get(a.city_visit_id) : null;
    if (!v) { issues.push(mk('error', 'ACT_NO_CITY', 'structure', { entityKind: 'activity', entityId: a.id, values: { title: a.title || a.name } })); continue; }
    issues.push(...validateActivity({ id: a.id, title: a.title || a.name, start: a.start_datetime, end: a.end_datetime || a.start_datetime }, { visit: v }));
  }

  // D. transfers (in-context + structural adjacency)
  const pairCount = new Map();
  for (const tr of transfers) {
    const f = tr.from_city_visit_id ? byId.get(tr.from_city_visit_id) : null;
    const to = tr.to_city_visit_id ? byId.get(tr.to_city_visit_id) : null;
    issues.push(...validateTransferSingle({ id: tr.id, start: tr.start_datetime, end: tr.end_datetime }, { fromVisit: f, toVisit: to }));
    if (f && to) {
      const fi = orderIndex.get(f.id), ti = orderIndex.get(to.id);
      if (fi != null && ti != null && ti !== fi + 1) {
        issues.push(mk('error', 'TR_NOT_ADJACENT', 'structure', { entityKind: 'transfer', entityId: tr.id, values: { from: f.city_name, to: to.city_name } }));
      }
      const k = `${f.id}>${to.id}`;
      pairCount.set(k, (pairCount.get(k) || 0) + 1);
    }
  }

  // E. duplicate transfers (warning)
  for (let i = 0; i < ordered.length - 1; i++) {
    const a = ordered[i], b = ordered[i + 1];
    const cnt = pairCount.get(`${a.id}>${b.id}`) || 0;
    if (cnt > 1) issues.push(mk('warning', 'DUP_TRANSFER', 'structure', { fromId: a.id, toId: b.id, values: { a: a.city_name, b: b.city_name, n: cnt } }));
  }

  issues.sort((x, y) => (x.level === y.level ? 0 : x.level === 'error' ? -1 : 1));
  return issues;
}

// Collapse to AT MOST ONE issue per entity (timeline / grid anti-pile).
// Priority: structure > entity > field; within scope, error before warning.
// Reproduces the transfer hierarchy (no-city -> not-adjacent -> day) and
// generalises it to hotels/activities. Paired issues (fromId>toId) are their
// own group, so a city's node issue and an adjacency issue both survive.
export function primaryIssues(issues = []) {
  const scopeRank = { structure: 0, entity: 1, field: 2 };
  const levelRank = { error: 0, warning: 1 };
  const groups = new Map();
  const keep = [];
  for (const it of issues) {
    const key = it.entityId != null ? `e:${it.entityKind}:${it.entityId}`
      : (it.fromId != null || it.toId != null) ? `p:${it.fromId}>${it.toId}:${it.code}`
        : `c:${it.code}`;
    const rank = (scopeRank[it.scope] ?? 9) * 10 + (levelRank[it.level] ?? 9);
    const cur = groups.get(key);
    if (!cur) { groups.set(key, { it, rank, idx: keep.length }); keep.push(it); }
    else if (rank < cur.rank) { keep[cur.idx] = it; groups.set(key, { ...cur, it, rank }); }
  }
  return keep;
}