import React, { useEffect, useMemo, useRef, useState } from 'react';
import { DateTime } from 'luxon';
import { MapPin, Camera, ExternalLink, Sparkles, Plane, Flag, LogIn, LogOut, ArrowRight, CalendarX, Send, Info, Car, Plus } from 'lucide-react';
import { countryFlag } from '@/lib/geo';
import { Button } from '@/components/ui/button';
import { sortVisits } from '@/lib/validation';
import { transportInfo } from '@/lib/transport';
import { BOOKING_PLATFORMS, platformLogoUrl, normalizeExternalUrl } from '@/lib/booking-platforms';
import AddTransferButton from '@/components/bookings/AddTransferButton';
import CityHero from './CityHero';
import StaySectionExpandable from './StaySectionExpandable';
import TransferGroupReadOnly from './TransferGroupReadOnly';
import CityNotesBlock from './CityNotesBlock';
import { useI18nFormat } from '@/lib/i18n/I18nContext';
import { parseNaive, naiveDayKey, formatNaive, naiveMillis } from '@/lib/naive-time';
import { getWeather, weatherInfo } from '@/lib/weather';

/**
 * Read-only timeline shown on the trip *view* page.
 *
 * MODEL: there are no "city days" or "owner visits" - the timeline is a single
 * chronological stream of events ordered by their naive (wall-clock) datetime.
 * Each event lives on its own calendar day; the CityHero card is just another
 * event in the stream, anchored to the visit's start_datetime (or pinned right
 * after the inbound transfer if one arrives that same naive day).
 *
 * LAYOUT (current iteration):
 *  - No vertical rail / no left "anchor" circles. The whole stream is a single
 *    column of cards.
 *  - Event icons live INSIDE each card, between the time chip and the text.
 *  - Day separators render as a large "8 ИЮЛ" with the weekday next to it.
 *  - Days inside the trip range that have NO events still get a separator
 *    plus a faint "nothing planned" placeholder card.
 *
 * Timezones are intentionally IGNORED in this view - see lib/naive-time.js.
 */
