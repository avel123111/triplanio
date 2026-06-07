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
import TripProInfoDialog from '@/components/common/TripProInfoDialog';
import { isAddonEnabled } from '@/lib/tripAddons';
import { isLensVisible, LENS_ITEMS, MGMT_ITEMS } from '@/lib/tripMenu';
import TripSidebar from '@/components/trips/TripSidebar';
import TripHeaderBar from '@/components/trips/TripHeaderBar';
import TripScreenBar, { TripScreenBarCtx } from '@/components/trips/TripScreenBar';
import ShareDialog from '@/components/trips/ShareDialog';
import { useTheme } from '@/lib/ThemeContext';
import { Icon } from '../design/icons';
import HeaderActions from '@/components/HeaderActions';
import { Btn, EmptyState, Skeleton, fmtDate, weekdayLong, StreamEventRow } from '../design/index';
import { SystemStub } from '@/lib/PageNotFound';
import { sortVisits, cityIdentity } from '@/lib/validation';
import { useToast } from '@/components/ui/use-toast';
import { DateTime } from 'luxon';
import EventEditDialog from '@/components/common/EventEditDialog';
import SourceViewLoader from '../components/budget/SourceViewLoader';
import ForkPartnerModal from '@/components/bookings/ForkPartnerModal';
import ServiceDialog from '@/components/services/ServiceDialog';
import OverviewLens from './OverviewLens';
import BudgetLens from './BudgetLens';
import MembersLens from './MembersLens';
import CalendarLens from './CalendarLens';
import DocsLens from './DocsLens';
import SettingsLens from './SettingsLens';
import ChatLens from './ChatLens';
import { uniqueCityCount } from '@/lib/trip-cities';
import ChatWidget from '@/components/chat/ChatWidget';
import ScreenMap from '@/pages/ScreenMap';
import TripFormDialog from '@/components/trips/TripFormDialog';
import { getGradientById } from '@/lib/trip-gradients';
import { useI18n } from '@/lib/i18n/I18nContext';
import '../design/app.css';

// Screen-name lookup for the global screen-title bar. Derived from the shared
// trip-menu data so the bar title and the sidebar label never drift.
const SCREEN_TITLE_KEY = Object.fromEntries(
  [...LENS_ITEMS, ...MGMT_ITEMS].map((i) => [i.id, i.labelKey]),
);

// ─── helpers ──────────────────────────────────────────────────────────────────

