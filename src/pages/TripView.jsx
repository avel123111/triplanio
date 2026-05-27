import React, { useMemo, useState, useEffect } from 'react';
import { useParams, useNavigate, useSearchParams } from 'react-router-dom';
import { useQuery, useQueryClient } from '@tanstack/react-query';

import { supabase } from '@/api/supabaseClient';
import { useAuth } from '@/lib/AuthContext';
import { TRIP_SHELL_KEY, TRIP_CONTENT_KEY } from '@/lib/trip-data';
import { naiveDayKey, parseNaive, formatNaive } from '@/lib/naive-time';
import { isTripInPast, formatTripRange } from '@/lib/trip-dates';
import { Icon } from '../design/icons';
import { Avatar, Btn, Badge, EmptyState, Skeleton, ModalHost, groupByDate, fmtDate, weekday, StreamEventRow, fmt, CityPhoto, WeatherChip } from '../design/index';
import BudgetLens from './BudgetLens';
import MembersLens from './MembersLens';
import '../design/app.css';

// ─── helpers ──────────────────────────────────────────────────────────────────

function formatDuration(start, end) {
  const s = parseNaive(start);
  const e = parseNaive(end);
  if (!s || !e) return null;
  const mins = Math.round(e.diff(s, 'minutes').minutes);
  if (mins <= 0) return null;
  const h = Math.floor(mins / 60);
  const m = mins % 60;
  if (h === 0) return `${m}м`;
  if (m === 0) return `${h}ч`;
  return `${h}ч ${m}м`;
}

function cityForVisit(visitId, visits) {
  const v = visits.find(v => v.id === visitId);
  return v ? v.city_name : null;
}

export function buildEventStream(hotels = [], activities = [], transfers = [], visits = []) {
  const events = [];

  for (const h of hotels) {
    const city = h.city_name || cityForVisit(h.city_visit_id, visits) || '';
    if (h.check_in_datetime) {
      events.push({
        type: 'hotel-checkin',
        id: 'h-in-' + h.id,
        date: naiveDayKey(h.check_in_datetime),
        time: formatNaive(h.check_in_datetime, 'HH:mm'),
        city,
        title: 'Заезд · ' + h.name,
        hotel: h.name,
        hotelId: h.id,
        price: h.price,
        cur: h.currency,
        nights: h.nights,
        platformUrl: h.platform_url,
        num: h.confirmation_number,
        _ms: parseNaive(h.check_in_datetime)?.toMillis() ?? 0,
      });
    }
    if (h.check_out_datetime) {
      events.push({
        type: 'hotel-checkout',
        id: 'h-out-' + h.id,
        date: naiveDayKey(h.check_out_datetime),
        time: formatNaive(h.check_out_datetime, 'HH:mm'),
        city,
        title: 'Выезд · ' + h.name,
        hotelId: h.id,
        _ms: parseNaive(h.check_out_datetime)?.toMillis() ?? 0,
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
      duration: a.end_datetime ? formatDuration(a.start_datetime, a.end_datetime) : null,
      _ms: parseNaive(a.start_datetime)?.toMillis() ?? 0,
    });
  }

  for (const t of transfers) {
    const kind = t.transport_type || t.kind || 'car';
    const isPlane = kind === 'plane';
    events.push({
      type: isPlane ? 'flight' : 'transfer',
      id: t.id,
      date: naiveDayKey(t.start_datetime),
      time: formatNaive(t.start_datetime, 'HH:mm'),
      title: t.carrier_name && t.flight_number
        ? `${t.carrier_name} ${t.flight_number}`
        : (t.carrier_name || (isPlane ? 'Перелёт' : 'Переезд')),
      from: t.origin_name,
      to: t.destination_name,
      kind,
      carrier: t.carrier_name,
      num: t.flight_number,
      price: t.price,
      cur: t.currency,
      platformUrl: t.platform_url,
      duration: t.end_datetime ? formatDuration(t.start_datetime, t.end_datetime) : null,
      _ms: parseNaive(t.start_datetime)?.toMillis() ?? 0,
    });
  }

  return events
    .filter(e => e.date)
    .sort((a, b) => a._ms - b._ms);
}

// ─── LoadingScreen / ErrorScreen ──────────────────────────────────────────────

function LoadingScreen() {
  return (
    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', minHeight: '100vh', background: 'var(--wash)' }}>
      <div style={{ textAlign: 'center', color: 'var(--muted)' }}>
        <div style={{ width: 40, height: 40, border: '3px solid var(--line)', borderTopColor: 'var(--brand)', borderRadius: '50%', animation: 'spin 0.8s linear infinite', margin: '0 auto 14px' }} />
        <div style={{ fontSize: 13.5, fontWeight: 500 }}>Загружаем трип…</div>
      </div>
    </div>
  );
}

function ErrorScreen({ onBack }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', minHeight: '100vh', background: 'var(--wash)' }}>
      <EmptyState
        icon="error"
        kind="error"
        title="Трип не найден"
        body="Возможно, у вас нет доступа или трип был удалён."
        action={<Btn variant="ghost" icon="back" onClick={onBack}>Назад к трипам</Btn>}
      />
    </div>
  );
}