export default function ReadOnlyTimelineView({
  trip, visits = [], hotels = [], activities = [], transfers = [], carRentals = [],
  selectedDayKey, onDaysChange,
  onClickHotel, onClickTransfer, onClickActivity, onClickCarRental,
  canEdit = false, onAddHotel, onAddTransfer, onEditVisitNotes,
  isEditMode = false, onAddCityForDay, onAddActivityForDay,
  showBookingWarnings = true,
}) {
  const { t, locale } = useI18nFormat();
  const containerRef = useRef(null);
  const dayRefs = useRef({});
  const ordered = useMemo(() => sortVisits(visits), [visits]);

  // Weather: fetch per transit visit (future only - getWeather returns null for past)
  // Result: { [dayKey]: { icon, temp_max, temp_min } }
  const [weatherByDay, setWeatherByDay] = useState({});
  useEffect(() => {
    const transitVisits = visits.filter(v => v.kind !== 'start' && v.kind !== 'end' && v.latitude && v.longitude && v.start_date && v.end_date);
    if (transitVisits.length === 0) return;
    let cancelled = false;
    (async () => {
      const map = {};
      for (const v of transitVisits) {
        const startDay = naiveDayKey(v.start_date);
        const endDay = naiveDayKey(v.end_date);
        const result = await getWeather(v.latitude, v.longitude, startDay, endDay);
        if (cancelled || !result?.daily) continue;
        const { time, weather_code, temperature_2m_max, temperature_2m_min } = result.daily;
        (time || []).forEach((d, i) => {
          const info = weatherInfo(weather_code?.[i]);
          map[d] = { icon: info.icon, temp_max: Math.round(temperature_2m_max?.[i] ?? 0), temp_min: Math.round(temperature_2m_min?.[i] ?? 0) };
        });
      }
      if (!cancelled) setWeatherByDay(map);
    })();
    return () => { cancelled = true; };
  }, [visits]); // eslint-disable-line react-hooks/exhaustive-deps

  // Sequential #N index for transit visits only (start/end anchors excluded).
  const cityIndexById = useMemo(() => {
    const map = {};
    let n = 0;
    for (const v of ordered) {
      if (v.kind === 'start' || v.kind === 'end') continue;
      n += 1;
      map[v.id] = n;
    }
    return map;
  }, [ordered]);

  const hotelsByVisit = useMemo(() => groupBy(hotels, (h) => h.city_visit_id), [hotels]);
  const visitsById = useMemo(() => Object.fromEntries(visits.map((v) => [v.id, v])), [visits]);

  // Inbound transfers per visit - used to find what "brought us" to a city.
  const inboundByVisit = useMemo(() => groupBy(transfers, (t) => t.to_city_visit_id), [transfers]);

  /**
   * Build a flat, sorted stream of timeline events.
   * Each event has: { key, kind, sortMs, dayKey, iso, ...payload }
   */
  const stream = useMemo(() => {
    const events = [];

    // --- Anchors (start / end) ---
    for (const v of ordered) {
      if (v.kind === 'start') {
        events.push({
          key: `anchor-${v.id}`,
          kind: 'anchor',
          visit: v,
          sortMs: -Infinity,
          dayKey: null,
          iso: null,
        });
      } else if (v.kind === 'end') {
        // End anchor: render at the absolute bottom - always sort after every event.
        // Use end_datetime if available, otherwise start_datetime.
        const endIso = v.end_date || v.start_date;
        events.push({
          key: `anchor-${v.id}`,
          kind: 'anchor',
          visit: v,
          sortMs: Infinity,
          dayKey: endIso ? naiveDayKey(endIso) : null,
          iso: endIso || null,
        });
      }
    }

    // --- City arrivals (transit visits only) ---
    for (const v of ordered) {
      if (v.kind === 'start' || v.kind === 'end') continue;

      const inbounds = (inboundByVisit[v.id] || []).filter((tr) => tr.end_datetime);
      let anchorIso;
      let sortMs;

      if (inbounds.length > 0) {
        const latest = inbounds.reduce((acc, tr) =>
          naiveMillis(tr.end_datetime) > naiveMillis(acc.end_datetime) ? tr : acc
        );
        anchorIso = latest.end_datetime;
        // City sortMs = inbound transfer's start_datetime + 1ms so it always
        // renders right after the transfer row (same day, subOrder=2 > transfer=1)
        // but before car-pickup or other events at end_datetime.
        sortMs = naiveMillis(latest.start_datetime) + 1;
      } else if (v.start_date) {
        anchorIso = v.start_date;
        sortMs = naiveMillis(anchorIso);
      } else {
        continue;
      }

      events.push({
        key: `city-${v.id}`,
        kind: 'city',
        visit: v,
        sortMs,
        dayKey: naiveDayKey(anchorIso),
        iso: anchorIso,
      });
    }

    // --- Hotels: check-in, check-out, cancellation deadline ---
    for (const h of hotels) {
      if (h.check_in_datetime) {
        events.push({ key: `hi-${h.id}`, kind: 'hotel-in', hotel: h, sortMs: naiveMillis(h.check_in_datetime), dayKey: naiveDayKey(h.check_in_datetime), iso: h.check_in_datetime });
      }
      if (h.check_out_datetime) {
        events.push({ key: `ho-${h.id}`, kind: 'hotel-out', hotel: h, sortMs: naiveMillis(h.check_out_datetime), dayKey: naiveDayKey(h.check_out_datetime), iso: h.check_out_datetime });
      }
      if (h.free_cancellation_until) {
        events.push({ key: `hc-${h.id}`, kind: 'hotel-cancel', hotel: h, sortMs: naiveMillis(h.free_cancellation_until), dayKey: naiveDayKey(h.free_cancellation_until), iso: h.free_cancellation_until });
      }
    }

    // --- Activities ---
    for (const a of activities) {
      if (!a.start_datetime) continue;
      events.push({ key: `a-${a.id}`, kind: 'activity', activity: a, sortMs: naiveMillis(a.start_datetime), dayKey: naiveDayKey(a.start_datetime), iso: a.start_datetime });
    }

    // --- Transfers (group multi-segment routes) ---
    const transfersByPair = new Map();
    for (const tr of transfers) {
      if (!tr.start_datetime) continue;
      const pairKey = `${tr.from_city_visit_id || '_'}->${tr.to_city_visit_id || '_'}`;
      if (!transfersByPair.has(pairKey)) transfersByPair.set(pairKey, []);
      transfersByPair.get(pairKey).push(tr);
    }
    for (const [pairKey, list] of transfersByPair) {
      list.sort((a, b) => naiveMillis(a.start_datetime) - naiveMillis(b.start_datetime));
      const earliest = list[0];
      const sortMs = naiveMillis(earliest.start_datetime);
      const dayKey = naiveDayKey(earliest.start_datetime);
      if (list.length > 1) {
        events.push({ key: `trgrp-${pairKey}`, kind: 'transfer-group', transfers: list, sortMs, dayKey, iso: earliest.start_datetime });
      } else {
        events.push({ key: `tr-${earliest.id}`, kind: 'transfer', transfer: earliest, sortMs, dayKey, iso: earliest.start_datetime });
      }
    }

    // --- Car rentals ---
    for (const s of carRentals) {
      const d = s.details || {};
      if (d.pickup_at_local) {
        events.push({ key: `cr-in-${s.id}`, kind: 'car-pickup', service: s, sortMs: naiveMillis(d.pickup_at_local), dayKey: naiveDayKey(d.pickup_at_local), iso: d.pickup_at_local });
      }
      if (d.dropoff_at_local) {
        events.push({ key: `cr-out-${s.id}`, kind: 'car-dropoff', service: s, sortMs: naiveMillis(d.dropoff_at_local), dayKey: naiveDayKey(d.dropoff_at_local), iso: d.dropoff_at_local });
      }
    }

    // Secondary sort key: city cards render before hotel-in/hotel-out of the same
    // visit, even when timestamps are identical or very close.
    const subOrder = (ev) => {
      if (ev.kind === 'anchor' && ev.visit?.kind === 'start') return -100;
      if (ev.kind === 'transfer' || ev.kind === 'transfer-group') return 1;
      if (ev.kind === 'city') return 2;
      if (ev.kind === 'car-pickup') return 3;
      if (ev.kind === 'hotel-cancel') return 4;
      if (ev.kind === 'hotel-in') return 10;
      if (ev.kind === 'hotel-out') return 11;
      if (ev.kind === 'activity') return 20;
      if (ev.kind === 'car-dropoff') return 21;
      if (ev.kind === 'anchor' && ev.visit?.kind === 'end') return 100;
      return 50;
    };
    events.sort((a, b) => {
      const diff = a.sortMs - b.sortMs;
      if (diff !== 0) return diff;
      return subOrder(a) - subOrder(b);
    });
    return events;
  }, [ordered, hotels, activities, transfers, carRentals, inboundByVisit]);

  // Set of day keys that have at least one real event in the stream.
  const eventDayKeys = useMemo(() => {
    const set = new Set();
    for (const ev of stream) if (ev.dayKey) set.add(ev.dayKey);
    return set;
  }, [stream]);

  // Resolve the trip's date range - used to fill in "empty day" placeholders
  // between events. Priority:
  //   1. trip.start_date / trip.end_date if both present
  //   2. otherwise: min/max dayKey across the stream
  const tripRangeDays = useMemo(() => {
    let firstKey = null;
    let lastKey = null;

    if (trip?.start_date && trip?.end_date) {
      firstKey = trip.start_date;       // already "yyyy-LL-dd"
      lastKey = trip.end_date;
    } else if (eventDayKeys.size > 0) {
      // Fallback: derive range only from "core" events (city arrivals and
      // transfers), NOT from cancellation deadlines / hotel dates that can
      // precede the actual trip - otherwise we'd generate empty-day placeholders
      // for every day between an early cancellation deadline and the first city.
      const coreDayKeys = stream
        .filter(ev => ev.dayKey && (ev.kind === 'city' || ev.kind === 'transfer' || ev.kind === 'transfer-group'))
        .map(ev => ev.dayKey)
        .sort();
      const allSorted = [...eventDayKeys].sort();
      firstKey = coreDayKeys.length > 0 ? coreDayKeys[0] : allSorted[0];
      lastKey = allSorted[allSorted.length - 1];
    }
    if (!firstKey || !lastKey) return [];

    const start = DateTime.fromISO(firstKey);
    const end = DateTime.fromISO(lastKey);
    if (!start.isValid || !end.isValid || end < start) return [];

    const out = [];
    let cur = start.startOf('day');
    const stop = end.startOf('day');
    while (cur <= stop) {
      out.push(cur.toFormat('yyyy-LL-dd'));
      cur = cur.plus({ days: 1 });
    }
    return out;
  }, [trip?.start_date, trip?.end_date, eventDayKeys]);

  // Detect "missing transfer" pairs (including last transit city → end anchor).
  const missingTransferByVisitId = useMemo(() => {
    const map = {};
    for (let i = 0; i < ordered.length; i++) {
      const v = ordered[i];
      const prev = ordered[i - 1];
      if (!prev) continue;
      if (v.kind === 'start') continue;
      // Skip transit→transit if the prev is 'start' (no transfer needed from start anchor)
      if (prev.kind === 'start' && v.kind !== 'end') continue;
      const inboundFromPrev = (inboundByVisit[v.id] || []).filter((tr) => tr.from_city_visit_id === prev.id);
      if (inboundFromPrev.length === 0) {
        map[v.id] = { fromVisit: prev, toVisit: v };
      }
    }
    return map;
  }, [ordered, inboundByVisit]);

  // Tell the mini-calendar which days have content.
  useEffect(() => {
    if (!onDaysChange) return;
    const map = {};
    for (const ev of stream) {
      if (!ev.dayKey) continue;
      const entry = map[ev.dayKey] || (map[ev.dayKey] = {});
      if (ev.kind === 'city') entry.hasVisit = true;
      if (ev.kind === 'hotel-in' || ev.kind === 'hotel-out') entry.hasHotel = true;
      if (ev.kind === 'transfer' || ev.kind === 'transfer-group') entry.hasTransfer = true;
      if (ev.kind === 'activity') entry.hasActivity = true;
      if (ev.kind === 'car-pickup' || ev.kind === 'car-dropoff') entry.hasService = true;
    }
    onDaysChange(map);
  }, [stream]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (!selectedDayKey) return;
    const el = dayRefs.current[selectedDayKey];
    if (el) el.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }, [selectedDayKey]);

  // Group events by dayKey for easier rendering of empty days.
  const eventsByDay = useMemo(() => {
    const map = {};
    for (const ev of stream) {
      if (!ev.dayKey) continue;
      (map[ev.dayKey] ||= []).push(ev);
    }
    return map;
  }, [stream]);

  // Start anchors (no day) render at the top; end anchors (no day) render at bottom.
  const datelessStartAnchors = useMemo(() => stream.filter((ev) => ev.dayKey == null && ev.visit?.kind === 'start'), [stream]);
  const datelessEndAnchors = useMemo(() => stream.filter((ev) => ev.dayKey == null && ev.visit?.kind === 'end'), [stream]);

  // Final day list:
  // - All trip range days (with empty-day placeholders)
  // - Plus event days that fall OUTSIDE the trip range (e.g. cancellation deadline before trip start)
  // Events outside the range are shown, but no empty-day placeholders are added for days without events.
  const tripStartKey = trip?.start_date || null;
  const tripEndKey = trip?.end_date || null;
  const allDayKeys = useMemo(() => {
    const set = new Set(tripRangeDays); // already covers start→end with empties
    for (const k of eventDayKeys) {
      // Always include days that have real events, even outside trip range
      set.add(k);
    }
    return [...set].sort();
  }, [tripRangeDays, eventDayKeys]);

  if (ordered.length === 0) return <EmptyTripCTA canEdit={canEdit} onAddCity={onAddCityForDay} />;

  const out = [];
  const emittedMissingForVisit = new Set();

  // Render dateless start-anchor(s) at the very top.
  for (const ev of datelessStartAnchors) {
    out.push(
      <EventRowWrapper
        key={ev.key}
        ev={ev}
        dayRefs={dayRefs}
        selectedDayKey={selectedDayKey}
        visitsById={visitsById}
        hotelsByVisit={hotelsByVisit}
        cityIndexById={cityIndexById}
        canEdit={canEdit}
        onAddHotel={onAddHotel}
        onEditVisitNotes={onEditVisitNotes}
        onClickHotel={onClickHotel}
        onClickTransfer={onClickTransfer}
        onClickActivity={onClickActivity}
        onClickCarRental={onClickCarRental}
      />
    );
  }

  const tripRangeDaySet = new Set(tripRangeDays);

  for (const dayKey of allDayKeys) {
    const dayEvents = eventsByDay[dayKey] || [];
    const firstIso = dayEvents[0]?.iso || dayKey;

    // Skip separator+placeholder for days outside trip range that have no events
    if (dayEvents.length === 0 && !tripRangeDaySet.has(dayKey)) continue;

    out.push(<DaySeparator key={`sep-${dayKey}`} iso={firstIso} locale={locale} weather={weatherByDay[dayKey]} />);

    if (dayEvents.length === 0) {
      out.push(<EmptyDayCard key={`empty-${dayKey}`} />);
      if (isEditMode) {
        out.push(
          <AddDayButton
            key={`add-${dayKey}`}
            dayKey={dayKey}
            onAddCity={onAddCityForDay}
            onAddActivity={onAddActivityForDay}
          />
        );
      }
      continue;
    }

    for (const ev of dayEvents) {
      // Missing transfer warn right before city/anchor-end if applicable
      if (showBookingWarnings
          && (ev.kind === 'city' || (ev.kind === 'anchor' && ev.visit.kind === 'end'))
          && missingTransferByVisitId[ev.visit.id]
          && !emittedMissingForVisit.has(ev.visit.id)) {
        const m = missingTransferByVisitId[ev.visit.id];
        out.push(
          <MissingTransferWarn
            key={`miss-${ev.visit.id}`}
            fromVisit={m.fromVisit}
            toVisit={m.toVisit}
            canEdit={canEdit}
            onAddTransfer={onAddTransfer}
          />
        );
        emittedMissingForVisit.add(ev.visit.id);
      }

      out.push(
        <EventRowWrapper
          key={ev.key}
          ev={ev}
          dayRefs={dayRefs}
          selectedDayKey={selectedDayKey}
          visitsById={visitsById}
          hotelsByVisit={hotelsByVisit}
          cityIndexById={cityIndexById}
          canEdit={canEdit}
          onAddHotel={onAddHotel}
          onEditVisitNotes={onEditVisitNotes}
          onClickHotel={onClickHotel}
          onClickTransfer={onClickTransfer}
          onClickActivity={onClickActivity}
          onClickCarRental={onClickCarRental}
        />
      );
    }

    // Edit mode: "+ Добавить" button at the end of each day
    if (isEditMode) {
      out.push(
        <AddDayButton
          key={`add-${dayKey}`}
          dayKey={dayKey}
          onAddCity={onAddCityForDay}
          onAddActivity={onAddActivityForDay}
        />
      );
    }
  }

  // Render dateless end-anchor(s) at the very bottom (after all day loops).
  for (const ev of datelessEndAnchors) {
    // Show missing-transfer warning before end anchor if applicable
    if (showBookingWarnings && missingTransferByVisitId[ev.visit.id] && !emittedMissingForVisit.has(ev.visit.id)) {
      const m = missingTransferByVisitId[ev.visit.id];
      out.push(
        <MissingTransferWarn
          key={`miss-${ev.visit.id}`}
          fromVisit={m.fromVisit}
          toVisit={m.toVisit}
          canEdit={canEdit}
          onAddTransfer={onAddTransfer}
        />
      );
      emittedMissingForVisit.add(ev.visit.id);
    }
    out.push(
      <EventRowWrapper
        key={ev.key}
        ev={ev}
        dayRefs={dayRefs}
        selectedDayKey={selectedDayKey}
        visitsById={visitsById}
        hotelsByVisit={hotelsByVisit}
        cityIndexById={cityIndexById}
        canEdit={canEdit}
        onAddHotel={onAddHotel}
        onEditVisitNotes={onEditVisitNotes}
        onClickHotel={onClickHotel}
        onClickTransfer={onClickTransfer}
        onClickActivity={onClickActivity}
        onClickCarRental={onClickCarRental}
      />
    );
  }

  return (
    <div ref={containerRef}>
      <div className="space-y-3">{out}</div>
    </div>
  );
}

