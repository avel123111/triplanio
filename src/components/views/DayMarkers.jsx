import React from 'react';
import { DateTime } from 'luxon';
import { dayKey } from '@/lib/time';

/**
 * Renders compact date badges in the timeline rail for every day inside a
 * city visit that has at least one event (activity, hotel check-in/out).
 * Only the date badge is drawn — no event chips, no labels — to keep the
 * rail clean and provide a quick temporal scan of the visit.
 *
 * The first day of the visit is skipped (already shown by the visit's
 * own date badge).
 */
export default function DayMarkers({ visit, hotels, activities, outboundDayKey = null }) {
  const tz = visit.timezone || 'UTC';
  if (!visit.start_datetime || !visit.end_datetime) return null;

  const start = DateTime.fromISO(visit.start_datetime, { zone: 'utc' }).setZone(tz).startOf('day');
  const end = DateTime.fromISO(visit.end_datetime, { zone: 'utc' }).setZone(tz).startOf('day');
  if (!start.isValid || !end.isValid) return null;

  const firstKey = start.toFormat('yyyy-LL-dd');
  const days = [];
  let d = start;
  while (d <= end) {
    days.push(d);
    d = d.plus({ days: 1 });
  }

  // Only render a date badge when there's at least one ACTIVITY that day.
  // Hotel check-in/out days are intentionally skipped — they're shown by the
  // visit anchor (first day) and the outbound transfer (last day) respectively,
  // so adding extra badges for them creates duplicate-looking date markers.
  const hasActivity = (k) => activities.some(a => dayKey(a.start_datetime, tz) === k);

  const rows = days
    .map(day => ({ day, key: day.toFormat('yyyy-LL-dd') }))
    .filter(r => r.key !== firstKey && r.key !== outboundDayKey && hasActivity(r.key));

  if (rows.length === 0) return null;

  return (
    <div className="space-y-2 mt-2">
      {rows.map(r => (
        <div key={r.key} className="flex items-start gap-4">
          <div className="relative z-10 shrink-0 w-12 h-12 rounded-lg flex flex-col items-center justify-center font-semibold bg-secondary text-foreground">
            <span className="text-base leading-none">{r.day.toFormat('d')}</span>
            <span className="text-[9px] uppercase tracking-wider opacity-80 mt-0.5">{r.day.toFormat('LLL')}</span>
          </div>
          <div className="flex-1" />
        </div>
      ))}
    </div>
  );
}