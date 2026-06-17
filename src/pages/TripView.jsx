import React, { useMemo, useState, useEffect, useRef } from 'react';
import { useParams, useNavigate, useSearchParams } from 'react-router-dom';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { getWeather, weatherInfo } from '@/lib/weather';

import { supabase } from '@/api/supabaseClient';
import { useAuth } from '@/lib/AuthContext';
import { TRIP_SHELL_KEY, TRIP_CONTENT_KEY } from '@/lib/trip-data';
import { naiveDayKey, parseNaive, formatNaive } from '@/lib/naive-time';
import { formatTripRange, isTripInPast } from '@/lib/trip-dates';
import { isProActive, useTripProStatus } from '@/lib/subscription';
import ProUpsellModal from '@/components/common/ProUpsellModal';
import { isAddonEnabled } from '@/lib/tripAddons';
import { isLensVisible } from '@/lib/tripMenu';
import TripSidebar, { TripSidebarSheet } from '@/components/trips/TripSidebar';
import AppHeader from '@/components/AppHeader';
import { useMobileNav } from '@/components/MobileBottomNav';
import { Sheet } from '@/components/ui/Sheet';
import ShareDialog from '@/components/trips/ShareDialog';
import { useTheme } from '@/lib/ThemeContext';
import { Icon } from '../design/icons';
import { Btn, Dialog, EmptyState, Skeleton, fmtDate, weekdayLong, StreamEventRow } from '../design/index';
import { SystemStub } from '@/lib/PageNotFound';
import { sortVisits, cityIdentity } from '@/lib/validation';
import { useToast } from '@/components/ui/use-toast';
import { ActionMenu } from '@/components/ui/ActionMenu';
import { DateTime } from 'luxon';
import EventEditDialog from '@/components/common/EventEditDialog';
import SourceViewLoader from '../components/budget/SourceViewLoader';
import ForkPartnerModal from '@/components/bookings/ForkPartnerModal';
import OverviewLens from './OverviewLens';
import BudgetLens, { AddExpenseDialog } from './BudgetLens';
import MembersLens, { InviteDialog } from './MembersLens';
import CalendarLens from './CalendarLens';
import DocsLens, { AddDocDialog } from './DocsLens';
import SettingsLens from './SettingsLens';
import ChatLens from './ChatLens';
import { budgetCategoryOptions } from '@/lib/budget/constants';
import { uniqueCityCount } from '@/lib/trip-cities';
import ChatWidget from '@/components/chat/ChatWidget';
import ScreenMap from '@/pages/ScreenMap';
import { useI18n } from '@/lib/i18n/I18nContext';
import '../design/app.css';

// ─── helpers ──────────────────────────────────────────────────────────────────

// Stored datetimes are naive wall-clock, local to each endpoint city. For a
// transfer across timezones, pass fromTz/toTz (CityVisit.timezone) so the
// duration reflects real elapsed time; same-city events omit them (naive diff).
function formatDuration(t, start, end, fromTz, toTz) {
  const s = parseNaive(start);
  const e = parseNaive(end);
  if (!s || !e) return null;
  let mins = null;
  if (fromTz && toTz && fromTz !== toTz) {
    const dep = s.setZone(fromTz, { keepLocalTime: true });
    const arr = e.setZone(toTz, { keepLocalTime: true });
    if (dep.isValid && arr.isValid) mins = Math.round((arr.toMillis() - dep.toMillis()) / 60000);
  }
  if (mins === null) mins = Math.round(e.diff(s, 'minutes').minutes);
  if (mins <= 0) return null;
  const h = Math.floor(mins / 60);
  const m = mins % 60;
  if (h === 0) return t('trip.dur_m', { m });
  if (m === 0) return t('trip.dur_h', { h });
  return t('trip.dur_hm', { h, m });
}

function cityForVisit(visitId, visits) {
  const v = visits.find(v => v.id === visitId);
  return v ? v.city_name : null;
}

export function buildEventStream(t, hotels = [], activities = [], transfers = [], visits = [], services = []) {
  const events = [];

  // Car-rental services (kind='car_rental') become two point events on the
  // timeline: pickup + return (their local datetimes drive placement).
  for (const s of (services || [])) {
    if (s.kind !== 'car_rental') continue;
    const name = s.name || t('service.kind.car_rental');
    const pickup = s.pickup_at_local || s.details?.pickup_at_local;
    const dropoff = s.dropoff_at_local || s.details?.dropoff_at_local;
    if (pickup) {
      events.push({
        type: 'car-pickup', id: s.id,
        date: naiveDayKey(pickup), time: formatNaive(pickup, 'HH:mm'),
        title: name, address: s.pickup_address || s.details?.pickup_address || '',
        price: s.price ?? null, cur: s.currency,
        _ms: parseNaive(pickup)?.toMillis() ?? 0,
      });
    }
    if (dropoff) {
      events.push({
        type: 'car-return', id: s.id,
        date: naiveDayKey(dropoff), time: formatNaive(dropoff, 'HH:mm'),
        title: name, address: s.dropoff_address || s.details?.dropoff_address || '',
        price: null, cur: s.currency,
        _ms: parseNaive(dropoff)?.toMillis() ?? 0,
      });
    }
  }

  for (const h of hotels) {
    const city = h.city_name || cityForVisit(h.city_visit_id, visits) || '';
    if (h.check_in_datetime) {
      events.push({
        type: 'hotel-checkin',
        id: 'h-in-' + h.id,
        cityVisitId: h.city_visit_id,
        date: naiveDayKey(h.check_in_datetime),
        time: formatNaive(h.check_in_datetime, 'HH:mm'),
        city,
        title: t('trip.hotel_check_in') + ' · ' + h.name,
        hotel: h.name,
        hotelId: h.id,
        price: h.price,
        cur: h.currency,
        nights: h.nights,
        platformUrl: h.booking_url,
        num: h.booking_reference,
        _ms: parseNaive(h.check_in_datetime)?.toMillis() ?? 0,
      });
    }
    if (h.check_out_datetime) {
      events.push({
        type: 'hotel-checkout',
        id: 'h-out-' + h.id,
        cityVisitId: h.city_visit_id,
        date: naiveDayKey(h.check_out_datetime),
        time: formatNaive(h.check_out_datetime, 'HH:mm'),
        city,
        title: t('trip.hotel_check_out') + ' · ' + h.name,
        hotelId: h.id,
        _ms: parseNaive(h.check_out_datetime)?.toMillis() ?? 0,
      });
    }
    // Free-cancellation deadline - point event styled by StreamEventRow's
    // `hotel-deadline` branch (rose accent + warning icon).
    if (h.free_cancellation && h.free_cancellation_until) {
      events.push({
        type: 'hotel-deadline',
        id: 'h-cancel-' + h.id,
        cityVisitId: h.city_visit_id,
        date: naiveDayKey(h.free_cancellation_until),
        time: formatNaive(h.free_cancellation_until, 'HH:mm'),
        city,
        title: t('trip.hotel_free_cancel') + ' · ' + h.name,
        hotelId: h.id,
        price: h.price,
        cur: h.currency,
        _ms: parseNaive(h.free_cancellation_until)?.toMillis() ?? 0,
      });
    }
  }

  for (const a of activities) {
    const city = a.city_name || cityForVisit(a.city_visit_id, visits) || '';
    events.push({
      type: 'activity',
      id: a.id,
      date: naiveDayKey(a.start_datetime),
      time: formatNaive(a.start_datetime, 'HH:mm'),
      city,
      title: a.title,
      price: a.price,
      cur: a.currency,
      category: a.category,
      address: a.location_address,
      duration: a.end_datetime ? formatDuration(t, a.start_datetime, a.end_datetime) : null,
      // Naive clock end (HH:mm) — used by the calendar week-view to size blocks
      // by real duration instead of a fixed guess.
      endTime: a.end_datetime ? formatNaive(a.end_datetime, 'HH:mm') : null,
      _ms: parseNaive(a.start_datetime)?.toMillis() ?? 0,
    });
  }

  for (const tr of transfers) {
    const kind = tr.transport_type || tr.kind || 'car';
    const isPlane = kind === 'plane';
    // The transfer plaque renders in its DEPARTURE day. With an explicit
    // start_datetime that's its own day; without one (e.g. created via the
    // ManualPlanner transport step) anchor to the from-visit's last day - the
    // day you leave - falling back to the to-visit's arrival day only when there
    // is no dated from-city (e.g. a leg out of the dateless start anchor).
    const explicitDate = naiveDayKey(tr.start_datetime);
    const toVisit = visits.find(v => v.id === tr.to_city_visit_id);
    const fromVisit = visits.find(v => v.id === tr.from_city_visit_id);
    const fallbackDate = (fromVisit && naiveDayKey(fromVisit.end_date))
      || (toVisit && naiveDayKey(toVisit.start_date))
      || null;
    const eventDate = explicitDate || fallbackDate;
    const eventMs = parseNaive(tr.start_datetime)?.toMillis()
      ?? parseNaive(fromVisit?.end_date)?.toMillis()
      ?? parseNaive(toVisit?.start_date)?.toMillis()
      ?? 0;
    events.push({
      type: isPlane ? 'flight' : 'transfer',
      id: tr.id,
      date: eventDate,
      time: formatNaive(tr.start_datetime, 'HH:mm'),
      title: tr.carrier || (isPlane ? t('trip.tl_flight') : t('trip.tl_transfer')),
      from: cityForVisit(tr.from_city_visit_id, visits) || tr.from_address,
      to: cityForVisit(tr.to_city_visit_id, visits) || tr.to_address,
      from_address: tr.from_address || null,
      to_address: tr.to_address || null,
      kind,
      carrier: tr.carrier,
      num: tr.booking_reference,
      price: tr.price,
      cur: tr.currency,
      platformUrl: tr.booking_url,
      duration: tr.end_datetime ? formatDuration(t, tr.start_datetime, tr.end_datetime, visits.find(v => v.id === tr.from_city_visit_id)?.timezone, visits.find(v => v.id === tr.to_city_visit_id)?.timezone) : null,
      endTime: tr.end_datetime ? formatNaive(tr.end_datetime, 'HH:mm') : null,
      _ms: eventMs,
    });
  }

  return events
    .filter(e => e.date)
    .sort((a, b) => a._ms - b._ms);
}

