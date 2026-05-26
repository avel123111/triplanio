import React, { useState, useEffect, useMemo } from 'react';
import { DateTime } from 'luxon';
import { Button } from '@/components/ui/button';
import { ChevronLeft, ChevronRight, Flag } from 'lucide-react';
import CalendarMonthView from './CalendarMonthView';
import CalendarWeekView from './CalendarWeekView';
import { useI18nFormat } from '@/lib/i18n/I18nContext';

/**
 * Normalize the new model into a uniform "item" shape:
 *   { id, kind, start, end, timezone, label, raw }
 *
 * Kinds:
 *   - visit           — multi-day city span (background bar)
 *   - hotel           — multi-day hotel STAY (background bar)
 *   - activity        — timed event
 *   - transfer        — timed event
 *   - hotel_checkin   — POINT event (no end). raw = hotel
 *   - hotel_checkout  — POINT event (no end). raw = hotel
 *   - hotel_cancel_deadline — POINT event (no end). raw = hotel
 *   - car_pickup      — POINT event (no end). raw = car-rental service
 *   - car_dropoff     — POINT event (no end). raw = car-rental service
 *
 * Visits with kind='start'/'end' (origin/destination markers without dates) are
 * excluded — they would otherwise appear as zero-length sentinel points.
 *
 * `t` is the i18n translator used to label point events.
 */
function buildItems({ visits, hotels, activities, transfers, carRentals, visitsById, t }) {
  const items = [];
  visits.forEach(v => {
    if (v.kind === 'start' || v.kind === 'end') return;
    if (!v.start_datetime || !v.end_datetime) return;
    items.push({
      id: `v-${v.id}`, kind: 'visit',
      start: v.start_datetime, end: v.end_datetime, timezone: v.timezone,
      label: v.city_name, raw: v,
    });
  });
  hotels.forEach(h => {
    const v = visitsById[h.city_visit_id];
    const tz = v?.timezone || 'UTC';
    // Multi-day STAY bar (segmented header)
    items.push({
      id: `h-${h.id}`, kind: 'hotel',
      start: h.check_in_datetime, end: h.check_out_datetime,
      timezone: tz,
      label: h.name, raw: h,
    });
    // Point event: check-in
    if (h.check_in_datetime) {
      items.push({
        id: `hci-${h.id}`, kind: 'hotel_checkin',
        start: h.check_in_datetime, end: null, timezone: tz,
        label: t('calendar.hotel_checkin', { name: h.name }),
        raw: h,
      });
    }
    // Point event: check-out
    if (h.check_out_datetime) {
      items.push({
        id: `hco-${h.id}`, kind: 'hotel_checkout',
        start: h.check_out_datetime, end: null, timezone: tz,
        label: t('calendar.hotel_checkout', { name: h.name }),
        raw: h,
      });
    }
    // Point event: free cancellation deadline
    if (h.free_cancellation && h.free_cancellation_until) {
      items.push({
        id: `hcd-${h.id}`, kind: 'hotel_cancel_deadline',
        start: h.free_cancellation_until, end: null, timezone: tz,
        label: t('calendar.hotel_cancel_deadline', { name: h.name }),
        raw: h,
      });
    }
  });
  activities.forEach(a => {
    const v = visitsById[a.city_visit_id];
    items.push({
      id: `a-${a.id}`, kind: 'activity',
      start: a.start_datetime, end: a.end_datetime,
      timezone: v?.timezone || 'UTC',
      label: a.title, raw: a,
    });
  });
  transfers.forEach(tr => {
    const v = visitsById[tr.from_city_visit_id];
    items.push({
      id: `t-${tr.id}`, kind: 'transfer',
      start: tr.start_datetime, end: tr.end_datetime,
      timezone: v?.timezone || 'UTC',
      transport_type: tr.transport_type,
      label: `${v?.city_name || '?'} → ${visitsById[tr.to_city_visit_id]?.city_name || '?'}`,
      raw: tr,
    });
  });
  // Car rental services → pickup + drop-off point events.
  // pickup_at_local / dropoff_at_local are LOCAL "yyyy-MM-ddTHH:mm" strings
  // without a timezone — they are interpreted in the user's wall clock. We
  // treat them as UTC for calendar positioning (matches how the timeline
  // renders them); their `timezone` is set to 'UTC' so the week/month TZ
  // conversion is a no-op.
  (carRentals || []).forEach(s => {
    const d = s.details || {};
    const name = s.name || 'Car rental';
    const toUtcIso = (local) => {
      if (!local) return null;
      // Already an ISO with offset? Use as-is. Otherwise treat as UTC.
      const dt = local.includes('Z') || /[+-]\d{2}:?\d{2}$/.test(local)
        ? DateTime.fromISO(local)
        : DateTime.fromISO(local, { zone: 'utc' });
      return dt.isValid ? dt.toUTC().toISO() : null;
    };
    const pickup = toUtcIso(d.pickup_at_local);
    const dropoff = toUtcIso(d.dropoff_at_local);
    if (pickup) {
      items.push({
        id: `crp-${s.id}`, kind: 'car_pickup',
        start: pickup, end: null, timezone: 'UTC',
        label: t('calendar.car_pickup', { name }),
        raw: s,
      });
    }
    if (dropoff) {
      items.push({
        id: `crd-${s.id}`, kind: 'car_dropoff',
        start: dropoff, end: null, timezone: 'UTC',
        label: t('calendar.car_dropoff', { name }),
        raw: s,
      });
    }
  });
  return items;
}