// ─── TripHeader ───────────────────────────────────────────────────────────────

function TripHeader({ trip, visits, isPro, theme, setTheme, user, nav }) {
  const dateRange = formatTripRange(visits, '—');
  const initials = user?.full_name
    ? user.full_name.split(/\s+/).map(p => p[0]).join('').slice(0, 2).toUpperCase()
    : (user?.email?.[0] || '?').toUpperCase();

  return (
    <header className="app-header">
      <button className="app-header__crumb-back" onClick={() => nav('/trips')} title="Назад">
        <Icon name="back" size={15} />
      </button>

      <div className="app-header__brand" onClick={() => nav('/trips')} style={{ cursor: 'pointer' }}>
        <img src="/triplanio-logo.svg" alt="Triplanio" style={{ width: 28, height: 28, borderRadius: 7, flexShrink: 0 }} />
        <span className="app-header__brand-name">Triplanio</span>
      </div>

      <div className="app-header__crumb">
        <span className="app-header__crumb-sep">/</span>
        <div className="app-header__crumb-trip">
          <span style={{ fontWeight: 600, color: 'var(--ink)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', maxWidth: '320px' }}>
            {trip?.title || '…'}
          </span>
          {dateRange && dateRange !== '—' && (
            <span className="app-header__crumb-dates">{dateRange}</span>
          )}
          {isPro && (
            <span style={{ background: 'var(--warm-tint)', color: 'var(--warm)', padding: '2px 7px', borderRadius: 999, fontSize: 10.5, fontWeight: 700, letterSpacing: '.04em', flexShrink: 0 }}>PRO</span>
          )}
        </div>
      </div>

      <div className="app-header__right">
        <button className="icon-btn" onClick={() => setTheme(t => t === 'dark' ? 'light' : 'dark')} title="Сменить тему">
          <Icon name={theme === 'dark' ? 'sun' : 'moon'} size={16} />
        </button>
        <button className="icon-btn" onClick={() => nav('/inbox')} title="Уведомления">
          <Icon name="bell" size={16} />
        </button>
        <button
          className="app-header__avatar"
          onClick={() => nav('/settings')}
          title="Настройки"
          style={{ cursor: 'pointer', border: 'none' }}
        >
          {initials}
        </button>
      </div>
    </header>
  );
}

// ─── TripSidebar ──────────────────────────────────────────────────────────────

const LENS_ITEMS = [
  { id: 'timeline',  label: 'Хронология',   icon: 'list'     },
  { id: 'map',       label: 'Карта',         icon: 'map'      },
  { id: 'calendar',  label: 'Календарь',     icon: 'calendar' },
  { id: 'budget',    label: 'Бюджет',        icon: 'wallet'   },
  { id: 'hotels',    label: 'Отели',         icon: 'vote'     },
  { id: 'docs',      label: 'Документы',     icon: 'file'     },
];