// ─── LoadingScreen / ErrorScreen ──────────────────────────────────────────────

function LoadingScreen({ lens = 'overview' }) {
  const { t } = useI18n();
  return (
    <div className="trip-shell">
      {/* Skeleton unified top bar (brand gradient) */}
      <header className="app-header app-header--trip">
        <div className="app-header__left">
          <div className="app-header__brand">
            <span className="app-header__logo"><img src="/triplanio-logo.svg" alt="Triplanio" /></span>
            <span className="app-header__brand-name">Triplanio</span>
          </div>
          <span className="app-header__vdiv" />
          <div className="app-header__trip">
            <Skeleton w={190} h={18} r={6} style={{ marginBottom: 6 }} />
            <Skeleton w={150} h={12} r={5} />
          </div>
        </div>
        <div className="app-header__right">
          <Skeleton w={32} h={32} r={999} />
        </div>
      </header>
      <div className="trip-body">
        {/* Skeleton sidebar */}
        <aside className="app-side">
          <div className="app-side__group">
            <div className="app-side__group-label">{t('trip.sections_title')}</div>
            {[1, 2, 3, 4, 5, 6].map(i => (
              <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '8px 10px' }}>
                <Skeleton w={15} h={15} r={4} />
                <Skeleton w={80 + (i % 3) * 15} h={12} r={4} />
              </div>
            ))}
          </div>
          <div className="app-side__group">
            <div className="app-side__group-label">{t('trip_menu.section_manage')}</div>
            {[1, 2, 3, 4].map(i => (
              <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '8px 10px' }}>
                <Skeleton w={15} h={15} r={4} />
                <Skeleton w={70 + (i % 3) * 10} h={12} r={4} />
              </div>
            ))}
          </div>
        </aside>
        <div className="trip-content">
          <main className="trip-screen-body">
            {/* Same building blocks as the loaded layout, so nothing reshuffles
                when shell → content resolves. Lens-aware so the Overview (default)
                doesn't flash a timeline skeleton first. */}
            {lens === 'overview' ? (
              <OverviewLens isLoading />
            ) : (
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 260px', gap: 24, alignItems: 'start' }}>
                <SkeletonTimeline />
                <RightRailSkeleton />
              </div>
            )}
          </main>
        </div>
      </div>
    </div>
  );
}

function ErrorScreen({ onBack }) {
  const { t } = useI18n();
  const nav = useNavigate();
  const { logout } = useAuth();
  const loginOther = async () => {
    try { await logout?.(false); } catch { /* ignore */ }
    nav('/login');
  };
  return (
    <div style={{ minHeight: '100vh', background: 'var(--bg)' }}>
      <SystemStub
        icon="lock"
        tone="warm"
        title={t('trip.no_access_title')}
        body={t('trip.no_access_desc')}
        primary={{ label: t('trip.to_my_trips'), onClick: onBack }}
        secondary={{ label: t('trip.login_other'), onClick: loginOther }}
      />
    </div>
  );
}

// ─── TripHeader ───────────────────────────────────────────────────────────────



// ─── TimelineLens ─────────────────────────────────────────────────────────────

function SkeletonTimeline() {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 18 }}>
      {[1, 2, 3].map(g => (
        <div key={g}>
          <Skeleton w={120} h={14} r={6} style={{ marginBottom: 12 }} />
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            {[1, 2].map(i => (
              <div key={i} style={{ background: 'var(--surface)', border: '1px solid var(--line)', borderRadius: 12, padding: '12px 14px', display: 'flex', gap: 14, alignItems: 'center' }}>
                <Skeleton w={52} h={16} r={4} />
                <Skeleton w={32} h={32} r={8} />
                <div style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: 6 }}>
                  <Skeleton w="60%" h={13} r={4} />
                  <Skeleton w="40%" h={11} r={4} />
                </div>
              </div>
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}

// Right-rail (Services) placeholder — budget/who's-going moved to the Overview
// screen, so the timeline rail now skeletons only the Services widget.
function RightRailSkeleton() {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
      <Skeleton w="100%" h={150} r={14} />
    </div>
  );
}

// Build a sorted array of all days between start and end (inclusive), 'yyyy-MM-dd'
function buildDayList(startIso, endIso) {
  const days = [];
  let cur = parseNaive(startIso);
  const end = parseNaive(endIso);
  if (!cur || !end) return days;
  while (cur <= end) {
    days.push(naiveDayKey(cur.toISO()));
    cur = cur.plus({ days: 1 });
  }
  return days;
}

// ─── StreamAnchor ─────────────────────────────────────────────────────────────

function StreamAnchor({ label, sub, color, icon }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 14, margin: '16px 0', paddingLeft: 8 }}>
      <div style={{ width: 28, height: 28, borderRadius: '50%', background: color, color: 'white', display: 'grid', placeItems: 'center', flexShrink: 0 }}>
        <Icon name={icon} size={13} />
      </div>
      <div>
        <div style={{ fontWeight: 600, fontSize: 'var(--fs-strong)' }}>{label}</div>
        {sub && <div className="muted" style={{ fontSize: 'var(--fs-meta)' }}>{sub}</div>}
      </div>
    </div>
  );
}

// ─── MissingTransferWarning ───────────────────────────────────────────────────