export default function CalendarView({
  trip,
  tripRange: tripRangeProp,
  visits, hotels, activities, transfers, carRentals, visitsById, initialMonth,
  canEdit = false,
  onClickHotel, onClickTransfer, onClickActivity, onClickCarRental,
}) {
  const { t, locale } = useI18nFormat();
  const [mode, setMode] = useState('month');
  const [cursor, setCursor] = useState(() => (initialMonth ? initialMonth.startOf('month') : DateTime.now().startOf('month')));

  useEffect(() => {
    if (initialMonth) setCursor(c => (c.hasSame(DateTime.now().startOf('month'), 'month') ? initialMonth.startOf(mode === 'week' ? 'week' : 'month') : c));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [initialMonth?.toISO()]);

  const items = useMemo(
    () => buildItems({ visits, hotels, activities, transfers, carRentals, visitsById, t }),
    [visits, hotels, activities, transfers, carRentals, visitsById, t]
  );

  // Trip range: used to restrict city/hotel segments to days within the trip
  // and to power the "Trip start" jump button. Prefer the prop from the parent
  // (computed from cityVisits → works even when trip.start_date is empty).
  const tripRange = useMemo(() => {
    if (tripRangeProp?.start && tripRangeProp?.end) {
      return {
        start: DateTime.fromJSDate(new Date(tripRangeProp.start)).startOf('day'),
        end: DateTime.fromJSDate(new Date(tripRangeProp.end)).endOf('day'),
      };
    }
    if (!trip?.start_date || !trip?.end_date) return null;
    return {
      start: DateTime.fromISO(trip.start_date).startOf('day'),
      end: DateTime.fromISO(trip.end_date).endOf('day'),
    };
  }, [tripRangeProp?.start, tripRangeProp?.end, trip?.start_date, trip?.end_date]);

  const step = (dir) => setCursor(c => mode === 'month' ? c.plus({ months: dir }) : c.plus({ weeks: dir }));
  const goToday = () => setCursor(mode === 'month' ? DateTime.now().startOf('month') : DateTime.now().startOf('week'));
  const goTripStart = () => {
    if (!tripRange?.start) return;
    setCursor(mode === 'month' ? tripRange.start.startOf('month') : tripRange.start.startOf('week'));
  };
  const switchMode = (next) => { setMode(next); setCursor(c => next === 'week' ? c.startOf('week') : c.startOf('month')); };

  // Used when a user clicks a day cell in the month view → jump to the
  // matching week. Keeps the same date as the focal point.
  const goToWeek = (day) => {
    setMode('week');
    setCursor(day.startOf('week'));
  };

  const cap = (s) => (s ? s.charAt(0).toLocaleUpperCase(locale) + s.slice(1) : s);
  const headerLabel = mode === 'month'
    ? cap(cursor.setLocale(locale).toFormat('LLLL yyyy'))
    : `${cursor.startOf('week').setLocale(locale).toFormat('d LLL')} – ${cursor.startOf('week').plus({ days: 6 }).setLocale(locale).toFormat('d LLL yyyy')}`;

  const handleItemClick = (it) => {
    if (!it?.raw) return;
    // Hotel stays + all hotel point events → hotel view dialog
    if ((it.kind === 'hotel' ||
         it.kind === 'hotel_checkin' ||
         it.kind === 'hotel_checkout' ||
         it.kind === 'hotel_cancel_deadline') && onClickHotel) {
      onClickHotel(it.raw);
    }
    // Car rental point events → car rental view dialog
    else if ((it.kind === 'car_pickup' || it.kind === 'car_dropoff') && onClickCarRental) {
      onClickCarRental(it.raw);
    }
    else if (it.kind === 'transfer' && onClickTransfer) onClickTransfer(it.raw);
    else if (it.kind === 'activity' && onClickActivity) onClickActivity(it.raw);
  };

  return (
    <div>
      <div className="flex items-center justify-between mb-4 gap-2 flex-wrap">
        <h3 className="font-display text-xl font-bold">{headerLabel}</h3>
        <div className="flex items-center gap-2">
          <div className="inline-flex rounded-md border border-border bg-card p-0.5">
            <button onClick={() => switchMode('month')} className={`px-2.5 py-1 text-xs font-medium rounded ${mode === 'month' ? 'bg-primary text-primary-foreground' : 'text-muted-foreground'}`}>{t('calendar.month')}</button>
            <button onClick={() => switchMode('week')} className={`px-2.5 py-1 text-xs font-medium rounded ${mode === 'week' ? 'bg-primary text-primary-foreground' : 'text-muted-foreground'}`}>{t('calendar.week')}</button>
          </div>
          <div className="flex items-center gap-1">
            <Button variant="outline" size="sm" onClick={() => step(-1)} aria-label={t('calendar.prev')}><ChevronLeft className="w-4 h-4" /></Button>
            <Button variant="outline" size="sm" onClick={goToday}>{t('calendar.today')}</Button>
            {tripRange && (
              <Button variant="outline" size="sm" onClick={goTripStart} className="gap-1.5" title={t('calendar.trip_start')}>
                <Flag className="w-3.5 h-3.5" />
                <span>{t('calendar.trip_start')}</span>
              </Button>
            )}
            <Button variant="outline" size="sm" onClick={() => step(1)} aria-label={t('calendar.next')}><ChevronRight className="w-4 h-4" /></Button>
          </div>
        </div>
      </div>

      {mode === 'month'
        ? <CalendarMonthView
            items={items}
            cursor={cursor}
            tripRange={tripRange}
            onItemClick={handleItemClick}
            onHotelSegmentClick={(hotelRaw) => onClickHotel && onClickHotel(hotelRaw)}
            onDayClick={goToWeek}
          />
        : <CalendarWeekView
            items={items}
            cursor={cursor}
            tripRange={tripRange}
            visitsById={visitsById}
            canEdit={canEdit}
            onItemClick={handleItemClick}
            onHotelSegmentClick={(hotelRaw) => onClickHotel && onClickHotel(hotelRaw)}
          />
      }
    </div>
  );
}