const MGMT_ITEMS = [
  { id: 'members',   label: 'Участники',     icon: 'users'    },
  { id: 'settings',  label: 'Настройки',     icon: 'settings' },
  { id: 'ai',        label: 'ИИ-помощник',   icon: 'sparkles' },
  { id: 'chat',      label: 'Чат',           icon: 'chat'     },
];

function TripSidebar({ tripId, lens, onNavigate }) {
  return (
    <aside className="app-side">
      <div className="app-side__group">
        <div className="app-side__group-label">Линзы трипа</div>
        {LENS_ITEMS.map(item => (
          <button
            key={item.id}
            className={'app-side__item' + (lens === item.id ? ' active' : '')}
            onClick={() => onNavigate(item.id)}
          >
            <Icon name={item.icon} size={15} />
            {item.label}
          </button>
        ))}
      </div>
      <div className="app-side__group">
        <div className="app-side__group-label">Управление</div>
        {MGMT_ITEMS.map(item => (
          <button
            key={item.id}
            className={'app-side__item' + (lens === item.id ? ' active' : '')}
            onClick={() => onNavigate(item.id)}
          >
            <Icon name={item.icon} size={15} />
            {item.label}
          </button>
        ))}
      </div>
    </aside>
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

function CityHero({ city, country, dateRange, nights, hotels = [] }) {
  return (
    <div style={{
      background: 'var(--surface)', border: '1px solid var(--line)',
      borderRadius: 14, overflow: 'hidden', marginBottom: 12,
    }}>
      <div style={{ display: 'grid', gridTemplateColumns: '120px 1fr', gap: 0 }}>
        <CityPhoto city={city} h={120} w="100%" radius={0} />
        <div style={{ padding: '12px 16px', display: 'flex', flexDirection: 'column', justifyContent: 'center' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 4, flexWrap: 'wrap' }}>
            <span className="eyebrow" style={{ color: 'var(--brand)' }}>
              <Icon name="pin" size={11} style={{ verticalAlign: -1, marginRight: 3 }} /> {country || city}
            </span>
          </div>
          <div style={{ display: 'flex', alignItems: 'baseline', gap: 12, flexWrap: 'wrap' }}>
            <h2 style={{ marginBottom: 0, fontSize: 24 }}>{city}</h2>
            {dateRange && <span className="muted num" style={{ fontSize: 13 }}>{dateRange}</span>}
            {nights > 0 && (
              <span className="muted" style={{ fontSize: 13 }}>
                · {nights} {nights === 1 ? 'ночь' : nights < 5 ? 'ночи' : 'ночей'}
              </span>
            )}
          </div>
        </div>
      </div>
      <div style={{ padding: '12px 16px', borderTop: '1px solid var(--line-2)', display: 'flex', flexDirection: 'column', gap: 8 }}>
        {hotels.length > 0 ? hotels.map((h, i) => (
          <div key={i} style={{
            display: 'flex', alignItems: 'center', gap: 12,
            padding: 10, background: 'var(--wash)', borderRadius: 10, border: '1px solid var(--line-2)',
          }}>
            <div style={{ width: 36, height: 36, borderRadius: 8, background: 'var(--success-soft)', color: 'var(--success)', display: 'grid', placeItems: 'center', flexShrink: 0 }}>
              <Icon name="bed" size={18} />
            </div>
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ fontSize: 13.5, fontWeight: 600 }}>{h.hotel}</div>
              <div className="muted num" style={{ fontSize: 11.5, marginTop: 2 }}>
                {h.checkIn && `Заезд ${h.checkIn}`}
                {h.checkOut && ` · Выезд ${h.checkOut}`}
              </div>
            </div>
            {h.price && <div className="num" style={{ fontWeight: 600, fontSize: 14 }}>{fmt(h.price, h.cur || 'EUR')}</div>}
          </div>
        )) : (
          <div style={{
            display: 'flex', alignItems: 'center', gap: 12,
            padding: 10, background: 'var(--warning-soft)', borderRadius: 10, border: '1.5px dashed var(--warning)',
          }}>
            <div style={{ width: 36, height: 36, borderRadius: 8, background: 'rgba(201,138,26,.2)', color: 'var(--warning)', display: 'grid', placeItems: 'center', flexShrink: 0 }}>
              <Icon name="warning" size={18} />
            </div>
            <div style={{ flex: 1, fontSize: 13, color: 'var(--warning)' }}>
              Отель в {city} не добавлен
            </div>
          </div>
        )}
      </div>
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

// Find which visit a day belongs to
function visitForDay(day, visits) {
  return visits.find(v => {
    const s = naiveDayKey(v.start_datetime);
    const e = naiveDayKey(v.end_datetime);
    return s && e && day >= s && day <= e;
  }) || null;
}

// Count nights between two date strings 'yyyy-MM-dd'
function nightsBetween(startDay, endDay) {
  const s = parseNaive(startDay);
  const e = parseNaive(endDay);
  if (!s || !e) return 0;
  return Math.max(0, Math.round(e.diff(s, 'days').days));
}

function TimelineLens({ stream, visits, trip, isLoading }) {
  if (isLoading) return <SkeletonTimeline />;

  if (!trip.start_date && !trip.end_date && !visits.length) {
    return (
      <EmptyState
        icon="list"
        title="Хронология пуста"
        body="Добавь отели, переезды и активности — они появятся здесь в хронологическом порядке."
      />
    );
  }

  // Determine timeline bounds: prefer trip dates, fall back to visit dates
  const tripStart = trip.start_date
    || (visits.length ? naiveDayKey(visits[0].start_datetime) : null);
  const tripEnd = trip.end_date
    || (visits.length ? naiveDayKey(visits[visits.length - 1].end_datetime) : null);

  if (!tripStart || !tripEnd) {
    return (
      <EmptyState
        icon="list"
        title="Даты трипа не заданы"
        body="Укажи даты трипа, чтобы увидеть хронологию."
      />
    );
  }

  // Build event lookup by date
  const eventsByDate = {};
  for (const e of stream) {
    if (!eventsByDate[e.date]) eventsByDate[e.date] = [];
    eventsByDate[e.date].push(e);
  }

  // Build hotel lookup per city_visit_id from stream (hotel-checkin events)
  const hotelsByVisit = {};
  for (const e of stream) {
    if (e.type === 'hotel-checkin') {
      // find which visit this hotel belongs to by matching city name or date
      const visit = visits.find(v => {
        if (e.city && v.city_name === e.city) return true;
        const vStart = naiveDayKey(v.start_datetime);
        const vEnd = naiveDayKey(v.end_datetime);
        return vStart && vEnd && e.date >= vStart && e.date <= vEnd;
      });
      if (visit) {
        if (!hotelsByVisit[visit.id]) hotelsByVisit[visit.id] = [];
        // avoid duplicates by hotelId
        if (!hotelsByVisit[visit.id].find(h => h.hotelId === e.hotelId)) {
          hotelsByVisit[visit.id].push({
            hotel: e.hotel,
            hotelId: e.hotelId,
            checkIn: e.date,
            checkOut: null, // checkout event would be separate
            price: e.price,
            cur: e.cur,
            nights: e.nights,
          });
        }
      }
    }
  }

  // Add checkout dates to hotel entries
  for (const e of stream) {
    if (e.type === 'hotel-checkout') {
      for (const visitId of Object.keys(hotelsByVisit)) {
        const entry = hotelsByVisit[visitId].find(h => h.hotelId === e.hotelId);
        if (entry) entry.checkOut = e.date;
      }
    }
  }

  const days = buildDayList(tripStart, tripEnd);

  const rows = [];
  let prevVisitId = null;

  for (const day of days) {
    const visit = visitForDay(day, visits);

    // Inject CityHero when city changes
    if (visit && visit.id !== prevVisitId) {
      const vStart = naiveDayKey(visit.start_datetime);
      const vEnd = naiveDayKey(visit.end_datetime);
      const nights = nightsBetween(vStart, vEnd);
      const dateRange = vStart && vEnd ? `${fmtDate(vStart)} — ${fmtDate(vEnd)}` : null;
      const visitHotels = hotelsByVisit[visit.id] || [];
      rows.push(
        <CityHero
          key={`city-${visit.id}`}
          city={visit.city_name}
          country={visit.country_name}
          dateRange={dateRange}
          nights={nights}
          hotels={visitHotels}
        />
      );
      prevVisitId = visit.id;
    }

    const dayEvents = eventsByDate[day] || [];

    rows.push(
      <div key={`day-${day}`} style={{ marginBottom: 24 }}>
        {/* Date separator */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 10, marginTop: 4 }}>
          <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--ink-2)' }}>
            {fmtDate(day)}
            <span style={{ color: 'var(--muted-2)', fontWeight: 400, marginLeft: 5 }}>· {weekday(day)}</span>
          </div>
          {visit && (
            <span style={{ display: 'inline-flex', alignItems: 'center', gap: 5, padding: '2px 8px 2px 6px', borderRadius: 999, background: 'var(--brand-soft)', color: 'var(--brand)', fontSize: 11.5, fontWeight: 500 }}>
              <Icon name="pin" size={11} />
              {visit.city_name}
            </span>
          )}
        </div>

        {/* Events or placeholder */}
        {dayEvents.length > 0 ? (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            {dayEvents.map((e, idx) => (
              <StreamEventRow key={e.id} e={e} last={idx === dayEvents.length - 1} onClick={() => {}} />
            ))}
          </div>
        ) : (
          <div style={{
            padding: '10px 14px',
            background: 'var(--wash)',
            border: '1px dashed var(--line)',
            borderRadius: 10,
            fontSize: 12.5,
            color: 'var(--muted)',
            textAlign: 'center',
          }}>
            Нет событий
          </div>
        )}
      </div>
    );
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column' }}>
      {rows}
    </div>
  );
}

