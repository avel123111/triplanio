// Centralized non-blocking validation rules for the new data model.
// All functions return array of warning strings (never throw).

import { DateTime } from 'luxon';

const t = (iso) => (iso ? new Date(iso).getTime() : null);


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
    const sa = t(a.start_date) ?? 0, sb = t(b.start_date) ?? 0;
    if (sa !== sb) return sa - sb;
    // Equal start → explicit position tie-break first…
    const pa = posOf(a), pb = posOf(b);
    if (pa !== null && pb !== null && pa !== pb) return pa - pb;
    // …then the city that ends earlier (legacy fallback when position absent).
    const ea = t(a.end_date) ?? 0, eb = t(b.end_date) ?? 0;
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
      const sa = t(A.v.start_date) ?? 0, sb = t(B.v.start_date) ?? 0;
      if (sa !== sb) return sa - sb;
      return A.i - B.i; // preserve incoming order for an equal-start tie
    })
    .map((x, pos) => ({ ...x.v, position: pos }));
}

// =====================================================================
// Calendar-day helpers (per-node timezone). Shared by the unified engine below.
// Day comparisons are done by CALENDAR DAY in each node's timezone (TZ §10.3).
// =====================================================================
// Calendar day (YYYY-MM-DD) in a node's tz, as a plain date. Use this for
// CROSS-node day gaps (A3): two nodes may have different timezones, and diffing
// their tz-local startOf('day') would leak the offset and report a phantom
// sub-day overlap. Comparing plain ISO dates parsed in one zone gives an exact
// integer day gap.
const calDay = (iso, tz) => (iso ? DateTime.fromISO(iso, { zone: 'utc' }).setZone(tz || 'UTC').toISODate() : null);

// Same city = same geonameid (TRIP-146); fallback to name+country_code, then
// raw external_city_id (TZ E2). Exported so the timeline's "no transfer" warning
// shares one identity rule with the editor's E1/E2 (single source of truth) —
// mirrors trip-cities.cityKey priority.
export const cityIdentity = (v) => {
  if (v?.geonameid != null && v.geonameid !== '') return `gn:${v.geonameid}`;
  const name = String(v?.name_i18n?.en || v?.city_name_en || v?.city_name || '').trim().toLowerCase();
  if (name) return `${name}|${(v?.country_code || '').trim().toLowerCase()}`;
  return v?.external_city_id ? `id:${v.external_city_id}` : '';
};

// City visit dates are DATE-ONLY (YYYY-MM-DD) — a calendar date, not an instant.
// Compare as plain ISO date strings; never run them through setZone (that would
// shift the boundary a day in non-UTC timezones). Events keep instant→tz day math.
const cityDay = (d) => (d ? String(d).slice(0, 10) : null);
const daysBetween = (isoA, isoB) => {
  if (!isoA || !isoB) return null;
  return Math.round(DateTime.fromISO(isoB, { zone: 'utc' }).diff(DateTime.fromISO(isoA, { zone: 'utc' }), 'days').days);
};


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
// Spec: VALIDATION_RULES_2026-06-03.md. This is the single validation engine -
// the legacy computeTripValidation/*Warnings were removed in Ф5.
// =====================================================================

export const TRANSFER_DAY_TOLERANCE = 1; // +/-1 calendar day (red-eye / 00:20 flights)

const isBlank = (s) => s == null || String(s).trim() === '';
const _ms = (iso) => (iso ? new Date(iso).getTime() : null);

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
    const ci = calDay(d.checkIn, tz), co = calDay(d.checkOut, tz);       // event instant → day-string in city tz
    const vs = cityDay(visit.start_date), ve = cityDay(visit.end_date); // city plain calendar date
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
    const as = calDay(d.start, tz), ae = calDay(d.end, tz);
    const vs = cityDay(visit.start_date), ve = cityDay(visit.end_date);
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
  const depGap = daysBetween(cityDay(from.end_date), calDay(d.start, from.timezone));
  if (depGap != null && Math.abs(depGap) > TRANSFER_DAY_TOLERANCE) {
    out.push(mk('error', 'TR_DEP_DAY', 'entity', { field: 'start', ...ref }));
  }
  const arrGap = daysBetween(cityDay(to.start_date), calDay(d.end, to.timezone));
  if (arrGap != null && Math.abs(arrGap) > TRANSFER_DAY_TOLERANCE) {
    out.push(mk('error', 'TR_ARR_DAY', 'entity', { field: 'end', ...ref }));
  }
  return out;
}