function MissingTransferWarning({ from, to, fromVisit, toVisit, onAdd }) {
  const { t } = useI18n();
  const [hidden, setHidden] = useState(false);
  if (hidden) return null;
  return (
    <div style={{
      display: 'flex', alignItems: 'center', gap: 12,
      padding: '12px 14px', background: 'var(--warning-soft)',
      border: '1.5px dashed var(--warning)', borderRadius: 12,
      marginBottom: 8,
    }}>
      <Icon name="warning" size={16} style={{ color: 'var(--warning)', flexShrink: 0 }} />
      <div style={{ flex: 1, fontSize: 'var(--fs-base)', fontWeight: 600 }}>
        {t('trip.no_transfer', { from, to })}
      </div>
      <Btn variant="primary" size="sm" icon="plus" onClick={() => onAdd?.(fromVisit, toVisit)}>{t('trip.add_transfer')}</Btn>
      <button onClick={() => setHidden(true)} style={{ width: 24, height: 24, borderRadius: 6, border: 'none', background: 'transparent', color: 'var(--warning)', cursor: 'pointer', display: 'grid', placeItems: 'center' }}>
        <Icon name="close" size={12} />
      </button>
    </div>
  );
}

// ─── CityHero (with proper hotel warning) ────────────────────────────────────

// Fetch daily weather for all transit visits → { [dayKey]: { icon, temp } }.
// Open-Meteo returns up to ~16 days ahead; past days yield nothing.
function useWeatherByDay(visits) {
  const [weatherByDay, setWeatherByDay] = useState({});
  useEffect(() => {
    const transit = (visits || []).filter(v => v.kind !== 'start' && v.kind !== 'end' && v.latitude && v.longitude && v.start_date && v.end_date);
    if (transit.length === 0) { setWeatherByDay({}); return; }
    let cancelled = false;
    (async () => {
      const map = {};
      for (const v of transit) {
        const res = await getWeather(v.latitude, v.longitude, naiveDayKey(v.start_date), naiveDayKey(v.end_date)).catch(() => null);
        if (cancelled || !res?.daily) continue;
        const { time, weather_code, temperature_2m_max } = res.daily;
        (time || []).forEach((d, i) => {
          map[d] = { icon: weatherInfo(weather_code?.[i]).icon, temp: Math.round(temperature_2m_max?.[i] ?? 0) };
        });
      }
      if (!cancelled) setWeatherByDay(map);
    })();
    return () => { cancelled = true; };
  }, [visits]); // eslint-disable-line react-hooks/exhaustive-deps
  return weatherByDay;
}