// ─── LensStub ─────────────────────────────────────────────────────────────────

const LENS_META = {
  map:      { icon: 'map',      label: 'Карта'        },
  calendar: { icon: 'calendar', label: 'Календарь'    },
  budget:   { icon: 'wallet',   label: 'Бюджет'       },
  hotels:   { icon: 'vote',     label: 'Отели'        },
  docs:     { icon: 'file',     label: 'Документы'    },
  members:  { icon: 'users',    label: 'Участники'    },
  settings: { icon: 'settings', label: 'Настройки'    },
  ai:       { icon: 'sparkles', label: 'ИИ-помощник'  },
  chat:     { icon: 'chat',     label: 'Чат'          },
};

function LensStub({ lens }) {
  const meta = LENS_META[lens] || { icon: 'spark', label: lens };
  return (
    <div style={{ padding: 32, textAlign: 'center', color: 'var(--muted)' }}>
      <Icon name={meta.icon} size={32} style={{ marginBottom: 12, color: 'var(--muted-2)' }} />
      <div style={{ fontSize: 16, fontWeight: 500 }}>{meta.label}</div>
      <div style={{ fontSize: 13, marginTop: 6 }}>Скоро здесь будет контент</div>
    </div>
  );
}

// ─── TripCoverStrip ──────────────────────────────────────────────────────────