function formatDuration(t, start, end) {
  const s = parseNaive(start);
  const e = parseNaive(end);
  if (!s || !e) return null;
  const mins = Math.round(e.diff(s, 'minutes').minutes);
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
    // If the transfer has no explicit start_datetime (e.g. created via the
    // ManualPlanner transport step), anchor it to the arrival day of the
    // to-visit so it still appears in the timeline above the city header.
    const explicitDate = naiveDayKey(tr.start_datetime);
    const toVisit = visits.find(v => v.id === tr.to_city_visit_id);
    const fromVisit = visits.find(v => v.id === tr.from_city_visit_id);
    // For dateless transfers anchor to the to-visit's arrival day, or - for
    // legs into a dateless end anchor - to the from-visit's end day.
    const fallbackDate = (toVisit && naiveDayKey(toVisit.start_date))
      || (fromVisit && naiveDayKey(fromVisit.end_date))
      || null;
    const eventDate = explicitDate || fallbackDate;
    const eventMs = parseNaive(tr.start_datetime)?.toMillis()
      ?? parseNaive(toVisit?.start_date)?.toMillis()
      ?? parseNaive(fromVisit?.end_date)?.toMillis()
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
      duration: tr.end_datetime ? formatDuration(t, tr.start_datetime, tr.end_datetime) : null,
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
      {/* Skeleton top bar */}
      <header className="app-header">
        <div style={{ width: 28, height: 28, borderRadius: 7, background: 'var(--line)', flexShrink: 0 }} />
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <Skeleton w={28} h={28} r={7} />
          <Skeleton w={90} h={14} r={5} />
        </div>
        <div style={{ flex: 1 }} />
        <div style={{ display: 'flex', gap: 8 }}>
          <Skeleton w={28} h={28} r={7} />
          <Skeleton w={28} h={28} r={7} />
          <Skeleton w={32} h={32} r={999} />
        </div>
      </header>
      {/* Skeleton gradient hero */}
      <div className="trip-hero">
        <div className="trip-hero__bg" style={{ background: 'var(--brand-grad)' }} />
        <div className="trip-hero__ov" />
        <div className="trip-hero__in">
          <div style={{ flex: 1 }}>
            <Skeleton w={200} h={20} r={6} style={{ marginBottom: 8 }} />
            <Skeleton w={150} h={12} r={5} />
          </div>
        </div>
      </div>
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
          {/* Skeleton screen-title bar */}
          <div className="trip-screenbar"><Skeleton w={150} h={20} r={6} /></div>
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

function TripHeader({ isPro, isDark, onToggleTheme, user, nav }) {
  const { t } = useI18n();
  // Title + dates now live in the gradient hero (TripHeaderBar), so the top bar
  // only carries the brand and the account/notifications cluster.
  return (
    <header className="app-header">
      <button className="app-header__crumb-back" onClick={() => nav('/trips')} title={t('trip.back')}>
        <Icon name="back" size={15} />
      </button>

      <div className="app-header__brand" onClick={() => nav('/trips')} style={{ cursor: 'pointer' }}>
        <img src="/triplanio-logo.svg" alt="Triplanio" style={{ width: 28, height: 28, borderRadius: 7, flexShrink: 0 }} />
        <span className="app-header__brand-name">Triplanio</span>
      </div>

      <div style={{ flex: 1 }} />

      <HeaderActions user={user} isPro={isPro} isDark={isDark} onToggleTheme={onToggleTheme} />
    </header>
  );
}


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
  // matching base44's sortVisits logic from validation.js
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

  // Inbound transfer EVENTS (from the stream) for a destination visit - used to
  // render the actual transfer card above its hero.
  const inboundEventsFor = (visitId) =>
    stream.filter(e => {
      if (e.type !== 'transfer' && e.type !== 'flight') return false;
      const tr = (transfers || []).find(t => t.id === e.id);
      return tr?.to_city_visit_id === visitId;
    });
  const hasTransferBetween = (prev, city) =>
    !!prev && (inboundByVisit[city.id] || []).some(tr => tr.from_city_visit_id === prev.id);

  // Inbound-transfer event ids - excluded from a day's general event list
  // (they belong inside the arrival block, above the city hero).
  const inboundEventIds = new Set();
  for (const c of transitCities) for (const e of inboundEventsFor(c.id)) inboundEventIds.add(e.id);
  // The leg INTO the finish anchor is rendered in the end block below, so keep
  // it out of the general day list too.
  const _endAnchor = ordered[ordered.length - 1];
  if (_endAnchor && _endAnchor.kind === 'end') {
    for (const e of inboundEventsFor(_endAnchor.id)) inboundEventIds.add(e.id);
  }

  // Renders one city's arrival block: [transfer card | missing-transfer warning]
  // then the CityHero. `prev` = the previously-rendered city (or start anchor).
  const renderArrival = (city, prev) => {
    const out = [];
    if (prev && cityIdentity(prev) !== cityIdentity(city) && !hasTransferBetween(prev, city)) {
      if (showBookingWarnings) out.push(
        <div key={`mt-${city.id}`} style={{ marginBottom: 8 }}>
          <MissingTransferWarning
            from={prev.city_name} to={city.city_name}
            fromVisit={prev} toVisit={city} onAdd={onAddTransfer}
          />
        </div>
      );
    } else {
      const inEv = inboundEventsFor(city.id);
      if (inEv.length > 0) {
        out.push(
          <div key={`in-${city.id}`} style={{ display: 'flex', flexDirection: 'column', gap: 8, marginBottom: 8 }}>
            {inEv.map(e => <StreamEventRow key={e.id} e={e} onClick={() => onOpenEvent?.(e)} />)}
          </div>
        );
      }
    }
    // The city "hero" card was removed from the timeline feed. City context is
    // carried by the per-day city chip in the date separator, and hotels render
    // as their own check-in/check-out/deadline rows in the day stream. The
    // arrival block now contributes only the inbound transfer card (or the
    // missing-transfer warning) above the day's events.
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

    // Header chip = the latest transit city whose range covers this day.
    const dayCity = [...transitCities].reverse().find(c => {
      const s = naiveDayKey(c.start_date), e = naiveDayKey(c.end_date);
      return s && e && day >= s && day <= e;
    }) || null;

    const allDayEvents = eventsByDate[day] || [];
    const dayEvents = allDayEvents.filter(e => !inboundEventIds.has(e.id));

    const _dd = new Date(`${day}T00:00`);
    const _dayNum = Number.isNaN(_dd.getTime()) ? day.slice(8, 10) : _dd.getDate();
    const _monAbbr = Number.isNaN(_dd.getTime()) ? '' : _dd.toLocaleDateString(lang, { month: 'short' }).replace('.', '');
    rows.push(
      <div key={`day-${day}`} id={`tlday-${day}`} data-tlday={day} data-city={dayCity?.id || ''} className="tl3-day">
        {/* Date header — Lumo .tl3-dh (datechip + weekday + city pill) */}
        <div className="tl3-dh">
          <span className="datechip"><span className="d">{_dayNum}</span><span className="m">{_monAbbr}</span></span>
          <span className="wd">{weekdayLong(day, lang)}</span>
          {weatherByDay[day] && (
            <span className="wthr"><span>{weatherByDay[day].icon}</span><span>{weatherByDay[day].temp}°</span></span>
          )}
          {dayCity && (
            <span className="daycity"><Icon name="pin" size={14} />{dayCity.city_name}</span>
          )}
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
          const blocks = arrivingToday.map(c => {
            const inEv = inboundEventsFor(c.id);
            const anchorMs = inEv.length
              ? Math.min(...inEv.map(e => e._ms ?? Number.POSITIVE_INFINITY))
              : (parseNaive(c.start_date)?.toMillis() ?? Number.NEGATIVE_INFINITY);
            return { anchorMs, city: c };
          });
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
    if (hasTransferBetween(prevCity, endVisit)) {
      const inEndEv = inboundEventsFor(endVisit.id).filter(e => {
        const tr = (transfers || []).find(t => t.id === e.id);
        return tr?.from_city_visit_id === prevCity.id;
      });
      if (inEndEv.length > 0) {
        rows.push(
          <div key="in-end" style={{ display: 'flex', flexDirection: 'column', gap: 8, marginBottom: 8 }}>
            {inEndEv.map(e => <StreamEventRow key={e.id} e={e} onClick={() => onOpenEvent?.(e)} />)}
          </div>
        );
      }
    } else if (showBookingWarnings) {
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
    () => sortVisits(visits).filter(v => v.kind !== 'start' && v.kind !== 'end'),
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


function MoreMenuDialog({ trip, visits, canManage = false, onEditMetadata }) {
  const { t } = useI18n();
  const nav = useNavigate();
  const qc = useQueryClient();
  const { user } = useAuth();
  const { toast } = useToast();
  const [copying, setCopying] = useState(false);
  const openEditMetadata = () => {
    onEditMetadata?.();
  };

  // Copy trip — available to every participant. The new trip is owned by the
  // caller; copyTrip strips Pro status + Pro-only addons server-side.
  const handleCopy = async () => {
    if (copying) return;
    setCopying(true);
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
      window.__closeModal?.();
      toast({ description: t('trip.copy_done') });
      if (data?.tripId) nav(`/trip/${data.tripId}`);
    } catch (e) {
      toast({ description: e?.message || t('trip.copy_error'), variant: 'destructive' });
    } finally {
      setCopying(false);
    }
  };

  const itemStyle = { display: 'flex', alignItems: 'center', gap: 12, padding: '12px 14px', borderRadius: 10, border: 'none', cursor: 'pointer', textAlign: 'left', fontSize: 'var(--fs-strong)', color: 'var(--ink)' };
  return (
    <div style={{ position: 'fixed', inset: 0, zIndex: 999, display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'var(--scrim)', backdropFilter: 'blur(4px)' }}
      onClick={() => window.__closeModal?.()}>
      <div onClick={e => e.stopPropagation()} style={{ background: 'var(--surface)', border: '1px solid var(--line)', borderRadius: 18, padding: 20, width: 320, maxWidth: 'calc(100vw - 32px)', boxShadow: 'var(--shadow-pop)' }}>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
          {canManage && (
            <button onClick={openEditMetadata} className="dz-rowhover" style={itemStyle}>
              <Icon name="edit" size={16} style={{ color: 'var(--muted)' }} /> {t('trip.edit_metadata')}
            </button>
          )}
          {canManage && (
            <button onClick={() => { window.__closeModal?.(); window.__navigate?.('settings'); }} className="dz-rowhover" style={itemStyle}>
              <Icon name="settings" size={16} style={{ color: 'var(--muted)' }} /> {t('trip.settings_title')}
            </button>
          )}
          {canManage && (
            <button onClick={() => { window.__closeModal?.(); window.__navigate?.('members'); }} className="dz-rowhover" style={itemStyle}>
              <Icon name="users" size={16} style={{ color: 'var(--muted)' }} /> {t('trip.sidebar_members')}
            </button>
          )}
          {canManage && <div style={{ height: 1, background: 'var(--line-2)', margin: '6px 0' }} />}
          <button onClick={handleCopy} disabled={copying} className="dz-rowhover" style={{ ...itemStyle, opacity: copying ? 0.6 : 1, cursor: copying ? 'default' : 'pointer' }}>
            <Icon name="copy" size={16} style={{ color: 'var(--muted)' }} /> {t('trip.copy')}
          </button>
          <button onClick={() => { window.__closeModal?.(); window.print(); }} className="dz-rowhover" style={itemStyle}>
            <Icon name="download" size={16} style={{ color: 'var(--muted)' }} /> {t('trip.export')}
          </button>
          <div style={{ height: 1, background: 'var(--line-2)', margin: '6px 0' }} />
          <button onClick={() => window.__closeModal?.()} style={{ ...itemStyle, color: 'var(--muted)' }}>
            <Icon name="close" size={16} /> {t('common.close')}
          </button>
        </div>
      </div>
    </div>
  );
}

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
  const lens = searchParams.get('lens') || 'overview';

  const { isDark, toggle: toggleTheme } = useTheme();
  // Choice dialogs (ForkPartnerModal) - sit between the warning button and the
  // edit form so the user can pick a partner before falling back to manual entry.
  const [hotelChoice, setHotelChoice] = useState({ open: false, visit: null });
  const [transferChoice, setTransferChoice] = useState({ open: false, fromVisit: null, toVisit: null });
  // Right-rail service add - opens ForkPartnerModal for the chosen kind, then
  // routes to the right edit dialog when the user picks "Manual".
  const [serviceChoice, setServiceChoice] = useState({ open: false, type: null });
  const [serviceEditCar, setServiceEditCar] = useState({ open: false });
  const [serviceEditSimple, setServiceEditSimple] = useState({ open: false, kind: null });
  // City add/edit/delete moved entirely to the Structure editor (/trip/:id/edit).
  const [activityEdit, setActivityEdit] = useState({ open: false, visit: null, activity: null, defaultStart: null });
  const [eventView, setEventView] = useState({ open: false, kind: null, id: null });
  const openUpgrade = () => nav(`/pro?tripId=${tripId}`);
  // Stripe-return success/fail modal is handled globally by <StripeReturnModals>.

  // Open the read/edit dialog for a timeline event (hotel / transfer / activity)
  const openEventView = (e) => {
    // Car-rental pickup/return → open the car service in the editor dialog.
    if (e.type === 'car-pickup' || e.type === 'car-return') {
      const svc = (services || []).find(s => s.id === e.id);
      if (svc) setServiceEditCar({ open: true, service: svc });
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
  // Structure Edit Mode lock held (by anyone, incl. self in another tab) → freeze
  // timeline mutations (TRIP_EDIT_MODE_TZ §3a). Reflected on load/refetch of the shell.
  const frozen = !!trip?.editing_by;
  // While the trip is being edited in the Structure editor, freeze ALL event
  // mutations on the timeline (add/edit/delete) - viewing stays allowed (TZ §3a).
  const frozenNote = () => toast({ description: t('trip.frozen_note') });
  const [tripProInfoOpen, setTripProInfoOpen] = useState(false);
  const [budgetAddonOff, setBudgetAddonOff] = useState(false);
  // Global trip-header state: trip-metadata editor, mobile sidebar, and the
  // right-hand actions the active lens projects into the screen-title bar.
  const [editingMetadata, setEditingMetadata] = useState(false);
  const [sideOpen, setSideOpen] = useState(false);
  const [screenActions, setScreenActions] = useState(null);

  // If the URL points at a lens the trip has disabled, fall back to the timeline.
  // Viewers can't open Settings/Members even by deep link → fall back too.
  const VIEWER_BLOCKED_LENSES = new Set(['settings', 'members']);
  let shownLens = isLensVisible(trip, lens) ? lens : 'overview';
  if (myRole === 'viewer' && VIEWER_BLOCKED_LENSES.has(shownLens)) shownLens = 'overview';

  // Latch once the map lens has been opened so it stays mounted (hidden) on other
  // tabs — see the map-lens render below for why.
  const [mapEverShown, setMapEverShown] = useState(false);
  useEffect(() => { if (shownLens === 'map') setMapEverShown(true); }, [shownLens]);
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
  const gradient = getGradientById(trip?.cover_gradient);
  const hasPhoto = !!trip?.cover_image_url;
  const coverGradientCss = (!hasPhoto && gradient) ? gradient.css : null;
  const useDefaultWaves = !hasPhoto && !gradient;
  const dateRange = formatTripRange(visits, '-');
  const cityCount = uniqueCityCount(visits);
  const activeMemberCount = members.filter(m => m.status === 'active').length || 1;
  const heroSub = (
    <>
      {dateRange && dateRange !== '-' && <span>{dateRange}</span>}
      {cityCount > 0 && (
        <><span>·</span><span>{cityCount} {cityCount === 1 ? t('trip.cities_count_one') : cityCount < 5 ? t('trip.cities_count_few') : t('trip.cities_count_many')}</span></>
      )}
      <span>·</span>
      <span>{activeMemberCount} {activeMemberCount === 1 ? t('trip.members_count_one') : activeMemberCount < 5 ? t('trip.members_count_few') : t('trip.members_count_many')}</span>
    </>
  );
  const heroActions = (
    <>
      {myRole !== 'viewer' && (
        <button className="trip-hero__btn" onClick={() => window.__openModal?.(<ShareDialog trip={trip} />)}>
          <Icon name="share" size={15} /><span className="trip-hero__btn-text">{t('trip.share')}</span>
        </button>
      )}
      {myRole !== 'viewer' && (
        frozen
          ? <button className="trip-hero__btn" disabled><Icon name="lock" size={15} /><span className="trip-hero__btn-text">{t('trip.editing')}</span></button>
          : <button className="trip-hero__btn" disabled={!canEditMode} onClick={() => nav(`/trip/${trip.id}/edit`)}><Icon name="edit" size={15} /><span className="trip-hero__btn-text">{t('trip.edit_trip')}</span></button>
      )}
      <button
        className="trip-hero__btn trip-hero__btn--icon"
        onClick={() => window.__openModal?.(<MoreMenuDialog trip={trip} visits={visits} canManage={myRole !== 'viewer'} onEditMetadata={() => { window.__closeModal?.(); setEditingMetadata(true); }} />)}
      >
        <Icon name="more" size={15} />
      </button>
    </>
  );
  // Map = edge-to-edge, no scroll. Chat = padded but fills height with its own
  // internal scroll. Everything else = the default scrolling body.
  const screenBodyClass = 'trip-screen-body'
    + (shownLens === 'map' ? ' trip-screen-body--flush' : '')
    + (shownLens === 'chat' ? ' trip-screen-body--chat' : '');

  return (
    <div className="trip-shell">
      <TripHeader
        isPro={accountPro}
        isDark={isDark}
        onToggleTheme={toggleTheme}
        user={user}
        nav={nav}
      />
      <TripHeaderBar
        title={trip?.title}
        subtitle={heroSub}
        coverImageUrl={trip?.cover_image_url || null}
        coverGradientCss={coverGradientCss}
        useDefaultWaves={useDefaultWaves}
        onMenu={() => setSideOpen(true)}
        actions={heroActions}
      />
      <TripFormDialog open={editingMetadata} onOpenChange={setEditingMetadata} trip={trip} visits={visits} />
      <TripScreenBarCtx.Provider value={{ setActions: setScreenActions }}>
        <div className={'trip-body' + (sideOpen ? ' is-menu-open' : '')}>
          <TripSidebar tripId={tripId} trip={trip} lens={lens} onNavigate={setLens} isPro={tripIsPro} proResolved={tripProResolved} isOwner={isOwner} myRole={myRole} onUpgrade={openUpgrade} onProInfo={() => setTripProInfoOpen(true)} onShare={() => window.__openModal?.(<ShareDialog trip={trip} />)} />
          <div className="trip-side-scrim" onClick={() => setSideOpen(false)} />
          <div className="trip-content">
            <TripScreenBar title={t(SCREEN_TITLE_KEY[shownLens] || 'trip_menu.timeline')} actions={screenActions} />
            <main ref={screenBodyRef} className={screenBodyClass}>
          {/* Hotel choice - sits between the warning button and the edit form */}
          <ForkPartnerModal
            open={hotelChoice.open}
            onOpenChange={(o) => setHotelChoice(s => ({ ...s, open: o }))}
            type="hotel"
            visit={hotelChoice.visit}
            tripId={tripId}
            onManual={() => { setHotelChoice((s) => ({ ...s, open: false })); nav(`/trip/${tripId}/edit`, { state: { create: { kind: 'hotel', cityVisitId: hotelChoice.visit?.id } } }); }}
          />
          {/* Transfer choice - sits between the warning button and the edit form */}
          <ForkPartnerModal
            open={transferChoice.open}
            onOpenChange={(o) => setTransferChoice(s => ({ ...s, open: o }))}
            type="transfer"
            fromVisit={transferChoice.fromVisit}
            toVisit={transferChoice.toVisit}
            tripId={tripId}
            onManual={() => { setTransferChoice((s) => ({ ...s, open: false })); nav(`/trip/${tripId}/edit`, { state: { create: { kind: 'transfer', fromId: transferChoice.fromVisit?.id, toId: transferChoice.toVisit?.id } } }); }}
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
                setServiceEditSimple({ open: true, kind: type });
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
          {/* eSIM / Insurance edit - opened from the service ForkPartnerModal */}
          {serviceEditSimple.open && serviceEditSimple.kind && (
            <ServiceDialog
              open={serviceEditSimple.open}
              onOpenChange={(o) => setServiceEditSimple(s => ({ ...s, open: o }))}
              tripId={tripId}
              kind={serviceEditSimple.kind}
              service={serviceEditSimple.service || null}
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
          {/* SourceViewLoader - opens the read/edit dialog when a timeline event is clicked */}
          <SourceViewLoader
            kind={eventView.kind}
            id={eventView.id}
            open={eventView.open}
            onOpenChange={(o) => setEventView(s => ({ ...s, open: o }))}
            canEdit={myRole !== 'viewer' && !frozen}
            warning={eventView.warning}
            onEditInEditor={canEditMode ? (({ kind, id }) => nav(`/trip/${trip.id}/edit`, { state: { edit: { kind, id } } })) : null}
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
              onAddService={frozen ? frozenNote : (type) => setServiceChoice({ open: true, type })}
              onOpenService={(s) => {
                if (s.kind === 'car_rental') setServiceEditCar({ open: true, service: s });
                else setServiceEditSimple({ open: true, kind: s.kind, service: s });
              }}
              onBudgetLocked={() => setBudgetAddonOff(true)}
            />
          )}
          {shownLens === 'timeline' && (
            <>
              {frozen && (
                <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '10px 14px', marginBottom: 14, borderRadius: 10, background: 'var(--wash)', border: '1px solid var(--line)', fontSize: 'var(--fs-base)', color: 'var(--ink-2)' }}>
                  <Icon name="lock" size={14} /> {t('trip.frozen_note')}
                </div>
              )}
              <div className="ov-anim tl-twocol" style={{ display: 'grid', gridTemplateColumns: '1fr 260px', gap: 24, alignItems: 'start' }}>
                <TimelineLens
                  stream={stream}
                  visits={visits}
                  transfers={transfers}
                  trip={trip}
                  isViewer={myRole === 'viewer'}
                  isLoading={loadingContent}
                  onAddTransfer={frozen ? frozenNote : (fromVisit, toVisit) =>
                    setTransferChoice({ open: true, fromVisit, toVisit })
                  }
                  onAddHotel={frozen ? frozenNote : (visit) =>
                    setHotelChoice({ open: true, visit })
                  }
                  onOpenEvent={openEventView}
                  onAddActivityForDay={frozen ? frozenNote : (dayKey) => {
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
          {/* Map lens: mount once first opened, then keep it alive but hidden on
              other tabs so the Mapbox instance (and its loaded tiles/route) is
              reused instead of re-initialised on every tab switch. */}
          {mapEverShown && (
            <div style={{ display: shownLens === 'map' ? 'block' : 'none', height: '100%' }}>
              <ScreenMap
                trip={trip}
                visits={visits ?? []}
                transfers={transfers ?? []}
                hotels={hotels ?? []}
                activities={activities ?? []}
                canEdit={myRole === 'owner' || myRole === 'editor' || myRole === 'admin'}
                active={shownLens === 'map'}
                openEvent={(kind, id) => setEventView({ open: true, kind, id })}
              />
            </div>
          )}
            </main>
          </div>
        </div>
      </TripScreenBarCtx.Provider>

      <TripProInfoDialog
        open={tripProInfoOpen}
        onOpenChange={setTripProInfoOpen}
      />

      {budgetAddonOff && (
        <div className="dlg-backdrop" style={{ zIndex: 320 }}
          onClick={(e) => { if (e.target === e.currentTarget) setBudgetAddonOff(false); }}>
          <div className="dlg dlg--sm">
            <div className="dlg__head">
              <div style={{ width: 36, height: 36, borderRadius: 9, background: 'var(--success-soft)', color: 'var(--success)', display: 'grid', placeItems: 'center', flexShrink: 0 }}>
                <Icon name="wallet" size={17} />
              </div>
              <h2>{t('trip.budget_breakdown_off')}</h2>
              <button className="icon-btn" onClick={() => setBudgetAddonOff(false)}><Icon name="close" size={16} /></button>
            </div>
            <div className="dlg__body">
              <div className="muted" style={{ fontSize: 'var(--fs-base)', lineHeight: 1.6 }}>
                {t('trip.budget_addon_off_desc')}
              </div>
            </div>
            <div className="dlg__foot">
              <Btn variant="ghost" onClick={() => setBudgetAddonOff(false)}>{t('common.close')}</Btn>
              <Btn variant="primary" icon="settings" onClick={() => { setBudgetAddonOff(false); setLens('settings'); }}>{t('trip.open_settings')}</Btn>
            </div>
          </div>
        </div>
      )}

      {/* Floating chat widget: requires the chat addon AND the trip-level
          "chat widget" display toggle (default ON). The full Chat lens stays
          reachable from the sidebar regardless of this toggle. */}
      {isLensVisible(trip, 'chat') && trip?.details?.display?.chat_widget !== false && shownLens !== 'chat' && (
        <ChatWidget tripId={tripId} members={members} tripTitle={trip?.title} ownerId={trip?.created_by} />
      )}

      <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>
    </div>
  );
}