function validateTransferLayover(d = {}, ctx = {}) {
  const out = [];
  const segs = Array.isArray(d.segments) ? d.segments : [];
  const from = ctx.fromVisit || null, to = ctx.toVisit || null;
  const ref = { entityKind: 'transfer', entityId: d.id, values: { from: from?.city_name, to: to?.city_name } };
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
  // Endpoints of the chain must align with the trip-leg days, exactly like a
  // single transfer (+/-1 day): first departure vs leaving `from`, last arrival
  // vs reaching `to`. This closes the hole where an AI-parsed layover with
  // wildly wrong dates passed the engine and could be saved.
  const first = segs[0], last = segs[segs.length - 1];
  if (from && first?.start) {
    const depGap = daysBetween(cityDay(from.end_date), calDay(first.start, from.timezone));
    if (depGap != null && Math.abs(depGap) > TRANSFER_DAY_TOLERANCE) {
      out.push(mk('error', 'TR_DEP_DAY', 'entity', { field: 'seg0.start', ...ref }));
    }
  }
  if (to && last?.end) {
    const arrGap = daysBetween(cityDay(to.start_date), calDay(last.end, to.timezone));
    if (arrGap != null && Math.abs(arrGap) > TRANSFER_DAY_TOLERANCE) {
      out.push(mk('error', 'TR_ARR_DAY', 'entity', { field: `seg${segs.length - 1}.end`, ...ref }));
    }
  }
  return out;
}

// ── Parse-time advisory (TEMPORARY, NOT part of validateEntity) ──────────────
// City-mismatch between what the AI read from the booking and the trip route.
// EPHEMERAL by design: the AI's city names are never persisted (the saved
// transfer uses the trip's city nodes), so this can only be computed at parse
// time from the raw AI payload - it cannot be re-derived after save and does
// NOT gate saving (warning-level). Endpoints come from the trip, so we only
// flag the discrepancy for the user's eyes; the layover-connection check
// catches leg(i).to_city != leg(i+1).from_city (the same stop named two ways).
const cityEq = (a, b) => {
  if (isBlank(a) || isBlank(b)) return true; // nothing to compare -> not a mismatch
  const x = String(a).trim().toLowerCase(), y = String(b).trim().toLowerCase();
  return x === y || x.includes(y) || y.includes(x);
};
export function transferAiCityAdvisories(data = {}, fromVisit = null, toVisit = null) {
  const segs = Array.isArray(data.transfers) && data.transfers.length ? data.transfers
    : (Array.isArray(data.segments) && data.segments.length ? data.segments : [data]);
  const out = [];
  const first = segs[0] || {}, last = segs[segs.length - 1] || {};
  if (fromVisit?.city_name && !isBlank(first.from_city) && !cityEq(first.from_city, fromVisit.city_name)) {
    out.push(mk('warning', 'AI_CITY_MISMATCH_FROM', 'entity', { values: { booking: first.from_city, trip: fromVisit.city_name } }));
  }
  if (toVisit?.city_name && !isBlank(last.to_city) && !cityEq(last.to_city, toVisit.city_name)) {
    out.push(mk('warning', 'AI_CITY_MISMATCH_TO', 'entity', { values: { booking: last.to_city, trip: toVisit.city_name } }));
  }
  for (let i = 0; i < segs.length - 1; i++) {
    const a = segs[i]?.to_city, b = segs[i + 1]?.from_city;
    if (!isBlank(a) && !isBlank(b) && !cityEq(a, b)) {
      out.push(mk('warning', 'AI_LAYOVER_CITY_MISMATCH', 'entity', { values: { a, b } }));
    }
  }
  return out;
}