/* --------------------------- Event row wrapper --------------------------- */

function EventRowWrapper({
  ev, dayRefs, selectedDayKey, visitsById, hotelsByVisit, cityIndexById,
  canEdit, onAddHotel, onEditVisitNotes,
  onClickHotel, onClickTransfer, onClickActivity, onClickCarRental,
}) {
  const isSelected = ev.dayKey && selectedDayKey === ev.dayKey;
  const refCb = (el) => { if (el && ev.dayKey && !dayRefs.current[ev.dayKey]) dayRefs.current[ev.dayKey] = el; };

  if (ev.kind === 'anchor') {
    return (
      <div ref={refCb} className={`scroll-mt-24 ${isSelected ? 'ring-2 ring-primary rounded-2xl p-2 -m-2' : ''}`}>
        <AnchorReadCard visit={ev.visit} />
      </div>
    );
  }

  if (ev.kind === 'city') {
    return (
      <div
        ref={refCb}
        className={`scroll-mt-24 ${isSelected ? 'ring-2 ring-primary rounded-2xl p-2 -m-2' : ''}`}
      >
        <CityHeaderCard
          visit={ev.visit}
          hotels={hotelsByVisit[ev.visit.id] || []}
          cityIndex={cityIndexById[ev.visit.id]}
          onClickHotel={onClickHotel}
          canEdit={canEdit}
          onAddHotel={onAddHotel}
          onEditVisitNotes={onEditVisitNotes}
        />
      </div>
    );
  }

  return (
    <div
      ref={refCb}
      className={`scroll-mt-24 ${isSelected ? 'ring-2 ring-primary rounded-2xl p-2 -m-2' : ''}`}
    >
      <DayEventRow
        event={ev}
        visitsById={visitsById}
        onClickTransfer={onClickTransfer}
        onClickActivity={onClickActivity}
        onClickHotel={onClickHotel}
        onClickCarRental={onClickCarRental}
      />
    </div>
  );
}

