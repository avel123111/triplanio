import React, { useMemo, useRef, useState, useEffect } from 'react';
import { DateTime } from 'luxon';
import { useI18nFormat } from '@/lib/i18n/I18nContext';
import { cityColor, hotelColor, segmentsForDay } from '@/lib/calendar/segments';
import CalendarSegmentBar from './CalendarSegmentBar';
import WeekEventBlock from './WeekEventBlock';
import WeekPointEventBlock from './WeekPointEventBlock';
import { base44 } from '@/api/base44Client';
import { useQueryClient } from '@tanstack/react-query';
import { useParams } from 'react-router-dom';
import { TRIP_CONTENT_KEY } from '@/lib/trip-data';
import { useToast } from '@/components/ui/use-toast';

const HOUR_HEIGHT = 44;

/**
 * Week view with interactive drag & drop / resize for events.
 *  - Top strip: per-day segmented city bar + hotel bar (only for trip days).
 *  - Hour grid: transfers + activities as draggable blocks.
 *
 * Edits (move / resize) only enabled when canEdit is true.
 */
// Point-event kinds: rendered as fixed 1-hour blocks (no end_datetime).
const POINT_KINDS = new Set([
  'hotel_checkin', 'hotel_checkout', 'hotel_cancel_deadline',
  'car_pickup', 'car_dropoff',
]);

// Color styles for point events on the week grid.
const POINT_STYLES = {
  hotel_checkin:         { stripe: 'bg-teal-500',    card: 'bg-teal-50 dark:bg-teal-950/40 text-teal-900 dark:text-teal-100' },
  hotel_checkout:        { stripe: 'bg-teal-500',    card: 'bg-teal-50 dark:bg-teal-950/40 text-teal-900 dark:text-teal-100' },
  hotel_cancel_deadline: { stripe: 'bg-rose-500',    card: 'bg-rose-50 dark:bg-rose-950/40 text-rose-900 dark:text-rose-100' },
  car_pickup:            { stripe: 'bg-emerald-500', card: 'bg-emerald-50 dark:bg-emerald-950/40 text-emerald-900 dark:text-emerald-100' },
  car_dropoff:           { stripe: 'bg-emerald-500', card: 'bg-emerald-50 dark:bg-emerald-950/40 text-emerald-900 dark:text-emerald-100' },
};

