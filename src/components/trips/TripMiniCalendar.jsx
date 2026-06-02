import React, { useMemo, useState } from 'react';
import { DateTime } from 'luxon';
import { ChevronLeft, ChevronRight } from 'lucide-react';

/**
 * Compact month-view calendar with dots for days that have events,
 * and the currently-selected day highlighted.
 *
 * Props:
 * - tripStart, tripEnd: ISO strings (UTC) - defines initial month + scope
 * - eventDaysByKey: { 'yyyy-LL-dd': { hasHotel, hasTransfer, hasActivity, hasVisit } }
 * - selectedDayKey: 'yyyy-LL-dd' | null
 * - onSelectDay: (dayKey) => void
 */
export default function TripMiniCalendar({ tripStart, tripEnd, eventDaysByKey = {}, selectedDayKey, onSelectDay }) {
  const initial = useMemo(() => {
    if (tripStart) return DateTime.fromISO(tripStart, { zone: 'utc' }).startOf('month');
    return DateTime.now().startOf('month');
  }, [tripStart]);
  const [cursor, setCursor] = useState(initial);

  const grid = useMemo(() => buildMonthGrid(cursor), [cursor]);

  return (
    <div className="rounded-2xl border border-border bg-card p-4">
      <div className="flex items-center justify-between mb-3">
        <div className="font-semibold">{cursor.toFormat('LLLL yyyy')}</div>
        <div className="flex items-center gap-1">
          <button onClick={() => setCursor(c => c.minus({ months: 1 }))} className="w-7 h-7 rounded-md hover:bg-secondary inline-flex items-center justify-center" aria-label="Previous month">
            <ChevronLeft className="w-4 h-4" />
          </button>
          <button onClick={() => setCursor(c => c.plus({ months: 1 }))} className="w-7 h-7 rounded-md hover:bg-secondary inline-flex items-center justify-center" aria-label="Next month">
            <ChevronRight className="w-4 h-4" />
          </button>
        </div>
      </div>

      <div className="grid grid-cols-7 gap-1 text-[10px] font-medium text-muted-foreground mb-1">
        {['S', 'M', 'T', 'W', 'T', 'F', 'S'].map((d, i) => (
          <div key={i} className="text-center">{d}</div>
        ))}
      </div>

      <div className="grid grid-cols-7 gap-1">
        {grid.map(({ date, inMonth }, i) => {
          const key = date.toFormat('yyyy-LL-dd');
          const events = eventDaysByKey[key];
          const isSelected = selectedDayKey === key;
          const isInTrip = inTripRange(date, tripStart, tripEnd);

          return (
            <button
              key={i}
              onClick={() => onSelectDay?.(key)}
              className={[
                'relative aspect-square rounded-full text-xs font-medium flex items-center justify-center transition',
                isSelected
                  ? 'bg-primary text-primary-foreground shadow-sm'
                  : isInTrip
                    ? 'bg-primary/15 text-foreground font-semibold hover:bg-primary/25'
                    : inMonth
                      ? 'hover:bg-secondary/50 text-muted-foreground'
                      : 'text-muted-foreground/40',
              ].join(' ')}
            >
              <span>{date.day}</span>
              {events && !isSelected && (
                <span className="absolute bottom-1 left-1/2 -translate-x-1/2 flex gap-0.5">
                  {events.hasVisit && <span className="w-1 h-1 rounded-full bg-primary" />}
                  {events.hasActivity && <span className="w-1 h-1 rounded-full bg-accent" />}
                </span>
              )}
            </button>
          );
        })}
      </div>
    </div>
  );
}

function buildMonthGrid(cursor) {
  const start = cursor.startOf('month');
  // weekStart: Sunday (0). Luxon weekday: 1=Mon..7=Sun. Convert.
  const offset = start.weekday % 7; // 0 for Sun..6 for Sat
  const gridStart = start.minus({ days: offset });
  const days = [];
  for (let i = 0; i < 42; i++) {
    const d = gridStart.plus({ days: i });
    days.push({ date: d, inMonth: d.month === cursor.month });
  }
  return days;
}

function inTripRange(date, tripStart, tripEnd) {
  // No dates set on the trip → don't highlight anything as "in-trip".
  if (!tripStart || !tripEnd) return false;
  const s = DateTime.fromISO(tripStart, { zone: 'utc' }).startOf('day');
  const e = DateTime.fromISO(tripEnd, { zone: 'utc' }).endOf('day');
  return date >= s && date <= e;
}