/* --------------------------- Small parts --------------------------- */

function transferDuration(startIso, endIso) {
  if (!startIso || !endIso) return '';
  const a = parseNaive(startIso);
  const b = parseNaive(endIso);
  if (!a || !b) return '';
  const mins = Math.round((b.toMillis() - a.toMillis()) / 60000);
  if (mins <= 0) return '';
  if (mins < 60) return `${mins}m`;
  const h = Math.floor(mins / 60), m = mins % 60;
  return m ? `${h}h ${m}m` : `${h}h`;
}

/**
 * Big day header used as a separator between events of different days.
 *   8 ИЮЛ  ср
 * Display-font day+month in bold, weekday in muted small text next to it.
 */
function DaySeparator({ iso, locale, weather }) {
  const { t } = useI18nFormat();
  const dt = parseNaive(iso);
  if (!dt) return null;
  const dayMonth = dt.setLocale(locale).toFormat('d LLL').replace('.', '');
  const weekday = dt.setLocale(locale).toFormat('ccc').replace('.', '');
  
  // Check if this is today
  const today = DateTime.now().toFormat('yyyy-LL-dd');
  const dayKey = dt.toFormat('yyyy-LL-dd');
  const isToday = dayKey === today;
  
  return (
    <div className="sticky top-14 z-10 bg-background/95 backdrop-blur-sm pt-3 pb-2 flex items-end gap-2.5 border-b-2 border-border">
      <span className={`font-display font-bold text-2xl sm:text-[26px] leading-none tracking-tight uppercase ${isToday ? 'text-primary' : ''}`}>
        {dayMonth}
      </span>
      <span className="text-sm text-muted-foreground leading-none mb-px">{weekday}</span>
      {isToday && (
        <span className="inline-flex items-center px-2 py-0.5 rounded-full bg-primary/10 text-xs font-medium text-primary leading-none mb-px">
          {t('view.today')}
        </span>
      )}
      {weather && (
        <span className="ml-0.5 inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-secondary text-xs font-medium text-foreground/80 leading-none mb-px">
          <span>{weather.icon}</span>
          <span className="tabular-nums">{weather.temp_max}°</span>
        </span>
      )}
    </div>
  );
}

