import React, { useMemo } from 'react';
import { DateTime } from 'luxon';
import { useI18nFormat } from '@/lib/i18n/I18nContext';
import { cityColor, hotelColor, segmentsForDay } from '@/lib/calendar/segments';
import CalendarSegmentBar from './CalendarSegmentBar';

// Short label for point events - keep just the entity name without the "Заезд:"/
// "Check-in:" prefix, since the design shows compact "time + name" rows.
function shortLabel(it) {
  if (!it?.raw) return it?.label || '';
  if (it.kind === 'hotel_checkin' || it.kind === 'hotel_checkout' ||
      it.kind === 'hotel_cancel_deadline' || it.kind === 'hotel') {
    return it.raw.name || it.label || '';
  }
  if (it.kind === 'car_pickup' || it.kind === 'car_dropoff') {
    return it.raw.name || it.label || '';
  }
  return it.label || '';
}

/**
 * Month grid.
 * Each cell stacks: [city bar] [hotel bar] [event rows...].
 * Cities/hotels spanning multiple days are rendered as per-cell segments -  * if a day hosts 2 cities (a "join" day), the bar splits 50/50, with 3
 * cities → 33/33/33, etc.
 */
export default function CalendarMonthView({ items, cursor, tripRange, onItemClick, onHotelSegmentClick, onDayClick }) {
  const { locale } = useI18nFormat();

  const weekdayLabels = useMemo(() => {
    const start = DateTime.now().startOf('week');
    return Array.from({ length: 7 }, (_, i) =>
      start.plus({ days: i }).setLocale(locale).toFormat('ccc')
    );
  }, [locale]);

  // Build all calendar cells (grid spans whole weeks intersecting the month).
  const days = useMemo(() => {
    const gridStart = cursor.startOf('month').startOf('week');
    const gridEnd = cursor.endOf('month').endOf('week');
    const arr = [];
    let d = gridStart;
    while (d <= gridEnd) { arr.push(d); d = d.plus({ days: 1 }); }
    return arr;
  }, [cursor]);

  // Group days into weeks (rows of 7).
  const weeks = useMemo(() => {
    const rows = [];
    for (let i = 0; i < days.length; i += 7) rows.push(days.slice(i, i + 7));
    return rows;
  }, [days]);

  // Pre-build span lists for cities and hotels (used by segmentsForDay).
  const citySpans = useMemo(
    () => items.filter(i => i.kind === 'visit').map(v => ({
      key: v.id, label: v.label, start: v.start, end: v.end, tz: v.timezone,
    })),
    [items]
  );
  const hotelSpans = useMemo(
    () => items.filter(i => i.kind === 'hotel').map(h => ({
      key: h.id, label: h.label, start: h.start, end: h.end, tz: h.timezone, raw: h.raw,
    })),
    [items]
  );
  // Map hotel-stay item id → raw hotel object so we can route segment clicks.
  const hotelRawByKey = useMemo(() => {
    const m = {};
    hotelSpans.forEach(h => { m[h.key] = h.raw; });
    return m;
  }, [hotelSpans]);

  // Events that should appear as rows inside a day cell. Now includes hotel/car
  // point events alongside transfers + activities.
  const POINT_KINDS = new Set([
    'hotel_checkin', 'hotel_checkout', 'hotel_cancel_deadline',
    'car_pickup', 'car_dropoff',
  ]);
  const eventItems = useMemo(
    () => items.filter(i =>
      i.kind === 'transfer' || i.kind === 'activity' || POINT_KINDS.has(i.kind)
    ),
    [items]
  );

  // Whether a given day is inside the trip's [start_date, end_date] window.
  // Used to hide city/hotel bars on days that are not part of the trip.
  const isTripDay = (d) => {
    if (!tripRange) return true;
    return d >= tripRange.start && d <= tripRange.end;
  };

  // Build per-day data once.
  const dayData = useMemo(() => {
    const map = {};
    days.forEach(d => {
      const dayKey = d.toFormat('yyyy-LL-dd');
      const inTrip = isTripDay(d);
      const citySegs = inTrip
        ? segmentsForDay(citySpans, d).map(s => ({ ...s, colorClass: cityColor(s.key) }))
        : [];
      const hotelSegs = inTrip
        ? segmentsForDay(hotelSpans, d).map(s => ({ ...s, colorClass: hotelColor(s.key) }))
        : [];

      // Events whose start falls within this day (in the event's TZ).
      const dayStartUtc = d.startOf('day').toUTC();
      const dayEndUtc = d.endOf('day').toUTC();
      const events = eventItems.filter(it => {
        if (!it.start) return false;
        const s = DateTime.fromISO(it.start, { zone: 'utc' }).setZone(it.timezone || 'UTC').toUTC();
        return s >= dayStartUtc && s <= dayEndUtc;
      }).sort((a, b) => new Date(a.start) - new Date(b.start));

      map[dayKey] = { citySegs, hotelSegs, events };
    });
    return map;
  }, [days, citySpans, hotelSpans, eventItems, tripRange]);

  const today = DateTime.now().toFormat('yyyy-LL-dd');
  const MAX_EVENTS = 3;

  return (
    <div className="border border-border rounded-lg overflow-hidden">
      <div className="grid grid-cols-7 bg-secondary text-xs font-semibold text-muted-foreground">
        {weekdayLabels.map((d, i) => (
          <div key={i} className="p-2 text-center border-r last:border-r-0 border-border capitalize">{d}</div>
        ))}
      </div>

      {weeks.map((week, wi) => (
        <div key={wi} className="grid grid-cols-7 border-t border-border">
          {week.map(d => {
            const dayKey = d.toFormat('yyyy-LL-dd');
            const inMonth = d.month === cursor.month;
            const isToday = dayKey === today;
            const { citySegs, hotelSegs, events } = dayData[dayKey] || { citySegs: [], hotelSegs: [], events: [] };
            const extra = Math.max(0, events.length - MAX_EVENTS);

            return (
              <div
                key={d.toISO()}
                className={`relative border-r last:border-r-0 border-border bg-card p-1.5 min-h-[120px] ${inMonth ? '' : 'opacity-40'}`}
              >
                <div className="flex items-center justify-between mb-1">
                  <button
                    type="button"
                    onClick={() => onDayClick && onDayClick(d)}
                    className={`text-xs font-semibold hover:text-primary transition-colors ${isToday ? 'inline-flex w-6 h-6 items-center justify-center rounded-full bg-primary text-primary-foreground hover:bg-primary/90 hover:text-primary-foreground' : ''}`}
                  >
                    {d.day}
                  </button>
                </div>

                {citySegs.length > 0 && (
                  <div className="mb-1">
                    <CalendarSegmentBar segments={citySegs} height={16} />
                  </div>
                )}
                {hotelSegs.length > 0 && (
                  <div className="mb-1">
                    <CalendarSegmentBar
                      segments={hotelSegs}
                      height={14}
                      onSegmentClick={(seg) => {
                        const raw = hotelRawByKey[seg.key];
                        if (raw && onHotelSegmentClick) onHotelSegmentClick(raw);
                      }}
                    />
                  </div>
                )}

                <div className="space-y-0.5">
                  {events.slice(0, MAX_EVENTS).map(it => {
                    const tz = it.timezone || 'UTC';
                    const time = it.start
                      ? DateTime.fromISO(it.start, { zone: 'utc' }).setZone(tz).toFormat('HH:mm')
                      : '';
                    const label = shortLabel(it);
                    return (
                      <button
                        key={it.id}
                        type="button"
                        onClick={() => onItemClick(it)}
                        className="w-full flex items-baseline gap-1.5 px-1 py-0.5 rounded-sm text-[11px] text-left hover:bg-secondary/60 transition-colors"
                        title={label}
                      >
                        <span className="text-muted-foreground tabular-nums shrink-0">{time}</span>
                        <span className="truncate text-foreground">{label}</span>
                      </button>
                    );
                  })}
                  {extra > 0 && (
                    <div className="text-[10px] text-muted-foreground pl-1">+{extra}</div>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      ))}
    </div>
  );
}