function validateService(d = {}, ctx = {}) {
  const out = [];
  const ref = { entityKind: 'service', entityId: d.id };
  // Branch by service subtype (esim / insurance / car_rental)
  const svcKind = d.service_kind || 'car_rental';

  if (svcKind === 'esim') {
    if (isBlank(d.name)) out.push(mk('error', 'SVC_NAME_REQUIRED', 'field', { field: 'name', ...ref }));
    return out;
  }

  if (svcKind === 'insurance') {
    if (isBlank(d.name)) out.push(mk('error', 'SVC_NAME_REQUIRED', 'field', { field: 'name', ...ref }));
    // Date order: date_finish must not precede date_start
    if (d.date_start && d.date_finish && d.date_finish < d.date_start) {
      out.push(mk('warning', 'INS_DATE_ORDER', 'field', { field: 'date_finish', ...ref }));
    }
    return out;
  }

  // car_rental (default)
  if (isBlank(d.name)) out.push(mk('error', 'SVC_NAME_REQUIRED', 'field', { field: 'name', ...ref }));
  if (!d.isEdit && isBlank(d.pickupAddress)) out.push(mk('error', 'SVC_PICKUP_ADDR_REQUIRED', 'field', { field: 'pickupAddress', ...ref }));
  if (!d.pickup) out.push(mk('error', 'SVC_PICKUP_REQUIRED', 'field', { field: 'pickup', ...ref }));
  if (!d.dropoff) out.push(mk('error', 'SVC_DROPOFF_REQUIRED', 'field', { field: 'dropoff', ...ref }));
  if (d.pickup && d.dropoff && _ms(d.dropoff) <= _ms(d.pickup)) out.push(mk('error', 'SVC_ORDER', 'field', { field: 'dropoff', ...ref }));
  return out;
}

function validateCity(d = {}) {
  const out = [];
  if (d.kind === 'start' || d.kind === 'end') return out; // anchors: dates null by design
  const ref = { entityKind: 'city', entityId: d.id, values: { city: d.city_name } };
  if (!d.start_date || !d.end_date) { out.push(mk('error', 'CITY_DATES_REQUIRED', 'field', { field: 'start', ...ref })); return out; }
  const s = cityDay(d.start_date), e = cityDay(d.end_date);
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

function validateDocument(d = {}) {
  const out = [];
  if (isBlank(d.title)) out.push(mk('error', 'DOC_TITLE_REQUIRED', 'field', { field: 'title' }));
  return out;
}

// Member invite. mode 'offline' -> name required; 'email' -> valid e-mail;
// any other mode (e.g. share-link tab) -> nothing to validate.
function validateInvite(d = {}) {
  const out = [];
  if (d.mode === 'offline') {
    if (isBlank(d.name)) out.push(mk('error', 'INV_NAME_REQUIRED', 'field', { field: 'name' }));
  } else if (d.mode === 'email') {
    if (isBlank(d.email) || !String(d.email).includes('@')) out.push(mk('error', 'INV_EMAIL_INVALID', 'field', { field: 'email' }));
  }
  return out;
}

// Facade for the MODAL: validate ONE entity (L1 + L2).
export function validateEntity(kind, draft = {}, ctx = {}) {
  switch (kind) {
    case 'hotel': return validateHotel(draft, ctx);
    case 'activity': return validateActivity(draft, ctx);
    case 'transfer': return draft.hasLayovers ? validateTransferLayover(draft, ctx) : validateTransferSingle(draft, ctx);
    case 'service': return validateService(draft, ctx);
    case 'city': return validateCity(draft);
    case 'trip': return validateTripMeta(draft);
    case 'expense': return validateExpense(draft);
    case 'category': return validateCategory(draft);
    case 'fx': return validateFx(draft);
    case 'document': return validateDocument(draft);
    case 'invite': return validateInvite(draft);
    default: return [];
  }
}

// Facade for EDIT MODE / timeline (L3): whole trip. Reuses validateEntity per
// entity + adds cross-entity structure rules. Consumed by TripStructureEdit via
// a thin adapter (resolves message + maps entity refs + primaryIssues).
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
    if (!a.end_date || !b.start_date) continue;
    const gap = daysBetween(cityDay(a.end_date), cityDay(b.start_date));
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
        // Q3 (editor redesign): a transfer whose cities aren't adjacent in the
        // route is "out of plan", not an error — we never auto-delete it and it
        // must NOT block save. Shown as a soft hint (and, in the editor, in the
        // "transfers out of plan" tray). Was 'error'; lowered to 'warning'.
        issues.push(mk('warning', 'TR_NOT_ADJACENT', 'structure', { entityKind: 'transfer', entityId: tr.id, values: { from: f.city_name, to: to.city_name } }));
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