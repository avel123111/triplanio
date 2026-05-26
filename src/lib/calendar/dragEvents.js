// Helpers for the week-view drag & drop / resize behavior.
//
// The week grid uses HOUR_HEIGHT pixels per hour. We snap user input to
// SNAP_MINUTES (15 min) to keep edits clean.

import { DateTime } from 'luxon';

export const SNAP_MINUTES = 15;

export function snapMinutes(min) {
  return Math.round(min / SNAP_MINUTES) * SNAP_MINUTES;
}

// Build payload {start_datetime, end_datetime} (UTC ISO) for an event after a
// drag/resize. `mode` is 'move' | 'resize-top' | 'resize-bottom'.
//
//  - originalStart/originalEnd: DateTime in event's TZ (the values at gesture start)
//  - deltaMinutes: snapped minute delta applied to the dragged edge / whole event
//  - newDayOffsetDays: integer days to shift (only used in move mode when
//    the user moves the event horizontally to another column)
//
// Returns null if the resulting interval would be invalid (end <= start).
export function applyDelta({ mode, originalStart, originalEnd, deltaMinutes, newDayOffsetDays = 0 }) {
  if (mode === 'move') {
    const dur = originalEnd && originalStart
      ? originalEnd.diff(originalStart, 'minutes').minutes
      : 0;
    const s = originalStart.plus({ days: newDayOffsetDays, minutes: deltaMinutes });
    const e = originalEnd ? s.plus({ minutes: dur }) : null;
    return {
      start: s.toUTC().toISO(),
      end: e ? e.toUTC().toISO() : null,
      startLocal: s,
      endLocal: e,
    };
  }
  if (mode === 'resize-top') {
    const s = originalStart.plus({ minutes: deltaMinutes });
    if (originalEnd && s >= originalEnd) return null;
    return {
      start: s.toUTC().toISO(),
      end: originalEnd ? originalEnd.toUTC().toISO() : null,
      startLocal: s,
      endLocal: originalEnd,
    };
  }
  if (mode === 'resize-bottom') {
    if (!originalEnd) return null;
    const e = originalEnd.plus({ minutes: deltaMinutes });
    if (e <= originalStart) return null;
    return {
      start: originalStart.toUTC().toISO(),
      end: e.toUTC().toISO(),
      startLocal: originalStart,
      endLocal: e,
    };
  }
  return null;
}

// Check the new interval is inside the parent city visit's bounds (for
// activities). Transfers use trip bounds. Returns true if valid.
export function isInsideBounds(startUtcIso, endUtcIso, boundsStartIso, boundsEndIso) {
  if (!boundsStartIso || !boundsEndIso) return true; // no bounds → permissive
  const s = DateTime.fromISO(startUtcIso);
  const e = endUtcIso ? DateTime.fromISO(endUtcIso) : s;
  const bs = DateTime.fromISO(boundsStartIso);
  const be = DateTime.fromISO(boundsEndIso);
  return s >= bs && e <= be;
}