function TripCoverStrip({ trip, visits, members, myRole }) {
  const [routeOpen, setRouteOpen] = useState(false);
  const activeMemberCount = members.filter(m => m.status === 'active').length || 1;
  const cities = visits.map(v => v.city_name).filter(Boolean);
  const dateRange = formatTripRange(visits, '—');

  return (
    <div style={{ marginBottom: 22, borderBottom: '1px solid var(--line-2)', paddingBottom: 22 }}>
      {/* Gradient cover */}
      <div style={{
        position: 'relative', marginBottom: 18, height: 160, borderRadius: 16,
        overflow: 'hidden',
        background: 'linear-gradient(135deg, hsl(210, 60%, 55%) 0%, hsl(195, 55%, 50%) 40%, hsl(25, 65%, 60%) 100%)',
      }}>
        <svg viewBox="0 0 800 200" preserveAspectRatio="none" style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', opacity: 0.55 }}>
          <path d="M0 130 Q 200 80 400 110 T 800 95 L 800 200 L 0 200 Z" fill="rgba(255,255,255,.55)" />
          <path d="M0 160 Q 250 110 450 140 T 800 130 L 800 200 L 0 200 Z" fill="rgba(255,255,255,.32)" />
          <circle cx="680" cy="50" r="28" fill="rgba(255,255,255,.65)" />
        </svg>
        <div style={{ position: 'absolute', inset: 0, background: 'linear-gradient(180deg, transparent 30%, rgba(0,0,0,.38) 100%)' }} />
        <div style={{ position: 'absolute', left: 22, right: 22, bottom: 18 }}>
          <div style={{
            color: 'white', fontFamily: 'var(--font-display)', fontWeight: 700,
            fontSize: 'clamp(24px, 4vw, 36px)', letterSpacing: '-0.03em', lineHeight: 1,
            textShadow: '0 2px 12px rgba(0,0,0,.3)',
          }}>{trip?.title || '…'}</div>
          {dateRange && dateRange !== '—' && (
            <div className="num" style={{ color: 'rgba(255,255,255,.85)', fontSize: 13, marginTop: 8, fontWeight: 500 }}>
              {dateRange}
            </div>
          )}
        </div>
      </div>

      {/* Meta row + actions */}
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 12, alignItems: 'center', justifyContent: 'space-between' }}>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, alignItems: 'center' }}>
          {/* Cities chip */}
          {cities.length > 0 && (
            <div style={{ position: 'relative' }}>
              <button
                onClick={() => setRouteOpen(!routeOpen)}
                style={{
                  display: 'inline-flex', alignItems: 'center', gap: 6,
                  padding: '5px 10px 5px 8px', borderRadius: 999,
                  background: 'var(--brand-soft)', border: '1px solid var(--brand-soft-12)',
                  fontSize: 12.5, color: 'var(--brand)', fontWeight: 600, cursor: 'pointer',
                }}>
                <Icon name="pin" size={13} />
                {cities.length} {cities.length === 1 ? 'город' : cities.length < 5 ? 'города' : 'городов'}
                <Icon name={routeOpen ? 'chevD' : 'chev'} size={11} />
              </button>
              {routeOpen && (
                <div
                  onClick={() => setRouteOpen(false)}
                  style={{
                    position: 'absolute', top: 'calc(100% + 6px)', left: 0, zIndex: 20,
                    background: 'var(--surface)', border: '1px solid var(--line)',
                    borderRadius: 12, padding: '10px 12px', boxShadow: 'var(--shadow-pop)', minWidth: 180,
                  }}>
                  {cities.map((c, i) => (
                    <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '5px 0', fontSize: 13 }}>
                      <Icon name="pin" size={12} style={{ color: 'var(--brand)', flexShrink: 0 }} />
                      {c}
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}
          {/* Travelers chip */}
          <span style={{
            display: 'inline-flex', alignItems: 'center', gap: 5,
            padding: '5px 10px 5px 8px', borderRadius: 999,
            background: '#1f8a5b22', border: '1px solid #1f8a5b33',
            fontSize: 12.5, color: 'var(--success)', fontWeight: 600,
          }}>
            <Icon name="users" size={13} />
            {activeMemberCount} {activeMemberCount === 1 ? 'участник' : activeMemberCount < 5 ? 'участника' : 'участников'}
          </span>
        </div>
        {/* Action buttons */}
        <div style={{ display: 'flex', gap: 6, alignItems: 'center', flexWrap: 'wrap' }}>
          {myRole !== 'viewer' && (
            <Btn variant="ghost" size="sm" icon="edit">Редактировать</Btn>
          )}
          <Btn variant="ghost" size="sm" icon="share">Поделиться</Btn>
          <Btn variant="ghost" size="sm" icon="download">Экспорт</Btn>
          <Btn variant="ghost" size="sm" icon="more" />
        </div>
      </div>
    </div>
  );
}

// ─── ContextSide ──────────────────────────────────────────────────────────────

function ContextSide({ budget, budgetExpenses, members, isLoading }) {
  const totalSpent = budgetExpenses.reduce((s, e) => s + Number(e.original_amount || 0), 0);
  const mainCurrency = budget?.currency || 'EUR';
  const activeMembers = members.filter(m => m.status === 'active');

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 14, position: 'sticky', top: 80 }}>
      {/* Budget widget */}
      <div style={{ background: 'var(--surface)', border: '1px solid var(--line)', borderRadius: 14, padding: 16 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 12 }}>
          <div style={{ width: 28, height: 28, borderRadius: 7, background: 'var(--brand-soft)', color: 'var(--brand)', display: 'grid', placeItems: 'center' }}>
            <Icon name="wallet" size={14} />
          </div>
          <span style={{ fontWeight: 600, fontSize: 13.5 }}>Бюджет</span>
        </div>
        {budget ? (
          <>
            <div className="num" style={{ fontSize: 24, fontWeight: 700, letterSpacing: '-0.02em' }}>{fmt(totalSpent, mainCurrency)}</div>
            <div className="muted" style={{ fontSize: 12, marginTop: 2 }}>всего потрачено</div>
            <div style={{ marginTop: 10, height: 5, borderRadius: 3, background: 'var(--wash)', overflow: 'hidden' }}>
              <div style={{ height: '100%', width: Math.min(100, totalSpent > 0 ? 65 : 0) + '%', background: 'var(--success)' }} />
            </div>
          </>
        ) : (
          <div className="muted" style={{ fontSize: 12.5 }}>Бюджет не создан</div>
        )}
      </div>

      {/* Who's going widget */}
      <div style={{ background: 'var(--surface)', border: '1px solid var(--line)', borderRadius: 14, padding: 16 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 12 }}>
          <div style={{ width: 28, height: 28, borderRadius: 7, background: '#1f8a5b22', color: 'var(--success)', display: 'grid', placeItems: 'center' }}>
            <Icon name="users" size={14} />
          </div>
          <span style={{ fontWeight: 600, fontSize: 13.5 }}>Кто едет</span>
          <span className="muted" style={{ fontSize: 12, marginLeft: 'auto' }}>{activeMembers.length}</span>
        </div>
        {activeMembers.length === 0 && (
          <div className="muted" style={{ fontSize: 12.5 }}>Нет участников</div>
        )}
        {activeMembers.slice(0, 6).map((m, i) => {
          const name = m.user_full_name || m.user_email || '—';
          const roleLabel = m.role === 'owner' ? 'Влад.' : m.role === 'admin' ? 'Адм.' : m.role === 'editor' ? 'Ред.' : 'Зрит.';
          return (
            <div key={m.id || i} style={{
              display: 'flex', alignItems: 'center', gap: 8,
              padding: '5px 0',
              borderBottom: i < Math.min(activeMembers.length, 6) - 1 ? '1px solid var(--line-2)' : 'none',
            }}>
              <Avatar name={name} size="sm" />
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontSize: 12.5, fontWeight: 500, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{name}</div>
              </div>
              <Badge variant="quiet" style={{ fontSize: 10, flexShrink: 0 }}>{roleLabel}</Badge>
            </div>
          );
        })}
      </div>
    </div>
  );
}