function EmptyDayCard() {
  const { t } = useI18nFormat();
  return (
    <div className="rounded-2xl border border-dashed border-border bg-card/40 px-4 py-3 flex items-center gap-2 text-sm text-muted-foreground">
      <Info className="w-4 h-4 shrink-0" />
      <span>{t('view.empty_day')}</span>
    </div>
  );
}

function MissingTransferWarn({ fromVisit, toVisit, canEdit, onAddTransfer }) {
  const { t } = useI18nFormat();
  return (
    <div className="rounded-2xl border border-dashed border-orange-200 dark:border-orange-900/50 bg-orange-50/60 dark:bg-orange-950/15 px-3 py-2.5 flex items-center gap-3">
      <div className="w-10 h-10 rounded-lg bg-orange-100 dark:bg-orange-950/40 flex items-center justify-center shrink-0">
        <Send className="w-4 h-4 text-orange-500 dark:text-orange-300" />
      </div>
      <div className="min-w-0 flex-1">
        <div className="text-sm font-semibold text-orange-700 dark:text-orange-200">{t('view.missing_transfer_title')}</div>
        <div className="text-xs text-orange-600/80 dark:text-orange-300/80 break-words">
          {fromVisit?.city_name || '-'} → {toVisit?.city_name || '-'}
        </div>
      </div>
      {canEdit && (
        <AddTransferButton fromVisit={fromVisit} toVisit={toVisit} onManual={onAddTransfer} />
      )}
    </div>
  );
}