export default function CalendarWeekView({
  items, cursor, tripRange, visitsById,
  canEdit = false,
  onItemClick, onHotelSegmentClick,
}) {
  const { t, locale } = useI18nFormat();
  const { tripId } = useParams();
  const qc = useQueryClient();
  const { toast } = useToast();

  const days = useMemo(() => {
    const start = cursor.startOf('week');
    return Array.from({ length: 7 }, (_, i) => start.plus({ days: i }));
  }, [cursor]);

  const isTripDay = (d) => {
    if (!tripRange) return true;
    return d >= tripRange.start && d <= tripRange.end;
  };

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
  const hotelRawByKey = useMemo(() => {
    const m = {};
    hotelSpans.forEach(h => { m[h.key] = h.raw; });
    return m;
  }, [hotelSpans]);

  // Per-day segments for the all-day strip (only for trip days).
  const perDay = useMemo(() => days.map(d => {
    const inTrip = isTripDay(d);
    return {
      day: d,
      citySegs: inTrip
        ? segmentsForDay(citySpans, d).map(s => ({ ...s, colorClass: cityColor(s.key) }))
        : [],
      hotelSegs: inTrip
        ? segmentsForDay(hotelSpans, d).map(s => ({ ...s, colorClass: hotelColor(s.key) }))
        : [],
    };
  }), [days, citySpans, hotelSpans, tripRange]);

  // Timed events (transfers + activities) — these are the DRAGGABLE blocks.
  const timed = useMemo(() => {
    return items.filter(it =>
      (it.kind === 'transfer' || it.kind === 'activity') && it.start
    );
  }, [items]);
  // Point events (no end_datetime) — rendered as static 1-hour blocks.
  // Not draggable: their timestamps come from related entities (hotels, car
  // rentals) and should be edited via their dedicated dialogs.
  const points = useMemo(() => {
    return items.filter(it => POINT_KINDS.has(it.kind) && it.start);
  }, [items]);

  const anyCity = perDay.some(p => p.citySegs.length > 0);
  const anyHotel = perDay.some(p => p.hotelSegs.length > 0);
  const stripHeight = 8 + (anyCity ? 18 : 0) + (anyHotel ? 16 : 0) + 8;

  const today = DateTime.now().toFormat('yyyy-LL-dd');

  // Measure one day column's width so the drag math (dx → day shift) works.
  const gridRef = useRef(null);
  const [dayWidth, setDayWidth] = useState(120);
  useEffect(() => {
    if (!gridRef.current) return;
    const measure = () => {
      const cell = gridRef.current?.querySelector('[data-day-col="0"]');
      if (cell) setDayWidth(cell.getBoundingClientRect().width);
    };
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(gridRef.current);
    return () => ro.disconnect();
  }, []);

  // Persist an edit. Entity name + payload depend on item.kind.
  // Optimistically update the React Query cache so the user sees the move
  // instantly without waiting for the round trip.
  const commitEdit = async (item, result) => {
    const entityName = item.kind === 'transfer' ? 'Transfer'
                    : item.kind === 'activity' ? 'Activity'
                    : null;
    if (!entityName) return;

    const payload = item.kind === 'activity'
      ? { start_datetime: result.start, end_datetime: result.end }
      : { start_datetime: result.start, end_datetime: result.end };

    // Optimistic cache update
    const key = TRIP_CONTENT_KEY(tripId);
    const prev = qc.getQueryData(key);
    if (prev) {
      const next = { ...prev };
      if (item.kind === 'activity') {
        next.activities = (prev.activities || []).map(a =>
          `a-${a.id}` === item.id ? { ...a, ...payload } : a
        );
      } else if (item.kind === 'transfer') {
        next.transfers = (prev.transfers || []).map(tr =>
          `t-${tr.id}` === item.id ? { ...tr, ...payload } : tr
        );
      }
      qc.setQueryData(key, next);
    }

    try {
      // item.raw.id is the entity ID (item.id is prefixed with kind for uniqueness)
      await base44.entities[entityName].update(item.raw.id, payload);
      qc.invalidateQueries({ queryKey: key });
    } catch (err) {
      // Roll back optimistic update on failure
      if (prev) qc.setQueryData(key, prev);
      toast({
        title: t('calendar.update_failed'),
        description: err?.message || '',
        variant: 'destructive',
      });
    }
  };

  // Bounds for drag validation per event:
  //  - activity → parent city visit's [start, end]
  //  - transfer → trip range (if available)
  const boundsFor = (item) => {
    if (item.kind === 'activity') {
      const v = visitsById[item.raw.city_visit_id];
      if (v?.start_datetime && v?.end_datetime) {
        return { startIso: v.start_datetime, endIso: v.end_datetime };
      }
    }
    if (item.kind === 'transfer' && tripRange) {
      return {
        startIso: tripRange.start.toUTC().toISO(),
        endIso: tripRange.end.toUTC().toISO(),
      };
    }
    return { startIso: null, endIso: null };
  };

  return (
    <div className="border border-border rounded-lg overflow-hidden bg-card">
      {/* Day headers */}
      <div className="grid border-b border-border" style={{ gridTemplateColumns: '56px repeat(7, 1fr)' }}>
        <div className="bg-secondary" />
        {days.map(d => {
          const isToday = d.toFormat('yyyy-LL-dd') === today;
          return (
            <div key={d.toISO()} className="bg-secondary text-center py-2 border-l border-border">
              <div className="text-[10px] uppercase tracking-widest text-muted-foreground font-semibold">{d.setLocale(locale).toFormat('ccc')}</div>
              <div className={`font-display font-bold ${isToday ? 'text-primary' : ''}`}>{d.toFormat('dd')}</div>
            </div>
          );
        })}
      </div>

      {/* All-day strip with per-day segmented bars */}
      {(anyCity || anyHotel) && (
        <div
          className="grid border-b border-border"
          style={{ gridTemplateColumns: '56px repeat(7, 1fr)', minHeight: stripHeight }}
        >
          <div className="text-[10px] text-muted-foreground p-1.5 uppercase tracking-wider">{t('calendar.all_day')}</div>
          {perDay.map(({ day, citySegs, hotelSegs }) => (
            <div key={day.toISO()} className="border-l border-border p-1 space-y-1">
              {anyCity && <CalendarSegmentBar segments={citySegs} height={16} />}
              {anyHotel && (
                <CalendarSegmentBar
                  segments={hotelSegs}
                  height={14}
                  onSegmentClick={(seg) => {
                    const raw = hotelRawByKey[seg.key];
                    if (raw && onHotelSegmentClick) onHotelSegmentClick(raw);
                  }}
                />
              )}
            </div>
          ))}
        </div>
      )}

      {/* Hour grid */}
      <div ref={gridRef} className="relative grid" style={{ gridTemplateColumns: '56px repeat(7, 1fr)' }}>
        <div>
          {Array.from({ length: 24 }, (_, h) => (
            <div key={h} className="text-[10px] text-muted-foreground text-right pr-2 border-b border-border" style={{ height: HOUR_HEIGHT }}>
              {h.toString().padStart(2, '0')}:00
            </div>
          ))}
        </div>
        {days.map((d, dayIdx) => (
          <div key={d.toISO()} data-day-col={dayIdx} className="relative border-l border-border">
            {Array.from({ length: 24 }, (_, h) => (
              <div key={h} className="border-b border-border" style={{ height: HOUR_HEIGHT }} />
            ))}
            {timed.filter(it => {
              const s = DateTime.fromISO(it.start, { zone: 'utc' }).setZone(it.timezone || 'UTC');
              return s.hasSame(d, 'day');
            }).map(it => {
              const tz = it.timezone || 'UTC';
              const s = DateTime.fromISO(it.start, { zone: 'utc' }).setZone(tz);
              const e = it.end ? DateTime.fromISO(it.end, { zone: 'utc' }).setZone(tz) : null;
              const top = (s.hour + s.minute / 60) * HOUR_HEIGHT;
              const height = e
                ? Math.max(28, ((e.hour + e.minute / 60) - (s.hour + s.minute / 60)) * HOUR_HEIGHT)
                : 28;
              const bounds = boundsFor(it);
              return (
                <WeekEventBlock
                  key={it.id}
                  item={it}
                  top={top}
                  height={height}
                  dayWidth={dayWidth}
                  hourHeight={HOUR_HEIGHT}
                  canEdit={canEdit}
                  onClick={onItemClick}
                  onCommit={commitEdit}
                  boundsStartIso={bounds.startIso}
                  boundsEndIso={bounds.endIso}
                />
              );
            })}

            {/* Point events: 1-hour static blocks, clickable but not draggable. */}
            {points.filter(it => {
              const s = DateTime.fromISO(it.start, { zone: 'utc' }).setZone(it.timezone || 'UTC');
              return s.hasSame(d, 'day');
            }).map(it => {
              const tz = it.timezone || 'UTC';
              const s = DateTime.fromISO(it.start, { zone: 'utc' }).setZone(tz);
              const top = (s.hour + s.minute / 60) * HOUR_HEIGHT;
              return (
                <WeekPointEventBlock
                  key={it.id}
                  item={it}
                  top={top}
                  height={HOUR_HEIGHT}
                  style={POINT_STYLES[it.kind] || POINT_STYLES.hotel_checkin}
                  onClick={onItemClick}
                />
              );
            })}
          </div>
        ))}
      </div>
    </div>
  );
}