// ─── TripView (main export) ───────────────────────────────────────────────────

export default function TripView() {
  const { tripId } = useParams();
  const nav = useNavigate();
  const qc = useQueryClient();
  const [searchParams, setSearchParams] = useSearchParams();
  const { user } = useAuth();
  const lens = searchParams.get('lens') || 'timeline';

  const [theme, setTheme] = useState(() => {
    try { return localStorage.getItem('triplanio:theme') || 'light'; } catch { return 'light'; }
  });

  // Theme sync
  useEffect(() => {
    document.documentElement.setAttribute('data-theme', theme);
    try { localStorage.setItem('triplanio:theme', theme); } catch {}
  }, [theme]);

  // Wire window.__navigate so Screen components can navigate
  useEffect(() => {
    window.__navigate = (target) => {
      if (target === 'collection') { nav('/trips'); return; }
      if (target === 'ai-planner') { nav('/plan-trip-ai'); return; }
      const lensIds = ['timeline', 'map', 'calendar', 'budget', 'hotels', 'docs', 'members', 'settings', 'ai', 'chat'];
      if (lensIds.includes(target)) {
        const sp = new URLSearchParams(searchParams);
        if (target === 'timeline') sp.delete('lens'); else sp.set('lens', target);
        setSearchParams(sp, { replace: false });
      }
    };
    return () => { window.__navigate = undefined; };
  }, [tripId, nav, searchParams, setSearchParams]);

  const setLens = (id) => {
    const sp = new URLSearchParams(searchParams);
    if (id === 'timeline') sp.delete('lens'); else sp.set('lens', id);
    setSearchParams(sp, { replace: false });
    window.scrollTo(0, 0);
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

  // Fetch content (hotels, activities, transfers) — only after shell resolves
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
  const budget           = contentData?.budget       || null;
  const budgetCategories = contentData?.budgetCategories || [];
  const budgetExpenses   = contentData?.budgetExpenses   || [];

  // Resolve current user's role in this trip
  const myMember = members.find(m => m.user_email === user?.email);
  const myRole   = myMember?.role || (trip?.created_by === user?.email ? 'owner' : 'viewer');

  const stream = useMemo(
    () => buildEventStream(hotels, activities, transfers, visits),
    [hotels, activities, transfers, visits],
  );

  const isPro = ['pro_monthly', 'pro_yearly', 'pro_trip'].includes(user?.subscription_status);

  if (loadingShell) return <LoadingScreen />;
  if (shellError || !trip) return <ErrorScreen onBack={() => nav('/trips')} />;

  return (
    <div className="app" style={{ minHeight: '100vh', background: 'var(--bg, var(--wash))' }}>
      <TripHeader
        trip={trip}
        visits={visits}
        isPro={isPro}
        theme={theme}
        setTheme={setTheme}
        user={user}
        nav={nav}
      />
      <div className="app-body">
        <TripSidebar tripId={tripId} lens={lens} onNavigate={setLens} />
        <main style={{ minWidth: 0, padding: '28px 28px 60px' }}>
          {lens === 'timeline' && (
            <>
              <TripCoverStrip
                trip={trip}
                visits={visits}
                members={members}
                myRole={myRole}
              />
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 260px', gap: 24, alignItems: 'start' }}>
                <TimelineLens
                  stream={stream}
                  visits={visits}
                  trip={trip}
                  isLoading={loadingContent}
                />
                <ContextSide
                  budget={budget}
                  budgetExpenses={budgetExpenses}
                  members={members}
                  isLoading={loadingContent}
                />
              </div>
            </>
          )}
          {lens === 'budget' && (
            <BudgetLens
              tripId={tripId}
              budget={budget}
              budgetCategories={budgetCategories}
              budgetExpenses={budgetExpenses}
              members={members}
              cityVisits={visits}
              isLoading={loadingContent}
              isPro={isPro}
              queryClient={qc}
            />
          )}
          {lens === 'members' && (
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
          {!['timeline','budget','members'].includes(lens) && <LensStub lens={lens} />}
        </main>
      </div>

      <ModalHost />
      <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>
    </div>
  );
}