function TimelineLens({ stream, visits, transfers, trip, isLoading, onAddTransfer, onAddHotel, onAddActivityForDay, onEditVisitNotes, onOpenEvent, onDeleteCity, isViewer = false }) {
  const { t, lang } = useI18n();
  const weatherByDay = useWeatherByDay(visits);  // hook must run before any early return

  // Auto-scroll to today's day when the timeline opens — but only if today falls
  // inside the rendered range (otherwise the #tlday element doesn't exist and
  // this is a no-op). Runs once per mount, after the day rows have painted.
  const didScrollTodayRef = useRef(false);
  useEffect(() => {
    if (didScrollTodayRef.current) return;
    const n = new Date();
    const todayKey = `${n.getFullYear()}-${String(n.getMonth() + 1).padStart(2, '0')}-${String(n.getDate()).padStart(2, '0')}`;
    const el = document.getElementById(`tlday-${todayKey}`);
    if (!el) return;
    didScrollTodayRef.current = true;
    requestAnimationFrame(() => el.scrollIntoView({ behavior: 'smooth', block: 'start' }));
  }, [isLoading, stream, visits]);

  if (isLoading) return <SkeletonTimeline />;

  // Show missing-transfer / missing-hotel hints only when (a) the trip-level
  // toggle is on (default on) AND (b) the current user can act on them. Viewers
  // (Зрители) never see them - they can't add bookings, so it's just noise that
  // exposes planning gaps.
  const showBookingWarnings = !isViewer && trip?.details?.display?.booking_warnings !== false;

  if (!trip.start_date && !trip.end_date && !visits.length) {
    return (
      <EmptyState
        icon="list"
        title={t('trip.timeline_empty_title')}
        body={t('trip.timeline_empty_desc')}
      />
    );
  }

  // Determine timeline bounds. Start/end anchors are pure markers and have
  // no datetimes - derive the trip range from the first/last TRANSIT visit
  // (the cities the user actually stays in). Falls back to trip.start_date /
  // trip.end_date when there are no transits with dates.
  const datedTransits = sortVisits(visits)
    .filter(v => v.kind !== 'start' && v.kind !== 'end' && v.start_date && v.end_date);
  const transitStart = datedTransits.length ? naiveDayKey(datedTransits[0].start_date) : null;
  const transitEnd = datedTransits.length ? naiveDayKey(datedTransits[datedTransits.length - 1].end_date) : null;
  const tripStart = transitStart || trip.start_date || null;
  const tripEnd = transitEnd || trip.end_date || null;

  if (!tripStart || !tripEnd) {
    return (
      <EmptyState
        icon="list"
        title={t('trip.no_dates_title')}
        body={t('trip.no_dates_desc')}
      />
    );
  }

  // Build event lookup by date
  const eventsByDate = {};
  for (const e of stream) {
    if (!eventsByDate[e.date]) eventsByDate[e.date] = [];
    eventsByDate[e.date].push(e);
  }

  const days = buildDayList(tripStart, tripEnd);

  // Sort visits using kind field (start anchor → transit cities → end anchor),
  // via sortVisits logic from validation.js
  const ordered = sortVisits(visits);

  // Build inbound transfer lookup: toVisitId → [transfer, ...]
  const inboundByVisit = {};
  for (const tr of (transfers || [])) {
    const tid = tr.to_city_visit_id;
    if (tid) {
      if (!inboundByVisit[tid]) inboundByVisit[tid] = [];
      inboundByVisit[tid].push(tr);
    }
  }

  // One ordered walk of TRANSIT cities drives BOTH the render order and the
  // transfer/warning pairing - so a warning's "from" is always the city shown
  // directly above it (a single source of order, no per-day visit lookup that
  // could diverge from it). Anchors are rendered separately as StreamAnchor.
  const transitCities = ordered.filter(v => v.kind !== 'start' && v.kind !== 'end');

  const hasTransferBetween = (prev, city) =>
    !!prev && (inboundByVisit[city.id] || []).some(tr => tr.from_city_visit_id === prev.id);

  // Transfer plaques now render inline in their own DEPARTURE day (buildEvent
  // Stream sets `date` = departure day). They are no longer pulled into the
  // arrival block, so nothing is excluded from the day stream.
  const inboundEventIds = new Set();

  // Renders one city's arrival block: [transfer card | missing-transfer warning]
  // then the CityHero. `prev` = the previously-rendered city (or start anchor).
  const renderArrival = (city, prev) => {
    const out = [];
    // Only the missing-transfer warning lives in the arrival block now; the
    // transfer plaque itself renders in its own departure day (in the day
    // stream), not above the destination city.
    if (prev && cityIdentity(prev) !== cityIdentity(city) && !hasTransferBetween(prev, city)) {
      if (showBookingWarnings) out.push(
        <div key={`mt-${city.id}`} style={{ marginBottom: 8 }}>
          <MissingTransferWarning
            from={prev.city_name} to={city.city_name}
            fromVisit={prev} toVisit={city} onAdd={onAddTransfer}
          />
        </div>
      );
    }
    return out;
  };

  // Out-of-range event days. An event whose date falls before the first trip
  // day or after the last (e.g. a free-cancellation deadline that lands days
  // before the trip starts) has no bucket in `days` and would be silently
  // dropped. Render it as its own plain day block - pre-trip days above the
  // start anchor, post-trip days after the end anchor - so the event's own day
  // shows, then the start city, then the trip days.
  const tripDaySet = new Set(days);
  const outOfRangeDays = [...new Set(
    stream.map(e => e.date).filter(d => d && !tripDaySet.has(d))
  )].sort();
  const preTripDays = outOfRangeDays.filter(d => d < tripStart);
  const postTripDays = outOfRangeDays.filter(d => d > tripEnd);

  const renderEventsDay = (day) => {
    const evs = (eventsByDate[day] || []).filter(e => !inboundEventIds.has(e.id));
    if (evs.length === 0) return null;
    const dd = new Date(`${day}T00:00`);
    const dayNum = Number.isNaN(dd.getTime()) ? day.slice(8, 10) : dd.getDate();
    const monAbbr = Number.isNaN(dd.getTime()) ? '' : dd.toLocaleDateString(lang, { month: 'short' }).replace('.', '');
    return (
      <div key={`xday-${day}`} id={`tlday-${day}`} data-tlday={day} className="tl3-day">
        <div className="tl3-dh">
          <span className="datechip"><span className="d">{dayNum}</span><span className="m">{monAbbr}</span></span>
          <span className="wd">{weekdayLong(day, lang)}</span>
        </div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          {evs.map((e, idx) => (
            <StreamEventRow key={e.id} e={e} last={idx === evs.length - 1} onClick={() => onOpenEvent?.(e)} />
          ))}
        </div>
      </div>
    );
  };

  const rows = [];
  const _tnow = new Date();
  const todayKey = `${_tnow.getFullYear()}-${String(_tnow.getMonth() + 1).padStart(2, '0')}-${String(_tnow.getDate()).padStart(2, '0')}`;
  // Running predecessor across the whole itinerary walk (seed = start anchor).
  let prevCity = ordered[0]?.kind === 'start' ? ordered[0] : null;

  // Pre-trip event days (e.g. a cancellation deadline before the trip starts).
  for (const d of preTripDays) rows.push(renderEventsDay(d));

  // Start anchor
  const startCity = ordered[0]?.city_name || t('ai_plan.start_badge');
  const endCity   = ordered[ordered.length - 1]?.city_name || t('ai_plan.end_badge');
  rows.push(
    <StreamAnchor
      key="anchor-start"
      label={t('trip.start_city', { city: startCity })}
      sub={fmtDate(tripStart, lang)}
      color="var(--brand)"
      icon="flag"
    />
  );

  for (const day of days) {
    // All transit cities ARRIVING this day (by start day), in itinerary order.
    // Multiple cities can arrive the same day (e.g. a one-day pass-through that
    // shares its single day with the previous and next city).
    const arrivingToday = transitCities.filter(c => naiveDayKey(c.start_date) === day);

    // Header cities = every real (non-waypoint) transit city whose range covers
    // this day, in itinerary order. Most days have one; a pass-through/transition
    // day can list two (e.g. "Madrid · Barcelona"). Waypoints (0-night layovers)
    // are intentionally excluded from the header.
    const dayCities = transitCities.filter(c => {
      if (c.kind === 'waypoint') return false;
      const s = naiveDayKey(c.start_date), e = naiveDayKey(c.end_date);
      return s && e && day >= s && day <= e;
    });
    // data-city drives the CityRail active-state observer → point it at the
    // current (last) real city of the day so it maps to a rail station.
    const dayCity = dayCities[dayCities.length - 1] || null;

    const allDayEvents = eventsByDate[day] || [];
    const dayEvents = allDayEvents.filter(e => !inboundEventIds.has(e.id));

    const _dd = new Date(`${day}T00:00`);
    const _dayNum = Number.isNaN(_dd.getTime()) ? day.slice(8, 10) : _dd.getDate();
    const _monAbbr = Number.isNaN(_dd.getTime()) ? '' : _dd.toLocaleDateString(lang, { month: 'short' }).replace('.', '');
    const _isToday = day === todayKey;
    rows.push(
      <div key={`day-${day}`} id={`tlday-${day}`} data-tlday={day} data-city={dayCity?.id || ''} className={`tl3-day${_isToday ? ' today' : ''}`}>
        {/* Date header — datechip on the left; weekday + weather on the first
            line, the day's real cities (waypoints excluded) tucked underneath. */}
        <div className="tl3-dh">
          <span className="datechip"><span className="d">{_dayNum}</span><span className="m">{_monAbbr}</span></span>
          <div className="tl3-dhx">
            <div className="tl3-dhrow">
              <span className="wd">{weekdayLong(day, lang)}</span>
              {_isToday && <span className="tl3-today">{t('view.today')}</span>}
              {weatherByDay[day] && (
                <span className="wthr"><span>{weatherByDay[day].icon}</span><span>{weatherByDay[day].temp}°</span></span>
              )}
            </div>
            {dayCities.length > 0 && (
              <span className="daycity"><Icon name="pin" size={13} />{dayCities.map(c => c.city_name).join(' · ')}</span>
            )}
          </div>
        </div>

        {/* Intra-day order = chronological. Each arriving city's block
            [transfer card | missing-transfer warning] + CityHero is anchored to
            its inbound transfer's time (or the city's start when there is no
            transfer). Day events earlier than the first arrival anchor render
            ABOVE the block(s); the rest render below. This keeps e.g. a hotel
            checkout (11:00) above a same-day onward flight (12:20) instead of
            being forced under the new city's hero. Arrival blocks keep their
            itinerary order, which drives the prevCity transfer/warning pairing. */}
        {(() => {
          const blocks = arrivingToday.map(c => ({
            // The arrival block (warning only) anchors at the city's start; the
            // transfer plaque no longer lives here.
            anchorMs: parseNaive(c.start_date)?.toMillis() ?? Number.NEGATIVE_INFINITY,
            city: c,
          }));
          const firstAnchorMs = blocks.length
            ? Math.min(...blocks.map(b => b.anchorMs))
            : Number.POSITIVE_INFINITY;
          const sorted = [...dayEvents].sort((a, b) => (a._ms ?? 0) - (b._ms ?? 0));
          const beforeEvents = sorted.filter(e => (e._ms ?? 0) < firstAnchorMs);
          const afterEvents = sorted.filter(e => (e._ms ?? 0) >= firstAnchorMs);
          const blockNodes = blocks.flatMap(b => {
            const n = renderArrival(b.city, prevCity);
            prevCity = b.city;
            return n;
          });
          const eventList = (list, mb) => (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8, ...(mb ? { marginBottom: 8 } : null) }}>
              {list.map((e, idx) => (
                <StreamEventRow key={e.id} e={e} last={idx === list.length - 1} onClick={() => onOpenEvent?.(e)} />
              ))}
            </div>
          );
          const hasAny = beforeEvents.length || afterEvents.length || blockNodes.length;
          return (
            <>
              {beforeEvents.length > 0 && eventList(beforeEvents, true)}
              {blockNodes}
              {afterEvents.length > 0 && eventList(afterEvents, false)}
              {/* Empty-day placeholder. (The city hero used to fill arrival days;
                  with it removed, any day with no transfer block and no events
                  shows the placeholder.) */}
              {!hasAny && (
                <div style={{
                  display: 'flex', alignItems: 'center', gap: 12,
                  padding: '10px 14px',
                  background: 'transparent', border: '1.5px dashed var(--line)',
                  borderRadius: 10, color: 'var(--muted)',
                }}>
                  <Icon name="info" size={14} />
                  <div style={{ flex: 1, fontSize: 'var(--fs-meta)' }}>{t('view.empty_day')}</div>
                </div>
              )}
            </>
          );
        })()}
      </div>
    );
  }

  // Leg INTO the finish anchor (last rendered city → end). If a transfer covers
  // it, render the transfer card(s); otherwise show the missing-transfer warning.
  const endVisit = ordered[ordered.length - 1];
  if (endVisit && endVisit.kind === 'end' && prevCity && prevCity.id !== endVisit.id
      && cityIdentity(prevCity) !== cityIdentity(endVisit)) {
    // The transfer into the finish anchor renders in its own departure day now;
    // here we only surface the missing-transfer warning when there is none.
    if (!hasTransferBetween(prevCity, endVisit) && showBookingWarnings) {
      rows.push(
        <div key="mt-end" style={{ marginBottom: 8 }}>
          <MissingTransferWarning
            from={prevCity.city_name} to={endVisit.city_name}
            fromVisit={prevCity} toVisit={endVisit} onAdd={onAddTransfer}
          />
        </div>
      );
    }
  }

  // End anchor
  rows.push(
    <StreamAnchor
      key="anchor-end"
      label={t('trip.finish_city', { city: endCity })}
      sub={fmtDate(tripEnd, lang)}
      color="var(--ink-2)"
      icon="check"
    />
  );

  // Post-trip event days (e.g. a deadline that lands after the last trip day).
  for (const d of postTripDays) rows.push(renderEventsDay(d));

  return <div className="tl3">{rows}</div>;
}