function CityHeaderCard({ visit, hotels, onClickHotel, canEdit, onAddHotel, onEditVisitNotes, cityIndex }) {
  const { plural, locale } = useI18nFormat();
  const start = parseNaive(visit.start_date);
  const end = parseNaive(visit.end_date);
  const nights = start && end ? Math.max(0, Math.round(end.diff(start, 'days').days)) : 0;

  return (
    <div className="rounded-2xl border bg-card overflow-hidden">
      {/* Header: image flush-left, text right. Image has no padding - rounded only on top-left. */}
      <div className="flex flex-row min-h-[96px]">
        {/* Image - no outer padding, rounded-tl-2xl only */}
        <div className="w-28 sm:w-36 shrink-0 self-stretch rounded-tl-2xl overflow-hidden">
          <CityHero visit={visit} className="h-full w-full rounded-tl-2xl" />
        </div>

        {/* Text block */}
        <div className="flex-1 min-w-0 flex flex-col justify-center px-4 py-3 relative">
          {visit.country && (
            <div className="text-[10px] font-semibold uppercase tracking-widest text-primary flex items-center gap-1 mb-0.5">
              <MapPin className="w-2.5 h-2.5 shrink-0" />
              {visit.country.toUpperCase()}
            </div>
          )}
          <div className="font-display font-bold text-xl sm:text-2xl leading-tight flex items-baseline gap-2 flex-wrap">
            <span className="truncate">{visit.city_name}</span>
            {start && end && (
              <span className="text-sm font-normal text-muted-foreground whitespace-nowrap">
                {start.setLocale(locale).toFormat('d LLL')} → {end.setLocale(locale).toFormat('d LLL')}
                {nights > 0 ? ` · ${nights} ${plural(nights, 'view.nights')}` : ''}
              </span>
            )}
          </div>
          {cityIndex && (
            <div className="absolute top-2.5 right-3 text-xs text-muted-foreground font-medium tabular-nums">
              #{cityIndex}
            </div>
          )}
        </div>
      </div>

      <StaySectionExpandable
        visit={visit}
        hotels={hotels}
        onClickHotel={onClickHotel}
        canEdit={canEdit}
        onAddHotel={onAddHotel}
      />

      {visit.notes && (
        <div className="px-4 pb-4 pt-3 border-t">
          <CityNotesBlock
            notes={visit.notes}
            canEdit={canEdit}
            onEdit={() => onEditVisitNotes?.(visit)}
          />
        </div>
      )}
    </div>
  );
}

/* --------------------------- Day event rows --------------------------- */

function DayEventRow({ event, visitsById = {}, onClickTransfer, onClickActivity, onClickHotel, onClickCarRental }) {
  const { t } = useI18nFormat();
  const time = formatNaive(event.iso, 'HH:mm');

  if (event.kind === 'car-pickup' || event.kind === 'car-dropoff') {
    const s = event.service;
    const details = s?.details || {};
    const provider = details.booking_platform ? BOOKING_PLATFORMS[details.booking_platform] : null;
    const providerLabel = (provider && details.booking_platform !== 'other' ? provider.label : null) || s?.name || t('car.fallback_name');
    const isPickup = event.kind === 'car-pickup';
    const label = isPickup ? t('car.pickup_event') : t('car.dropoff_event');
    return (
      <button
        type="button"
        onClick={() => onClickCarRental?.(s)}
        className="block w-full text-left hover:opacity-90 transition"
      >
        <EventShell time={time} tone="car" icon={<Car className="w-4 h-4" />}>
          <div className="text-sm font-medium flex items-center gap-1.5 flex-wrap">
            <span>{label}</span>
            <ArrowRight className="w-3 h-3 text-muted-foreground" />
            <span className="text-muted-foreground font-normal">{providerLabel}</span>
          </div>
        </EventShell>
      </button>
    );
  }

  if (event.kind === 'transfer-group') {
    const list = event.transfers || [];
    const fromV = visitsById[list[0]?.from_city_visit_id];
    const toV = visitsById[list[0]?.to_city_visit_id];
    return (
      <TransferGroupReadOnly
        fromVisit={fromV}
        toVisit={toV}
        transfers={list}
        time={parseNaive(event.iso)}
        onClickTransfer={onClickTransfer}
      />
    );
  }

  if (event.kind === 'activity') {
    const a = event.activity;
    return (
      <button
        type="button"
        onClick={() => onClickActivity?.(a)}
        className="block w-full text-left hover:opacity-90 transition"
      >
        <EventShell time={time} tone="activity" icon={<Camera className="w-4 h-4" />}>
          <RowContent
            title={a.title}
            subtitle={[
              a.end_datetime ? t('view.until_time', { time: formatNaive(a.end_datetime, 'HH:mm') }) : null,
            ].filter(Boolean).join(' · ')}
          />
        </EventShell>
      </button>
    );
  }

  if (event.kind === 'transfer') {
    const tr = event.transfer;
    const info = transportInfo(tr.transport_type);
    const TIcon = info.Icon;
    const platformInfo = tr.booking_platform ? BOOKING_PLATFORMS[tr.booking_platform] : null;
    const platformLogo = platformLogoUrl(tr.booking_platform, tr.booking_url);
    const fromV = visitsById[tr.from_city_visit_id];
    const toV = visitsById[tr.to_city_visit_id];
    const dur = transferDuration(tr.start_datetime, tr.end_datetime);
    const bookingUrl = normalizeExternalUrl(tr.booking_url);
    return (
      <button
        type="button"
        onClick={() => onClickTransfer?.(tr)}
        className="block w-full text-left hover:opacity-90 transition"
      >
        <EventShell time={time} tone="transfer" icon={<TIcon className="w-4 h-4" />}>
          <div className="min-w-0">
            <div className="text-sm font-medium flex items-center gap-1.5 flex-wrap">
              <span>{fromV?.city_name || '-'}</span>
              <ArrowRight className="w-3 h-3 text-muted-foreground" />
              <span>{toV?.city_name || '-'}</span>
              {tr.carrier && <span className="text-xs text-muted-foreground font-normal">· {tr.carrier}</span>}
            </div>
            <div className="text-[11px] text-muted-foreground">
              {tr.start_datetime ? formatNaive(tr.start_datetime, 'd LLL HH:mm') : '-'}
              {' → '}
              {tr.end_datetime ? formatNaive(tr.end_datetime, 'd LLL HH:mm') : '-'}
              {dur ? ` · ${dur}` : ''}
            </div>
            {bookingUrl && (
              <div className="mt-1.5" onClick={(e) => e.stopPropagation()}>
                <a
                  href={bookingUrl}
                  target="_blank"
                  rel="noreferrer"
                  className="inline-flex items-center gap-1.5 px-2 py-0.5 rounded text-[11px] font-medium bg-background hover:bg-secondary border border-border transition"
                >
                  {platformLogo ? <img src={platformLogo} alt="" className="w-3 h-3 rounded-sm" /> : <ExternalLink className="w-3 h-3" />}
                  {platformInfo && tr.booking_platform !== 'other' ? platformInfo.label : t('view.view_booking')}
                </a>
              </div>
            )}
          </div>
        </EventShell>
      </button>
    );
  }

  if (event.kind === 'hotel-cancel') {
    const h = event.hotel;
    return (
      <button
        type="button"
        onClick={() => onClickHotel?.(h)}
        className="block w-full text-left hover:opacity-90 transition"
      >
        <EventShell time={time} tone="cancel" icon={<CalendarX className="w-4 h-4" />}>
          <RowContent title={`${t('view.cancellation_deadline')}: ${h.name}`} subtitle={h.address || ''} />
        </EventShell>
      </button>
    );
  }

  // hotel check-in / check-out
  const h = event.hotel;
  const isIn = event.kind === 'hotel-in';
  const Icon = isIn ? LogIn : LogOut;
  const label = isIn ? t('view.checkin') : t('view.checkout');
  return (
    <button
      type="button"
      onClick={() => onClickHotel?.(h)}
      className="block w-full text-left hover:opacity-90 transition"
    >
      <EventShell time={time} tone="hotel" icon={<Icon className="w-4 h-4" />}>
        <RowContent title={`${label}: ${h.name}`} subtitle={h.address || ''} />
      </EventShell>
    </button>
  );
}

