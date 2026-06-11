// src/lib/tripDates.js
// TRIP-126 / Ф6: the ONE canonical client-side date-chain layout, mirroring the
// server formula recompute_trip (Postgres, migration 0027). Used by:
//   • the trip editor (TripStructureEdit) as optimistic reorder layout, and
//   • the pre-creation planner (ManualPlanner, manual + AI), which has no trip id
//     yet and no transfers (so gap is always 0).
// Keep this in sync with recompute_trip via a shared set of golden cases.
//
// Formula (no special cases):
//   start = previousEnd + gap;  end = start + nights;  cursor = end
//   • the first non-anchor node anchors the chain (its gap is forced to 0)
//   • a 'waypoint' is a single-date transit point (consumes no nights)
//   • 'start'/'end' anchors carry no dates, only a position
// Pure calendar-day math (UTC) → idempotent: with unchanged (nights, gap) it
// reproduces the stored dates exactly.

import { DateTime } from 'luxon';

const toDT = (iso) => (iso ? DateTime.fromISO(iso, { zone: 'utc' }) : null);
const dayOf = (iso) => { const d = toDT(iso); return d ? d.startOf('day') : null; };
const dayDiff = (aIso, bIso) => { const a = dayOf(aIso), b = dayOf(bIso); return a && b ? Math.round(b.diff(a, 'days').days) : null; };
const isAnchor = (n) => n.kind === 'start' || n.kind === 'end';

export function layoutDates(nodes, baseISO) {
  const firstTransit = nodes.find((n) => !isAnchor(n));
  let cursor = (baseISO ? toDT(baseISO) : toDT(firstTransit?.start_date)) || DateTime.utc();
  cursor = cursor.startOf('day');
  let seen = false; // the first non-anchor node anchors the trip start (gap forced 0)
  return nodes.map((n, i) => {
    if (isAnchor(n)) return { ...n, position: i };
    const gap = seen && Number.isFinite(n.gap) ? n.gap : 0;
    const startDay = cursor.plus({ days: gap });
    seen = true;
    if (n.kind === 'waypoint') { // single-date transit point - consumes no nights
      const d = startDay.toISODate();
      cursor = startDay;
      return { ...n, start_date: d, end_date: d, nights: null, gap, position: i };
    }
    const nights = Math.max(0, Number.isFinite(n.nights) ? n.nights : (dayDiff(n.start_date, n.end_date) ?? 1));
    const startD = startDay.toISODate();
    const endD = (nights > 0 ? startDay.plus({ days: nights }) : startDay).toISODate();
    cursor = startDay.plus({ days: nights });
    return { ...n, start_date: startD, end_date: endD, nights, gap, position: i };
  });
}