// ─── CityRail ─────────────────────────────────────────────────────────────────
// Right column of the timeline: the route's cities as scroll-rail "stations".
// Highlights the city whose day is currently scrolled into view (Intersection
// Observer on the .tl3-day anchors), and clicking a city scrolls the timeline to
// that city's first day.
function CityRail({ visits = [], scrollRef }) {
  const { t, lang } = useI18n();
  const cities = useMemo(
    () => sortVisits(visits).filter(v => v.kind !== 'start' && v.kind !== 'end' && v.kind !== 'waypoint'),
    [visits],
  );
  const [activeId, setActiveId] = useState(null);

  useEffect(() => {
    const root = scrollRef?.current;
    if (!root || cities.length === 0) return undefined;
    const dayEls = Array.from(root.querySelectorAll('[data-tlday]'));
    if (dayEls.length === 0) return undefined;
    const obs = new IntersectionObserver((entries) => {
      const vis = entries.filter(e => e.isIntersecting)
        .sort((a, b) => a.boundingClientRect.top - b.boundingClientRect.top);
      const cid = vis[0]?.target.getAttribute('data-city');
      if (cid) setActiveId(cid);
    }, { root, rootMargin: '-8% 0px -72% 0px', threshold: 0 });
    dayEls.forEach(el => obs.observe(el));
    return () => obs.disconnect();
  }, [cities, scrollRef]);

  if (cities.length === 0) return null;

  const go = (city) => {
    const day = naiveDayKey(city.start_date);
    const el = scrollRef?.current?.querySelector(`#tlday-${CSS.escape(String(day))}`);
    if (el) el.scrollIntoView({ behavior: 'smooth', block: 'start' });
  };
  const nights = (city) => {
    const s = parseNaive(city.start_date), e = parseNaive(city.end_date);
    if (!s || !e) return 0;
    return Math.max(0, Math.round(e.diff(s, 'days').days));
  };

  return (
    <div className="cityrail" style={{ position: 'sticky', top: 8 }}>
      <div className="cr-h">{t('overview.stat_cities')}</div>
      {cities.map((c) => {
        const n = nights(c);
        const range = c.start_date ? formatTripRange([c], '–') : '';
        return (
          <button key={c.id} className={'cr-item' + (activeId === c.id ? ' on' : '')} onClick={() => go(c)}>
            <span className="cr-rail"><span className="cr-dot" /><span className="cr-line" /></span>
            <span className="cr-bd">
              <span className="cr-nm" style={{ display: 'block', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{c.city_name}</span>
              <span className="cr-dt">{range}{n > 0 ? ` · ${n} ${t('overview.unit_nights')}` : ''}</span>
            </span>
          </button>
        );
      })}
    </div>
  );
}

// ─── Share / More dialogs ─────────────────────────────────────────────────────


// ─── ContextSide ──────────────────────────────────────────────────────────────

// Timeline right rail. Budget + "who's going" moved to the Overview screen
// (BudgetSummaryCard / MembersSummaryCard); the rail now carries only Services.
// ─── TripView (main export) ───────────────────────────────────────────────────

export default function TripView() {
  const { t } = useI18n();
  const { tripId } = useParams();
  const nav = useNavigate();
  const qc = useQueryClient();
  const [searchParams, setSearchParams] = useSearchParams();
  const { user } = useAuth();
  const { toast } = useToast();
  const [copyingTrip, setCopyingTrip] = useState(false);
  const lens = searchParams.get('lens') || 'overview';

  const { isDark, toggle: toggleTheme } = useTheme();
  // Choice dialogs (ForkPartnerModal) - sit between the warning button and the
  // edit form so the user can pick a partner before falling back to manual entry.
  const [hotelChoice, setHotelChoice] = useState({ open: false, visit: null });
  const [transferChoice, setTransferChoice] = useState({ open: false, fromVisit: null, toVisit: null });
  // Manual hotel/transfer create opened in-place (live-edit, TRIP-138) instead
  // of redirecting into the structure editor.
  const [manualEvt, setManualEvt] = useState({ open: false, kind: null, visit: null, fromVisit: null, toVisit: null });
  // Right-rail service add - opens ForkPartnerModal for the chosen kind, then
  // routes to the right edit dialog when the user picks "Manual".
  const [serviceChoice, setServiceChoice] = useState({ open: false, type: null });
  const [serviceEditCar, setServiceEditCar] = useState({ open: false });
  // serviceSimple: CREATE form for a new esim/insurance (viewing existing ones
  // goes through the unified SourceViewLoader like every other event).
  const [serviceSimple, setServiceSimple] = useState({ open: false, kind: null });
  // City add/edit/delete moved entirely to the Structure editor (/trip/:id/edit).
  const [activityEdit, setActivityEdit] = useState({ open: false, visit: null, activity: null, defaultStart: null });
  const [eventView, setEventView] = useState({ open: false, kind: null, id: null });
  const openUpgrade = () => nav(`/pro?tripId=${tripId}`);
  // Stripe-return success/fail modal is handled globally by <StripeReturnModals>.

  // Open the read/edit dialog for a timeline event (hotel / transfer / activity)
  const openEventView = (e) => {
    // Car-rental pickup/return → open the car service VIEW (not edit) like any other event.
    if (e.type === 'car-pickup' || e.type === 'car-return') {
      const svc = (services || []).find(s => s.id === e.id);
      if (svc) setEventView({ open: true, kind: 'service', id: svc.id, warning: null });
      return;
    }
    let kind = null;
    if (e.type === 'hotel-checkin' || e.type === 'hotel-checkout' || e.type === 'hotel-deadline') kind = 'hotel';
    else if (e.type === 'activity') kind = 'activity';
    else if (e.type === 'transfer' || e.type === 'flight') kind = 'transfer';
    if (!kind) return;
    const id = kind === 'hotel' ? e.hotelId : e.id;
    if (!id) return;
    setEventView({ open: true, kind, id, warning: null });
  };

  // Wire window.__navigate so Screen components can navigate
  useEffect(() => {
    window.__navigate = (target) => {
      if (target === 'collection') { nav('/trips'); return; }
      if (target === 'ai-planner') { nav('/plan-trip-ai'); return; }
      const lensIds = ['overview', 'timeline', 'map', 'calendar', 'budget', 'docs', 'members', 'settings', 'chat'];
      if (lensIds.includes(target)) {
        const sp = new URLSearchParams(searchParams);
        // overview is the default lens → drop the param; everything else sets it.
        if (target === 'overview') sp.delete('lens'); else sp.set('lens', target);
        setSearchParams(sp, { replace: false });
      }
    };
    return () => { window.__navigate = undefined; };
  }, [tripId, nav, searchParams, setSearchParams]);

  const setLens = (id) => {
    const sp = new URLSearchParams(searchParams);
    if (id === 'overview') sp.delete('lens'); else sp.set('lens', id);
    setSearchParams(sp, { replace: false });
    setSideOpen(false); // close the mobile sidebar after navigating
  };

  // Fetch shell (trip + cityVisits)
  const { data: shellData, isLoading: loadingShell, error: shellError } = useQuery({
    queryKey: TRIP_SHELL_KEY(tripId),
    queryFn: async () => {
      const { data, error } = await supabase.functions.invoke('getTripDetails', {
        body: { tripId, include: ['shell'] },
      });
      if (error) throw error;
      return data;
    },
    enabled: !!tripId,
  });

  // Fetch content (hotels, activities, transfers) - only after shell resolves
  const { data: contentData, isLoading: loadingContent } = useQuery({
    queryKey: TRIP_CONTENT_KEY(tripId),
    queryFn: async () => {
      const { data, error } = await supabase.functions.invoke('getTripDetails', {
        body: { tripId, include: ['content', 'budget'] },
      });
      if (error) throw error;
      return data;
    },
    enabled: !!tripId && !loadingShell,
  });

  const trip             = shellData?.trip;
  const visits           = shellData?.cityVisits     || [];
  const hotels           = contentData?.hotels       || [];
  const activities       = contentData?.activities   || [];
  const transfers        = contentData?.transfers    || [];
  const members          = contentData?.members      || [];
  const services         = contentData?.services     || [];
  const budget           = contentData?.budget       || null;
  const budgetCategories = contentData?.budgetCategories || [];
  const budgetExpenses   = contentData?.budgetExpenses   || [];

  // Resolve current user's role in this trip
  const myMember = members.find(m => m.user_id === user?.id);
  const myRole   = myMember?.role || (trip?.created_by === user?.id ? 'owner' : 'viewer');

  const stream = useMemo(
    () => buildEventStream(t, hotels, activities, transfers, visits, services),
    [t, hotels, activities, transfers, visits, services],
  );

  // Unified engine: same validateTrip that powers Edit Mode, collapsed to <=1
  // issue per entity so the timeline panel never piles up duplicates.
  // Account-level Pro (header chip). For IN-TRIP gating use tripIsPro below.
  const accountPro = isProActive(user);
  const isOwner = myRole === 'owner';

  // Trip-level Pro (owner-aware), resolved via a shared CACHED hook so it doesn't
  // re-flash when crossing the edit↔trip route boundary. See useTripProStatus.
  const { isPro: tripIsPro, resolved: tripProResolved } = useTripProStatus(tripId, trip?.is_pro_trip);
  // Edit Mode (structure editor) gate - exact current model (TRIP_EDIT_MODE_TZ §2):
  // anyone but a viewer; past trips require the trip to be Pro (or owner Pro).
  const canEditMode = myRole !== 'viewer' && (!isTripInPast(visits) || tripIsPro);
  const [tripProInfoOpen, setTripProInfoOpen] = useState(false);
  const [shareOpen, setShareOpen] = useState(false);
  const [budgetAddonOff, setBudgetAddonOff] = useState(false);
  // Global trip-header state: mobile sidebar, and the right-hand actions the
  // active lens projects into the screen-title bar. (Trip name + cover editing
  // moved into the Settings lens; the metadata modal was retired.)
  const [sideOpen, setSideOpen] = useState(false);
  // Mobile bottom-nav bridge: the global nav's "…" opens this menu sheet and its
  // central "+" opens the add sheet below. Intent drives auto-opening the add
  // dialog of the lens we navigate to.
  const { setTripCtx } = useMobileNav();
  const [addOpen, setAddOpen] = useState(false);
  const [addModal, setAddModal] = useState(null); // null | 'expense' | 'docs' | 'members' — trip-level create dialog opened by the bottom-nav "+"
  useEffect(() => {
    setTripCtx({ openMenu: () => setSideOpen(true), openAdd: () => setAddOpen(true) });
    return () => setTripCtx(null);
  }, [setTripCtx]);
  // Phones (≤640px) get the menu as a bottom-sheet instead of the slide-in
  // drawer; the drawer + its scrim are suppressed at this breakpoint in CSS.
  const [isPhone, setIsPhone] = useState(() => typeof window !== 'undefined' && window.matchMedia('(max-width: 640px)').matches);
  useEffect(() => {
    const mq = window.matchMedia('(max-width: 640px)');
    const onChange = () => setIsPhone(mq.matches);
    mq.addEventListener('change', onChange);
    return () => mq.removeEventListener('change', onChange);
  }, []);

  // If the URL points at a lens the trip has disabled, fall back to the timeline.
  // Viewers can't open Settings/Members even by deep link → fall back too.
  // Viewers may open Settings (read-only — see SettingsLens `readOnly`) so they
  // can leave the trip; Members stays owner/admin-only. (TRIP-137)
  const VIEWER_BLOCKED_LENSES = new Set(['members']);
  let shownLens = isLensVisible(trip, lens) ? lens : 'overview';
  if (myRole === 'viewer' && VIEWER_BLOCKED_LENSES.has(shownLens)) shownLens = 'overview';

  // The screen body is a persistent scroll container (the shell doesn't scroll),
  // so reset it to the top whenever the active lens changes.
  const screenBodyRef = useRef(null);
  useEffect(() => { if (screenBodyRef.current) screenBodyRef.current.scrollTop = 0; }, [shownLens]);

  if (loadingShell) return <LoadingScreen lens={new URLSearchParams(window.location.search).get('lens') || 'overview'} />;
  if (shellError || (!loadingShell && !trip)) return <ErrorScreen onBack={() => nav('/trips')} />;

  // ── Global trip header: cover, subtitle and the right-hand hero actions ──
  // (Share / Edit / "…"). Cover priority mirrors the old cover strip: uploaded
  // photo → preset gradient → default waves. All dialogs open via the global
  // modal mount, so they work from any lens.
  const dateRange = formatTripRange(visits, '-');
  const cityCount = uniqueCityCount(visits);
  // Trip length in nights, rendered with the day-word — same meta as the editor
  // header (dates · days · cities).
  const tripNights = (() => {
    const starts = visits.map((v) => v.start_date).filter(Boolean).sort();
    const ends = visits.map((v) => v.end_date).filter(Boolean).sort();
    const s = starts[0] || trip?.start_date;
    const e = ends[ends.length - 1] || trip?.end_date;
    if (!s || !e) return null;
    const n = Math.round(DateTime.fromISO(e).diff(DateTime.fromISO(s), 'days').days);
    return n >= 0 ? n : null;
  })();
  const dayWord = (n) => (n === 1 ? t('tse.day_one') : n >= 2 && n <= 4 ? t('tse.day_few') : t('tse.day_many'));
  const heroSub = (
    <>
      {dateRange && dateRange !== '-' && <span>{dateRange}</span>}
      {tripNights != null && (
        <><span>·</span><span>{tripNights} {dayWord(tripNights)}</span></>
      )}
      {cityCount > 0 && (
        <><span>·</span><span>{cityCount} {cityCount === 1 ? t('trip.cities_count_one') : cityCount < 5 ? t('trip.cities_count_few') : t('trip.cities_count_many')}</span></>
      )}
    </>
  );
  // Copy trip — available to every participant. The new trip is owned by the
  // caller; copyTrip strips Pro status + Pro-only addons server-side.
  const handleCopyTrip = async () => {
    if (copyingTrip) return;
    setCopyingTrip(true);
    try {
      const { data, error } = await supabase.functions.invoke('copyTrip', { body: { tripId: trip.id } });
      // Non-2xx → supabase-js puts the response in error.context; pull the real
      // server message out of it so failures aren't masked by a generic toast.
      let serverMsg = data?.error || null;
      if (!serverMsg && error?.context && typeof error.context.json === 'function') {
        try { serverMsg = (await error.context.json())?.error || null; } catch { /* ignore */ }
      }
      if (error || data?.error) throw new Error(serverMsg || error?.message || 'copy failed');
      qc.invalidateQueries({ queryKey: ['trips', user?.id] });
      toast({ description: t('trip.copy_done'), variant: 'success' });
      if (data?.tripId) nav(`/trip/${data.tripId}`);
    } catch (e) {
      toast({ description: e?.message || t('trip.copy_error'), variant: 'destructive' });
    } finally {
      setCopyingTrip(false);
    }
  };

  const heroActions = (
    <>
      {myRole !== 'viewer' && (
        <button className="app-header__act" onClick={() => setShareOpen(true)}>
          <Icon name="share" size={15} /><span className="app-header__act-text">{t('trip.share')}</span>
        </button>
      )}
      {myRole !== 'viewer' && (
        <button className="app-header__act" disabled={!canEditMode} onClick={() => nav(`/trip/${trip.id}/edit`)}><Icon name="edit" size={15} /><span className="app-header__act-text">{t('trip.edit_trip')}</span></button>
      )}
      <ActionMenu
        align="end"
        width={240}
        trigger={
          <button className="app-header__act app-header__act--icon">
            <Icon name="more" size={15} />
          </button>
        }
        items={[
          { icon: 'settings', label: t('trip.settings_title'), onSelect: () => window.__navigate?.('settings') },
          myRole !== 'viewer' && { icon: 'users', label: t('trip.sidebar_members'), onSelect: () => window.__navigate?.('members') },
          { separator: true },
          { icon: 'copy', label: t('trip.copy'), disabled: copyingTrip, onSelect: handleCopyTrip },
          { icon: 'download', label: t('trip.export'), onSelect: () => window.print() },
        ]}
      />
    </>
  );
  // Map = edge-to-edge, no scroll. Chat = padded but fills height with its own
  // internal scroll. Everything else = the default scrolling body.
  const screenBodyClass = 'trip-screen-body'
    + (shownLens === 'map' ? ' trip-screen-body--flush' : '')
    + (shownLens === 'chat' ? ' trip-screen-body--chat' : '');

  return (
    <div className="trip-shell">
      <AppHeader
        isTrip
        user={user}
        isPro={accountPro}
        isDark={isDark}
        onToggleTheme={toggleTheme}
        onBack={() => nav('/trips')}
        backTitle={t('trip.back')}
        onMenu={() => setSideOpen(true)}
        title={trip?.title}
        meta={heroSub}
        actions={heroActions}
      />
      <div className={'trip-body' + (sideOpen ? ' is-menu-open' : '')}>
          <TripSidebar tripId={tripId} trip={trip} lens={lens} onNavigate={setLens} isPro={tripIsPro} proResolved={tripProResolved} isOwner={isOwner} myRole={myRole} onUpgrade={openUpgrade} onProInfo={() => setTripProInfoOpen(true)} onShare={() => setShareOpen(true)} />
          <div className="trip-side-scrim" onClick={() => setSideOpen(false)} />
          {/* Phone menu: bottom-sheet variant of the same sidebar (≤640px). The
              slide-in drawer above is hidden by CSS at this breakpoint. */}
          <TripSidebarSheet
            open={isPhone && sideOpen}
            onOpenChange={setSideOpen}
            tripId={tripId}
            trip={trip}
            lens={lens}
            onNavigate={setLens}
            isPro={tripIsPro}
            proResolved={tripProResolved}
            isOwner={isOwner}
            myRole={myRole}
            onUpgrade={() => { setSideOpen(false); openUpgrade(); }}
            onProInfo={() => { setSideOpen(false); setTripProInfoOpen(true); }}
            onShare={() => { setSideOpen(false); setShareOpen(true); }}
          />
          <div className="trip-content">
            <main ref={screenBodyRef} className={screenBodyClass}>
          {/* Hotel choice - sits between the warning button and the edit form */}
          <ForkPartnerModal
            open={hotelChoice.open}
            onOpenChange={(o) => setHotelChoice(s => ({ ...s, open: o }))}
            type="hotel"
            visit={hotelChoice.visit}
            tripId={tripId}
            onManual={() => { setHotelChoice((s) => ({ ...s, open: false })); setManualEvt({ open: true, kind: 'hotel', visit: hotelChoice.visit, fromVisit: null, toVisit: null }); }}
          />
          {/* Transfer choice - sits between the warning button and the edit form */}
          <ForkPartnerModal
            open={transferChoice.open}
            onOpenChange={(o) => setTransferChoice(s => ({ ...s, open: o }))}
            type="transfer"
            fromVisit={transferChoice.fromVisit}
            toVisit={transferChoice.toVisit}
            tripId={tripId}
            onManual={() => { setTransferChoice((s) => ({ ...s, open: false })); setManualEvt({ open: true, kind: 'transfer', visit: null, fromVisit: transferChoice.fromVisit, toVisit: transferChoice.toVisit }); }}
          />
          {/* Service choice - opened from the right-rail ServicesWidget */}
          <ForkPartnerModal
            open={serviceChoice.open}
            onOpenChange={(o) => setServiceChoice(s => ({ ...s, open: o }))}
            type={serviceChoice.type || 'esim'}
            visits={visits}
            trip={trip}
            tripId={tripId}
            onManual={() => {
              const type = serviceChoice.type;
              setServiceChoice({ open: false, type: null });
              if (type === 'car_rental') {
                setServiceEditCar({ open: true });
              } else if (type === 'esim' || type === 'insurance') {
                // Open in edit/create mode (no existing service yet)
                setServiceSimple({ open: true, kind: type });
              }
            }}
          />
          {/* Car rental edit - opened from the service ForkPartnerModal */}
          {serviceEditCar.open && (
            <EventEditDialog
              open={serviceEditCar.open}
              onOpenChange={(o) => setServiceEditCar({ open: o })}
              kind="service"
              tripId={tripId}
              entity={serviceEditCar.service || null}
              defaultCurrency={trip?.details?.main_currency || 'EUR'}
            />
          )}
          {/* eSIM / Insurance — CREATE only (viewing goes through the unified
              SourceViewLoader below, like every other service/event). */}
          {serviceSimple.open && (serviceSimple.kind === 'esim' || serviceSimple.kind === 'insurance') && (
            <EventEditDialog
              open={serviceSimple.open}
              onOpenChange={(o) => setServiceSimple(s => ({ ...s, open: o }))}
              kind="service"
              tripId={tripId}
              entity={null}
              initialServiceKind={serviceSimple.kind}
              defaultCurrency={trip?.details?.main_currency || 'EUR'}
            />
          )}
          {/* Activity - add new activity in edit mode */}
          {activityEdit.visit && (
            <EventEditDialog
              key={`activity-${activityEdit.visit?.id}-${activityEdit.activity?.id || 'new'}`}
              open={activityEdit.open}
              onOpenChange={(o) => setActivityEdit(s => ({ ...s, open: o }))}
              kind="activity"
              visit={activityEdit.visit}
              entity={activityEdit.activity}
              defaultStart={activityEdit.defaultStart}
              defaultCurrency={trip?.details?.main_currency || 'EUR'}
            />
          )}
          {/* Manual hotel/transfer create opened in-place (TRIP-138) */}
          {manualEvt.open && (
            <EventEditDialog
              open={manualEvt.open}
              onOpenChange={(o) => setManualEvt((s) => ({ ...s, open: o }))}
              kind={manualEvt.kind}
              tripId={tripId}
              visit={manualEvt.visit}
              fromVisit={manualEvt.fromVisit}
              toVisit={manualEvt.toVisit}
              defaultCurrency={trip?.details?.main_currency || 'EUR'}
            />
          )}
          {/* SourceViewLoader - opens the read/edit dialog when a timeline event is clicked */}
          <SourceViewLoader
            kind={eventView.kind}
            id={eventView.id}
            open={eventView.open}
            onOpenChange={(o) => setEventView(s => ({ ...s, open: o }))}
            canEdit={myRole !== 'viewer'}
            warning={eventView.warning}
          />

          {shownLens === 'overview' && (
            <OverviewLens
              trip={trip}
              visits={visits ?? []}
              transfers={transfers ?? []}
              budget={budget}
              budgetExpenses={budgetExpenses}
              budgetCategories={budgetCategories}
              members={members}
              services={services}
              user={user}
              contentLoading={loadingContent}
              active={shownLens === 'overview'}
              canManage={myRole !== 'viewer'}
              budgetEnabled={isAddonEnabled(trip, 'budget')}
              onOpenMap={() => setLens('map')}
              onOpenBudget={() => setLens('budget')}
              onOpenMembers={() => setLens('members')}
              onAddService={(type) => setServiceChoice({ open: true, type })}
              onOpenService={(s) => setEventView({ open: true, kind: 'service', id: s.id })}
              onBudgetLocked={() => setBudgetAddonOff(true)}
            />
          )}
          {shownLens === 'timeline' && (
            <>
              <div className="ov-anim tl-twocol" style={{ display: 'grid', gridTemplateColumns: '1fr 260px', gap: 24, alignItems: 'start' }}>
                <TimelineLens
                  stream={stream}
                  visits={visits}
                  transfers={transfers}
                  trip={trip}
                  isViewer={myRole === 'viewer'}
                  isLoading={loadingContent}
                  onAddTransfer={(fromVisit, toVisit) =>
                    setTransferChoice({ open: true, fromVisit, toVisit })
                  }
                  onAddHotel={(visit) =>
                    setHotelChoice({ open: true, visit })
                  }
                  onOpenEvent={openEventView}
                  onAddActivityForDay={(dayKey) => {
                    const dayVisit = visits.find(v =>
                      v.kind === 'transit' && v.start_date && v.end_date &&
                      naiveDayKey(v.start_date) <= dayKey && dayKey <= naiveDayKey(v.end_date)
                    ) || visits.find(v => v.kind === 'transit' && v.start_date);
                    if (dayVisit) {
                      const tz = dayVisit.timezone || 'UTC';
                      const defaultStart = dayKey
                        ? DateTime.fromISO(`${dayKey}T10:00`, { zone: tz }).toUTC().toISO()
                        : null;
                      setActivityEdit({ open: true, visit: dayVisit, activity: null, defaultStart });
                    }
                  }}
                />
                <CityRail visits={visits ?? []} scrollRef={screenBodyRef} />
              </div>
            </>
          )}
          {shownLens === 'budget' && (
            <BudgetLens
              tripId={tripId}
              trip={trip}
              budget={budget}
              budgetCategories={budgetCategories}
              budgetExpenses={budgetExpenses}
              members={members}
              cityVisits={visits}
              isLoading={loadingContent}
              isPro={tripIsPro}
              queryClient={qc}
            />
          )}
          {shownLens === 'members' && (
            <MembersLens
              tripId={tripId}
              members={members}
              trip={trip}
              user={user}
              role={myRole}
              isLoading={loadingContent}
              queryClient={qc}
            />
          )}
          {shownLens === 'calendar' && (
            <CalendarLens
              stream={stream}
              visits={visits}
              trip={trip}
              isLoading={loadingContent}
              onOpenEvent={openEventView}
            />
          )}
          {shownLens === 'docs' && (
            <DocsLens
              tripId={tripId}
              isLoading={loadingContent}
              members={members}
            />
          )}
          {shownLens === 'settings' && (
            <SettingsLens
              tripId={tripId}
              trip={trip}
              members={members}
              myRole={myRole}
              isPro={tripIsPro}
              queryClient={qc}
            />
          )}
          {shownLens === 'chat' && (
            <ChatLens
              tripId={tripId}
              members={members}
              myRole={myRole}
              ownerId={trip?.created_by}
            />
          )}
          {/* Map lens: rendered only while active. The Mapbox instance itself is
              the app-wide singleton (see MapProvider) — it survives this mount/
              unmount, so the map isn't re-initialised on tab switches. Only one
              MapView may be mounted at a time, so this must be conditional (not
              kept hidden) to avoid two surfaces fighting over the single map. */}
          {shownLens === 'map' && (
            <ScreenMap
              trip={trip}
              visits={visits ?? []}
              transfers={transfers ?? []}
              hotels={hotels ?? []}
              activities={activities ?? []}
              canEdit={myRole === 'owner' || myRole === 'editor' || myRole === 'admin'}
              active
              openEvent={(kind, id) => setEventView({ open: true, kind, id })}
            />
          )}
            </main>
          </div>
        </div>

      <ProUpsellModal
        open={tripProInfoOpen}
        mode="info"
        onOpenChange={setTripProInfoOpen}
        ownerName={members.find(m => m.user_id === trip?.created_by)?.user_full_name || ''}
      />

      <ShareDialog open={shareOpen} onOpenChange={setShareOpen} trip={trip} />

      {/* Add bottom-sheet — opened by the mobile bottom-nav "+". Each item opens
          a trip-level create dialog (addModal) IN PLACE, without navigating to the
          lens. Items are gated: expense needs the budget addon, member needs owner/admin. */}
      <Sheet open={addOpen} onOpenChange={setAddOpen} title={t('common.add')}>
        <div className="addsheet">
          {isAddonEnabled(trip, 'budget') && (
            <button type="button" className="addsheet__row" onClick={() => { setAddOpen(false); setAddModal('expense'); }}>
              <span className="addsheet__ic" style={{ background: 'var(--primary-soft)', color: 'var(--brand)' }}><Icon name="wallet" size={20} /></span>
              <span className="addsheet__tx"><b>{t('budget.manual_expense')}</b></span>
              <Icon name="chev" size={16} className="addsheet__chev" />
            </button>
          )}
          <button type="button" className="addsheet__row" onClick={() => { setAddOpen(false); setAddModal('docs'); }}>
            <span className="addsheet__ic" style={{ background: 'var(--ev-hotel-soft)', color: 'var(--ev-hotel-ink)' }}><Icon name="file" size={20} /></span>
            <span className="addsheet__tx"><b>{t('doc.add_doc')}</b></span>
            <Icon name="chev" size={16} className="addsheet__chev" />
          </button>
          {(myRole === 'owner' || myRole === 'admin') && (
            <button type="button" className="addsheet__row" onClick={() => { setAddOpen(false); setAddModal('members'); }}>
              <span className="addsheet__ic" style={{ background: 'var(--ev-activity-soft)', color: 'var(--ev-activity-ink)' }}><Icon name="users" size={20} /></span>
              <span className="addsheet__tx"><b>{t('members.invite')}</b></span>
              <Icon name="chev" size={16} className="addsheet__chev" />
            </button>
          )}
        </div>
      </Sheet>

      {/* Trip-level create dialogs opened by the add sheet — render over ANY lens
          without navigating (same pattern as the event dialogs above). */}
      {addModal === 'expense' && (
        <AddExpenseDialog
          open
          onOpenChange={(o) => { if (!o) setAddModal(null); }}
          tripId={tripId}
          categories={budgetCategoryOptions(budgetCategories, t)}
          mainCurrency={trip?.details?.main_currency || budget?.currency || 'EUR'}
          cities={visits.map((v) => v.city_name).filter(Boolean)}
          onSaved={() => qc.invalidateQueries({ queryKey: TRIP_CONTENT_KEY(tripId) })}
        />
      )}
      {addModal === 'docs' && (
        <AddDocDialog open onOpenChange={(o) => { if (!o) setAddModal(null); }} tripId={tripId} />
      )}
      {addModal === 'members' && (
        <InviteDialog
          open
          onOpenChange={(o) => { if (!o) setAddModal(null); }}
          tripId={tripId}
          onSaved={() => { qc.invalidateQueries({ queryKey: TRIP_CONTENT_KEY(tripId) }); qc.invalidateQueries({ queryKey: TRIP_SHELL_KEY(tripId) }); }}
        />
      )}

      {/* Ф6а: budgetAddonOff on Radix (focus-trap, Esc) */}
      <Dialog
        title={t('trip.budget_breakdown_off')}
        icon="wallet"
        open={budgetAddonOff}
        onOpenChange={(o) => { if (!o) setBudgetAddonOff(false); }}
        foot={<>
          <Btn variant="ghost" onClick={() => setBudgetAddonOff(false)}>{t('common.close')}</Btn>
          <Btn variant="primary" icon="settings" onClick={() => { setBudgetAddonOff(false); setLens('settings'); }}>{t('trip.open_settings')}</Btn>
        </>}
      >
        <div className="muted" style={{ fontSize: 'var(--fs-base)', lineHeight: 1.6 }}>
          {t('trip.budget_addon_off_desc')}
        </div>
      </Dialog>

      {/* Floating chat widget: requires the chat addon AND the trip-level
          "chat widget" display toggle (default ON). The full Chat lens stays
          reachable from the sidebar regardless of this toggle. */}
      {!isPhone && isLensVisible(trip, 'chat') && trip?.details?.display?.chat_widget !== false && shownLens !== 'chat' && (
        <ChatWidget tripId={tripId} members={members} tripTitle={trip?.title} ownerId={trip?.created_by} />
      )}

      <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>
    </div>
  );
}