/**
 * Standard event card. Layout: [time chip] [icon] [content].
 * Icons live INSIDE the card (no vertical rail).
 */
function EventShell({ time, tone, icon, children }) {
  const iconBg =
    tone === 'transfer' ? 'bg-blue-100 text-blue-600 dark:bg-blue-950/40 dark:text-blue-300' :
    tone === 'activity' ? 'bg-violet-100 text-violet-700 dark:bg-violet-950/40 dark:text-violet-300' :
    tone === 'cancel'   ? 'bg-rose-100 text-rose-600 dark:bg-rose-950/40 dark:text-rose-300' :
    tone === 'car'      ? 'bg-emerald-100 text-emerald-700 dark:bg-emerald-950/40 dark:text-emerald-300' :
                          'bg-blue-100 text-blue-600 dark:bg-blue-950/40 dark:text-blue-300';

  const cardBg =
    tone === 'transfer' ? 'bg-blue-50/50 dark:bg-blue-950/15 border-blue-100/80 dark:border-blue-900/40' :
                          'bg-card border-border';

  return (
    <div className={`flex items-center gap-3 px-4 py-3 rounded-2xl border ${cardBg}`}>
      <div className="shrink-0 w-12 text-right tabular-nums text-sm font-medium text-muted-foreground">
        {time}
      </div>
      <div className={`shrink-0 w-9 h-9 rounded-lg flex items-center justify-center ${iconBg}`}>
        {icon}
      </div>
      <div className="flex-1 min-w-0">{children}</div>
    </div>
  );
}

function RowContent({ title, subtitle }) {
  return (
    <>
      <div className="text-sm font-medium truncate">{title}</div>
      {subtitle && <div className="text-[11px] text-muted-foreground truncate">{subtitle}</div>}
    </>
  );
}

/* --------------------------- Anchors --------------------------- */

/**
 * Start / End anchor card. No left rail circle - the icon lives inside the
 * card on the left, just like other events.
 */
function AnchorReadCard({ visit }) {
  const { t } = useI18nFormat();
  const isStart = visit.kind === 'start';
  const Icon = isStart ? Plane : Flag;
  const tone = isStart
    ? 'bg-emerald-100 text-emerald-700 dark:bg-emerald-950/40 dark:text-emerald-300'
    : 'bg-rose-100 text-rose-700 dark:bg-rose-950/40 dark:text-rose-300';
  return (
    <div className="rounded-2xl border bg-card p-4 flex items-center gap-3">
      <div className={`shrink-0 w-10 h-10 rounded-lg flex items-center justify-center ${tone}`}>
        <Icon className="w-4 h-4" />
      </div>
      <div className="flex-1 min-w-0">
        <div className="text-[11px] uppercase tracking-[0.14em] text-muted-foreground font-semibold">
          {isStart ? t('visit.kind_start') : t('visit.kind_end')}
        </div>
        <div className="font-display font-bold text-xl sm:text-2xl flex items-center gap-2 mt-0.5">
          <span className="truncate">{visit.city_name}{visit.country ? `, ${visit.country}` : ''}</span>
          {visit.country_code && <span className="text-xl leading-none shrink-0">{countryFlag(visit.country_code)}</span>}
        </div>
      </div>
    </div>
  );
}

