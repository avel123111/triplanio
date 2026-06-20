// src/lib/tripDates.js
// TRIP-126 / Ф6: the ONE canonical client-side date-chain layout, mirroring the
// server formula recompute_trip (Postgres, migration 0027). Used by:
//   • the trip editor (TripStructureEdit) as optimistic reorder layout, and
//   • the pre-creation planner (ManualPlanner, manual + AI), which has no trip id
//     yet and no transfers (so gap is always 0).
// Keep this in sync with recompute_trip (now migration 0043) via a shared set of
// golden cases.
//
// Formula (no special cases):
//   start = previousEnd + gap;  end = start + nights;  cursor = end
//   • baseISO is the chain anchor = the DEPARTURE day (UTC) of the first leg leaving
//     the `start` city (mirrors server _trip_anchor_date); callers pass it in. A
//     stable external anchor — so applying a gap to the first city stays idempotent.
//   • EVERY non-anchor (the first one too) uses its own gap: an overnight start->first
//     leg pushes the first city +1 (arrival day). No special-casing of the first node.
//   • a 'waypoint' is a single-date transit point (consumes no nights)
//   • 'start'/'end' anchors MATERIALIZE a single date (mirrors server recompute_trip,
//     migration 0049): start = the anchor day (cursor, pre-gap; the start->city1 gap
//     moves city1, not start); end = the last checkout (cursor) + its own incoming-leg
//     gap (the finish moves on an overnight last->finish leg). Anchors consume no nights
//     and never advance the cursor. So every consumer (timeline / marker / validator)
//     reads one value.
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
  return nodes.map((n, i) => {
    if (n.kind === 'start') {            // anchor day itself (pre-gap); cursor not advanced
      const d = cursor.toISODate();
      return { ...n, start_date: d, end_date: d, nights: null, position: i };
    }
    if (n.kind === 'end') {              // last checkout + own incoming-leg gap (finish moves)
      const d = cursor.plus({ days: Number.isFinite(n.gap) ? n.gap : 0 }).toISODate();
      return { ...n, start_date: d, end_date: d, nights: null, position: i };
    }
    // No first-node special case: the first non-anchor's gap applies too, so an
    // overnight start->first leg lands the city on its arrival day. baseISO already
    // points at the start-leg departure day, so this stays idempotent.
    const gap = Number.isFinite(n.gap) ? n.gap : 0;
    const startDay = cursor.plus({ days: gap });
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