function EmptyTripCTA({ canEdit = true, onAddCity }) {
  const { t } = useI18nFormat();
  if (!canEdit) {
    return (
      <div className="text-center py-16 border-2 border-dashed border-border rounded-2xl bg-card">
        <MapPin className="w-10 h-10 mx-auto text-muted-foreground mb-3" />
        <h3 className="font-semibold mb-1">{t('view.empty_title')}</h3>
        <p className="text-sm text-muted-foreground">{t('view.empty_member')}</p>
      </div>
    );
  }
  return (
    <div className="rounded-2xl overflow-hidden border border-primary/20">
      {/* Light theme */}
      <div className="dark:hidden rounded-2xl bg-gradient-to-br from-blue-50 via-blue-100 to-blue-50">
        <div className="py-12 px-6 text-center">
          <div className="mx-auto mb-6 w-16 h-16 rounded-2xl bg-primary flex items-center justify-center shadow-lg shadow-primary/30">
            <svg className="w-8 h-8 text-white" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
              <circle cx="12" cy="12" r="10" />
              <line x1="2" y1="12" x2="22" y2="12" />
              <path d="M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z" />
            </svg>
          </div>
          <h3 className="font-display font-bold text-xl mb-2 text-foreground">{t('view.empty_title')}</h3>
          <p className="text-sm text-muted-foreground max-w-xs mx-auto mb-7 leading-relaxed">{t('view.empty_owner')}</p>
          <div className="flex items-center justify-center gap-3 flex-wrap">
            <Button size="lg" className="shadow-md shadow-primary/25 gap-2 bg-primary hover:bg-primary/90" onClick={onAddCity}>
              <Plus className="w-4 h-4" />{t('view.add_first_city')}
            </Button>
            <Button size="lg" variant="outline" className="gap-2 border-violet-200 bg-violet-50 text-violet-700 hover:bg-violet-100">
              <Sparkles className="w-4 h-4 text-violet-600" />{t('view.start_with_ai')}
            </Button>
          </div>
        </div>
      </div>
      {/* Dark theme */}
      <div className="hidden dark:block rounded-2xl bg-gradient-to-br from-slate-800 via-slate-750 to-slate-800">
        <div className="py-12 px-6 text-center">
          <div className="mx-auto mb-6 w-16 h-16 rounded-2xl bg-primary flex items-center justify-center shadow-lg shadow-primary/30">
            <svg className="w-8 h-8 text-white" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
              <circle cx="12" cy="12" r="10" />
              <line x1="2" y1="12" x2="22" y2="12" />
              <path d="M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z" />
            </svg>
          </div>
          <h3 className="font-display font-bold text-xl mb-2 text-white">{t('view.empty_title')}</h3>
          <p className="text-sm text-slate-300 max-w-xs mx-auto mb-7 leading-relaxed">{t('view.empty_owner')}</p>
          <div className="flex items-center justify-center gap-3 flex-wrap">
            <Button size="lg" className="shadow-md shadow-primary/25 gap-2 bg-primary hover:bg-primary/90" onClick={onAddCity}>
              <Plus className="w-4 h-4" />{t('view.add_first_city')}
            </Button>
            <Button size="lg" variant="outline" className="gap-2 border-violet-700 bg-violet-900/40 text-violet-300 hover:bg-violet-900/60">
              <Sparkles className="w-4 h-4 text-violet-400" />{t('view.start_with_ai')}
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
}

/* --------------------------- Edit mode "Add" button per day --------------------------- */

function AddDayButton({ dayKey, onAddCity, onAddActivity }) {
  const { t } = useI18nFormat();
  const [open, setOpen] = useState(false);

  return (
    <div className="flex items-center gap-2 flex-wrap">
      <button
        type="button"
        onClick={() => setOpen(o => !o)}
        className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl border border-dashed border-border text-sm text-muted-foreground hover:text-foreground hover:border-border/80 hover:bg-secondary/60 transition"
      >
        <Plus className="w-3.5 h-3.5" />{t('view.add_event')}
      </button>
      {open && (
        <>
          <button
            type="button"
            onClick={() => { onAddCity?.(dayKey); }}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl border border-border bg-card text-sm font-medium hover:bg-secondary transition"
          >
            <MapPin className="w-3.5 h-3.5 text-muted-foreground" />
            {t('view.add_city')}
          </button>
          <button
            type="button"
            onClick={() => { onAddActivity?.(dayKey); }}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl border border-border bg-card text-sm font-medium hover:bg-secondary transition"
          >
            <Sparkles className="w-3.5 h-3.5 text-muted-foreground" />
            {t('view.add_activity')}
          </button>
        </>
      )}
    </div>
  );
}

function groupBy(list, keyFn) {
  const m = {};
  for (const x of list) {
    const k = keyFn(x);
    (m[k] ||= []).push(x);
  }
  return m;
}