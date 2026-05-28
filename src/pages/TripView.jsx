import React, { useMemo, useState, useEffect } from 'react';
import { useParams, useNavigate, useSearchParams } from 'react-router-dom';
import { useQuery, useQueryClient } from '@tanstack/react-query';

import { supabase } from '@/api/supabaseClient';
import { useAuth } from '@/lib/AuthContext';
import { TRIP_SHELL_KEY, TRIP_CONTENT_KEY } from '@/lib/trip-data';
import { naiveDayKey, parseNaive, formatNaive } from '@/lib/naive-time';
import { formatTripRange } from '@/lib/trip-dates';
import { isProActive } from '@/lib/subscription';
import { useTheme } from '@/lib/ThemeContext';
import { Icon } from '../design/icons';
import HeaderActions from '@/components/HeaderActions';
import { Avatar, Btn, EmptyState, Skeleton, ModalHost, fmtDate, weekday, StreamEventRow, fmt, CityPhoto } from '../design/index';
import { sortVisits } from '@/lib/validation';
import { DateTime } from 'luxon';
import TransferDialog from '../components/transfers/TransferDialog';
import HotelDialog from '../components/hotels/HotelDialog';
import CityVisitDialog from '../components/visits/CityVisitDialog';
import ActivityDialog from '../components/activities/ActivityDialog';
import SourceViewLoader from '../components/budget/SourceViewLoader';
import BudgetLens from './BudgetLens';
import MembersLens from './MembersLens';
import CalendarLens from './CalendarLens';
import DocsLens from './DocsLens';
import SettingsLens from './SettingsLens';
import ChatLens from './ChatLens';
import MapView from '@/components/views/MapView';
import UpgradePlanDialog from '@/components/subscriptions/UpgradePlanDialog';
import PaymentSuccessDialog from '@/components/common/PaymentSuccessDialog';
import PaymentFailDialog from '@/components/common/PaymentFailDialog';
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
        platformUrl: h.booking_url,
        num: h.booking_reference,
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
      title: t.carrier || (isPlane ? 'Перелёт' : 'Переезд'),
      from: cityForVisit(t.from_city_visit_id, visits) || t.from_address,
      to: cityForVisit(t.to_city_visit_id, visits) || t.to_address,
      kind,
      carrier: t.carrier,
      num: t.booking_reference,
      price: t.price,
      cur: t.currency,
      platformUrl: t.booking_url,
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
    <div className="app" style={{ minHeight: '100vh', background: 'var(--bg, var(--wash))' }}>
      {/* Skeleton header */}
      <header className="app-header">
        <div style={{ width: 28, height: 28, borderRadius: 7, background: 'var(--line)', flexShrink: 0 }} />
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <Skeleton w={28} h={28} r={7} />
          <Skeleton w={90} h={14} r={5} />
        </div>
        <div style={{ flex: 1 }}>
          <Skeleton w={160} h={14} r={5} />
        </div>
        <div style={{ display: 'flex', gap: 8 }}>
          <Skeleton w={28} h={28} r={7} />
          <Skeleton w={28} h={28} r={7} />
          <Skeleton w={32} h={32} r={999} />
        </div>
      </header>
      <div className="app-body">
        {/* Skeleton sidebar */}
        <aside className="app-side">
          <div className="app-side__group">
            <div className="app-side__group-label">Линзы трипа</div>
            {[1, 2, 3, 4, 5, 6].map(i => (
              <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '8px 10px' }}>
                <Skeleton w={15} h={15} r={4} />
                <Skeleton w={80 + (i % 3) * 15} h={12} r={4} />
              </div>
            ))}
          </div>
          <div className="app-side__group">
            <div className="app-side__group-label">Управление</div>
            {[1, 2, 3, 4].map(i => (
              <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '8px 10px' }}>
                <Skeleton w={15} h={15} r={4} />
                <Skeleton w={70 + (i % 3) * 10} h={12} r={4} />
              </div>
            ))}
          </div>
        </aside>
        {/* Skeleton main content */}
        <main style={{ minWidth: 0, padding: '28px 28px 60px' }}>
          {/* Cover strip skeleton */}
          <div style={{ marginBottom: 22, borderBottom: '1px solid var(--line-2)', paddingBottom: 22 }}>
            <Skeleton w="100%" h={160} r={16} style={{ marginBottom: 14 }} />
            <div style={{ display: 'flex', gap: 10, alignItems: 'center' }}>
              <Skeleton w={90} h={28} r={999} />
              <Skeleton w={110} h={28} r={999} />
              <div style={{ flex: 1 }} />
              <Skeleton w={120} h={30} r={8} />
              <Skeleton w={90} h={30} r={8} />
              <Skeleton w={80} h={30} r={8} />
            </div>
          </div>
          {/* Timeline + sidebar skeleton — same building blocks as the loaded
              layout, so nothing reshuffles when shell → content resolves. */}
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 260px', gap: 24, alignItems: 'start' }}>
            <SkeletonTimeline />
            <RightRailSkeleton />
          </div>
        </main>
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

function TripHeader({ trip, visits, isPro, isDark, onToggleTheme, user, nav }) {
  const dateRange = formatTripRange(visits, '—');

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
          {trip?.is_pro_trip && !isPro && (
            <span style={{ background: 'var(--warm-tint)', color: 'var(--warm)', padding: '2px 7px', borderRadius: 999, fontSize: 10.5, fontWeight: 700, letterSpacing: '.04em', flexShrink: 0 }}>PRO</span>
          )}
        </div>
      </div>

      <HeaderActions user={user} isPro={isPro} isDark={isDark} onToggleTheme={onToggleTheme} />
    </header>
  );
}

// ─── TripSidebar ──────────────────────────────────────────────────────────────

const LENS_ITEMS = [
  { id: 'timeline',  label: 'Хронология',   icon: 'list'     },
  { id: 'map',       label: 'Карта',         icon: 'map'      },
  { id: 'calendar',  label: 'Календарь',     icon: 'calendar' },
  { id: 'budget',    label: 'Бюджет',        icon: 'wallet'   },
  { id: 'docs',      label: 'Документы',     icon: 'file'     },
  { id: 'chat',      label: 'Чат',           icon: 'chat'     },
];

const MGMT_ITEMS = [
  { id: 'members',   label: 'Участники',     icon: 'users'    },
  { id: 'settings',  label: 'Настройки',     icon: 'settings' },
];

// Addon-gated lenses: shown unless the trip explicitly disabled them.
const GATED_LENS_ADDON = { calendar: 'calendar', budget: 'budget', chat: 'chat' };

function isLensVisible(trip, lensId) {
  const key = GATED_LENS_ADDON[lensId];
  if (!key) return true;
  return trip?.details?.addons?.[key] !== false;
}

function TripSidebar({ tripId, trip, lens, onNavigate, isPro, onUpgrade }) {
  const lensItems = LENS_ITEMS.filter(item => isLensVisible(trip, item.id));
  const showUpgrade = !trip?.is_pro_trip && !isPro;
  return (
    <aside className="app-side">
      <div className="app-side__group">
        <div className="app-side__group-label">Линзы трипа</div>
        {lensItems.map(item => (
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
      {showUpgrade && (
        <div style={{ margin: '10px 6px 0', padding: 12, borderRadius: 10, background: 'var(--warm-tint)' }}>
          <div style={{ fontSize: 12.5, fontWeight: 600, color: 'var(--warm)', marginBottom: 4 }}>Free-трип</div>
          <div style={{ fontSize: 11.5, color: 'var(--ink-2)', marginBottom: 8, lineHeight: 1.45 }}>
            Календарь, бюджет-разбивка, ИИ и чат закрыты Pro.
          </div>
          <Btn variant="primary" size="sm" block icon="pro" onClick={onUpgrade}>Апгрейд трипа</Btn>
        </div>
      )}
    </aside>
  );
}

// ─── AddDayButton — shown in edit mode after each day ────────────────────────
function AddDayButton({ dayKey, onAddCity, onAddActivity }) {
  const [open, setOpen] = useState(false);
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap', marginTop: 6 }}>
      <button
        type="button"
        onClick={() => setOpen(o => !o)}
        style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '6px 12px', borderRadius: 10, border: '1.5px dashed var(--line)', background: 'transparent', color: 'var(--muted)', fontSize: 13, cursor: 'pointer', transition: 'color .15s, border-color .15s' }}
        onMouseEnter={e => { e.currentTarget.style.color = 'var(--ink)'; e.currentTarget.style.borderColor = 'var(--brand)'; }}
        onMouseLeave={e => { e.currentTarget.style.color = 'var(--muted)'; e.currentTarget.style.borderColor = 'var(--line)'; }}
      >
        <Icon name="plus" size={13} /> Добавить
      </button>
      {open && (
        <>
          <button
            type="button"
            onClick={() => { setOpen(false); onAddCity?.(dayKey); }}
            style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '6px 12px', borderRadius: 10, border: '1px solid var(--line)', background: 'var(--surface)', fontSize: 13, fontWeight: 500, cursor: 'pointer' }}
            onMouseEnter={e => e.currentTarget.style.background = 'var(--wash)'}
            onMouseLeave={e => e.currentTarget.style.background = 'var(--surface)'}
          >
            <Icon name="pin" size={13} style={{ color: 'var(--muted)' }} /> Добавить город
          </button>
          <button
            type="button"
            onClick={() => { setOpen(false); onAddActivity?.(dayKey); }}
            style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '6px 12px', borderRadius: 10, border: '1px solid var(--line)', background: 'var(--surface)', fontSize: 13, fontWeight: 500, cursor: 'pointer' }}
            onMouseEnter={e => e.currentTarget.style.background = 'var(--wash)'}
            onMouseLeave={e => e.currentTarget.style.background = 'var(--surface)'}
          >
            <Icon name="sparkles" size={13} style={{ color: 'var(--muted)' }} /> Добавить активность
          </button>
        </>
      )}
    </div>
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

// Right-rail (budget / who's going / services) placeholder — shared by the
// full-page LoadingScreen and ContextSide so the right column never reshuffles.
function RightRailSkeleton() {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
      <Skeleton w="100%" h={100} r={14} />
      <Skeleton w="100%" h={150} r={14} />
      <Skeleton w="100%" h={120} r={14} />
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

// ─── StreamAnchor ─────────────────────────────────────────────────────────────

function StreamAnchor({ label, sub, color, icon }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 14, margin: '16px 0', paddingLeft: 8 }}>
      <div style={{ width: 28, height: 28, borderRadius: '50%', background: color, color: 'white', display: 'grid', placeItems: 'center', flexShrink: 0 }}>
        <Icon name={icon} size={13} />
      </div>
      <div>
        <div style={{ fontWeight: 600, fontSize: 14 }}>{label}</div>
        {sub && <div className="muted" style={{ fontSize: 12 }}>{sub}</div>}
      </div>
    </div>
  );
}

// ─── MissingHotelWarning ──────────────────────────────────────────────────────

function MissingHotelWarning({ city, onAdd }) {
  const [open, setOpen] = useState(true);
  if (!open) return null;
  return (
    <div style={{
      display: 'flex', alignItems: 'center', gap: 12,
      padding: 10, background: 'var(--warning-soft)', borderRadius: 10, border: '1.5px dashed var(--warning)',
    }}>
      <div style={{ width: 36, height: 36, borderRadius: 8, background: 'rgba(201,138,26,.2)', color: 'var(--warning)', display: 'grid', placeItems: 'center', flexShrink: 0 }}>
        <Icon name="warning" size={18} />
      </div>
      <div style={{ flex: 1 }}>
        <div style={{ fontSize: 13, fontWeight: 600 }}>Нет бронирования в {city}</div>
        <div className="muted" style={{ fontSize: 11.5 }}>Добавь отель или место проживания</div>
      </div>
      <Btn variant="primary" size="sm" icon="plus" onClick={onAdd}>Добавить</Btn>
      <button onClick={() => setOpen(false)} style={{ width: 22, height: 22, borderRadius: 6, border: 'none', background: 'transparent', color: 'var(--muted)', cursor: 'pointer', display: 'grid', placeItems: 'center' }}>
        <Icon name="close" size={12} />
      </button>
    </div>
  );
}

// ─── MissingTransferWarning ───────────────────────────────────────────────────

function MissingTransferWarning({ from, to, fromVisit, toVisit, onAdd }) {
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
      <div style={{ flex: 1, fontSize: 13.5, fontWeight: 600 }}>
        Нет переезда · {from} → {to}
      </div>
      <Btn variant="primary" size="sm" icon="plus" onClick={() => onAdd?.(fromVisit, toVisit)}>Добавить переезд</Btn>
      <button onClick={() => setHidden(true)} style={{ width: 24, height: 24, borderRadius: 6, border: 'none', background: 'transparent', color: 'var(--warning)', cursor: 'pointer', display: 'grid', placeItems: 'center' }}>
        <Icon name="close" size={12} />
      </button>
    </div>
  );
}

// ─── CityHero (with proper hotel warning) ────────────────────────────────────

function CityHero({ city, country, dateRange, nights, hotels = [], visit, onAddHotel, isEditMode, onEditNotes, onDeleteCity }) {
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
            {isEditMode && (
              <button
                type="button"
                onClick={() => onEditNotes?.(visit)}
                title="Редактировать город"
                style={{ display: 'inline-flex', alignItems: 'center', gap: 4, padding: '3px 8px', borderRadius: 8, border: '1px solid var(--line)', background: 'var(--surface)', color: 'var(--muted)', fontSize: 12, cursor: 'pointer' }}
              >
                <Icon name="edit" size={12} /> Изменить
              </button>
            )}
            {isEditMode && onDeleteCity && (
              <button
                type="button"
                onClick={() => onDeleteCity?.(visit)}
                title="Удалить город"
                style={{ display: 'inline-flex', alignItems: 'center', gap: 4, padding: '3px 8px', borderRadius: 8, border: '1px solid var(--danger-soft)', background: 'var(--surface)', color: 'var(--danger)', fontSize: 12, cursor: 'pointer' }}
              >
                <Icon name="trash" size={12} /> Удалить
              </button>
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
                {h.checkIn && `Заезд ${fmtDate(h.checkIn)}`}
                {h.checkOut && ` · Выезд ${fmtDate(h.checkOut)}`}
                {h.nights && ` · ${h.nights} ${h.nights === 1 ? 'ночь' : 'ночи'}`}
              </div>
            </div>
            {h.price && <div className="num" style={{ fontWeight: 600, fontSize: 14 }}>{fmt(h.price, h.cur || 'EUR')}</div>}
          </div>
        )) : (
          <MissingHotelWarning city={city} onAdd={() => onAddHotel?.(visit)} />
        )}
      </div>
    </div>
  );
}

function TimelineLens({ stream, visits, transfers, trip, isLoading, onAddTransfer, onAddHotel, isEditMode, onAddCityForDay, onAddActivityForDay, onEditVisitNotes, onOpenEvent, onDeleteCity }) {
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

  // Build hotel lookup per visit
  const hotelsByVisit = {};
  for (const e of stream) {
    if (e.type === 'hotel-checkin') {
      const visit = visits.find(v => {
        if (e.city && v.city_name === e.city) return true;
        const vStart = naiveDayKey(v.start_datetime);
        const vEnd = naiveDayKey(v.end_datetime);
        return vStart && vEnd && e.date >= vStart && e.date <= vEnd;
      });
      if (visit) {
        if (!hotelsByVisit[visit.id]) hotelsByVisit[visit.id] = [];
        if (!hotelsByVisit[visit.id].find(h => h.hotelId === e.hotelId)) {
          hotelsByVisit[visit.id].push({
            hotel: e.hotel,
            hotelId: e.hotelId,
            checkIn: e.date,
            checkOut: null,
            price: e.price,
            cur: e.cur,
            nights: e.nights,
          });
        }
      }
    }
  }
  for (const e of stream) {
    if (e.type === 'hotel-checkout') {
      for (const visitId of Object.keys(hotelsByVisit)) {
        const entry = hotelsByVisit[visitId].find(h => h.hotelId === e.hotelId);
        if (entry) entry.checkOut = e.date;
      }
    }
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

  // Build missing-transfer map (by visit-ID pairs, not city names):
  //   - Warn for every consecutive pair lacking an inbound transfer, INCLUDING
  //     start→first-city and last-city→finish.
  //   - Only the start anchor itself has nothing before it, so it's skipped.
  const missingTransferByVisitId = {};
  for (let i = 0; i < ordered.length; i++) {
    const v = ordered[i];
    const prev = ordered[i - 1];
    if (!prev) continue;
    if (v.kind === 'start') continue;
    // Show warning for ALL pairs including start→city1 and cityN→end
    const inboundFromPrev = (inboundByVisit[v.id] || []).filter(
      tr => tr.from_city_visit_id === prev.id
    );
    if (inboundFromPrev.length === 0) {
      missingTransferByVisitId[v.id] = { fromVisit: prev, toVisit: v };
    }
  }

  const rows = [];
  let prevVisitId = null;
  // Missing-transfer warnings already emitted inside the day loop (keyed by
  // destination visit id) — so we don't render anchor cities' warnings twice.
  const renderedMissing = new Set();

  // Start anchor
  const startCity = ordered[0]?.city_name || 'Старт';
  const endCity   = ordered[ordered.length - 1]?.city_name || 'Финиш';
  rows.push(
    <StreamAnchor
      key="anchor-start"
      label={`Старт · ${startCity}`}
      sub={fmtDate(tripStart)}
      color="var(--brand)"
      icon="flag"
    />
  );

  for (const day of days) {
    const visit = visitForDay(day, visits);
    // Arrival day = first day this city's visit appears. The CityHero and the
    // "no transfer" warning belong to THIS day (rendered under its header),
    // not floating between the previous day and this one.
    const isArrival = !!(visit && visit.id !== prevVisitId);
    const mt = isArrival ? missingTransferByVisitId[visit.id] : null;
    if (mt) renderedMissing.add(visit.id);

    let cityHero = null;
    if (isArrival) {
      const vStart = naiveDayKey(visit.start_datetime);
      const vEnd = naiveDayKey(visit.end_datetime);
      const nights = nightsBetween(vStart, vEnd);
      const dateRange = vStart && vEnd ? `${fmtDate(vStart)} — ${fmtDate(vEnd)}` : null;
      const visitHotels = hotelsByVisit[visit.id] || [];
      cityHero = (
        <CityHero
          key={`city-${visit.id}`}
          city={visit.city_name}
          country={visit.country || visit.country_name}
          dateRange={dateRange}
          nights={nights}
          hotels={visitHotels}
          visit={visit}
          onAddHotel={onAddHotel}
          isEditMode={isEditMode}
          onEditNotes={onEditVisitNotes}
          onDeleteCity={onDeleteCity}
        />
      );
    }

    const dayEvents = eventsByDate[day] || [];

    rows.push(
      <div key={`day-${day}`} style={{ marginBottom: 24 }}>
        {/* Date separator — matches design: large bold date */}
        <div style={{ display: 'flex', alignItems: 'flex-end', gap: 12, padding: '12px 0 10px' }}>
          <div style={{ display: 'flex', alignItems: 'baseline', gap: 8 }}>
            <span className="num" style={{ fontFamily: 'var(--font-display)', fontWeight: 700, fontSize: 22, letterSpacing: '-0.02em', color: 'var(--ink)' }}>
              {fmtDate(day)}
            </span>
            <span className="muted" style={{ fontSize: 12, textTransform: 'uppercase', letterSpacing: '.08em', fontWeight: 600 }}>
              {weekday(day)}
            </span>
          </div>
          {visit && (
            <span style={{ display: 'inline-flex', alignItems: 'center', gap: 5, padding: '2px 8px 2px 6px', borderRadius: 999, background: 'var(--brand-soft)', color: 'var(--brand)', fontSize: 11.5, fontWeight: 500, marginBottom: 2 }}>
              <Icon name="pin" size={11} />
              {visit.city_name}
            </span>
          )}
          <div style={{ flex: 1, borderBottom: '1px solid var(--line-2)', marginBottom: 6 }} />
        </div>

        {/* Arrival into this city: missing-transfer warning + city hero */}
        {mt && (
          <div style={{ marginBottom: 8 }}>
            <MissingTransferWarning
              from={mt.fromVisit.city_name}
              to={mt.toVisit.city_name}
              fromVisit={mt.fromVisit}
              toVisit={mt.toVisit}
              onAdd={onAddTransfer}
            />
          </div>
        )}
        {cityHero}

        {/* Events or placeholder — never show the empty-day placeholder on an
            arrival day (the city hero already fills it). */}
        {dayEvents.length > 0 ? (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            {dayEvents.map((e, idx) => (
              <StreamEventRow key={e.id} e={e} last={idx === dayEvents.length - 1} onClick={() => onOpenEvent?.(e)} />
            ))}
          </div>
        ) : !isArrival && (
          <div style={{
            display: 'flex', alignItems: 'center', gap: 12,
            padding: '10px 14px',
            background: 'transparent', border: '1.5px dashed var(--line)',
            borderRadius: 10, color: 'var(--muted)',
          }}>
            <Icon name="info" size={14} />
            <div style={{ flex: 1, fontSize: 12.5 }}>На этот день ничего не запланировано</div>
          </div>
        )}
        {/* Edit mode: add buttons */}
        {isEditMode && (
          <AddDayButton
            dayKey={day}
            onAddCity={onAddCityForDay}
            onAddActivity={onAddActivityForDay}
          />
        )}
      </div>
    );

    if (isArrival) prevVisitId = visit.id;
  }

  // Any missing-transfer warnings not emitted in the day loop (e.g. into the
  // finish anchor city, which has no days of its own) — render before the end.
  for (const v of ordered) {
    const mt = missingTransferByVisitId[v.id];
    if (mt && !renderedMissing.has(v.id)) {
      rows.push(
        <MissingTransferWarning
          key={`mt-tail-${v.id}`}
          from={mt.fromVisit.city_name}
          to={mt.toVisit.city_name}
          fromVisit={mt.fromVisit}
          toVisit={mt.toVisit}
          onAdd={onAddTransfer}
        />
      );
    }
  }

  // End anchor
  rows.push(
    <StreamAnchor
      key="anchor-end"
      label={`Финиш · ${endCity}`}
      sub={fmtDate(tripEnd)}
      color="var(--ink-2)"
      icon="check"
    />
  );

  return (
    <div style={{ display: 'flex', flexDirection: 'column' }}>
      {rows}
    </div>
  );
}

// ─── Share / More dialogs ─────────────────────────────────────────────────────

function ShareDialog({ trip }) {
  const [shareUrl, setShareUrl] = useState('');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    if (!trip?.id) return;
    let cancelled = false;
    setLoading(true);
    setError('');
    supabase.functions.invoke('ensureShareToken', { body: { tripId: trip.id } })
      .then(({ data, error: invokeErr }) => {
        if (cancelled) return;
        if (invokeErr) { console.error('ensureShareToken error:', invokeErr); setError('Не удалось создать ссылку'); return; }
        const token = data?.shareToken || data?.token;
        if (token) {
          setShareUrl(`${window.location.origin}/public/trip/${trip.id}?t=${token}`);
        } else {
          setError('Не удалось создать ссылку');
        }
      })
      .catch(err => { if (!cancelled) { console.error('ensureShareToken error:', err); setError('Не удалось создать ссылку'); } })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [trip?.id]);

  function copyLink() {
    if (!shareUrl) return;
    navigator.clipboard?.writeText(shareUrl).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    });
  }
  return (
    <div style={{ position: 'fixed', inset: 0, zIndex: 999, display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'rgba(15,23,42,.45)', backdropFilter: 'blur(4px)' }}
      onClick={() => window.__closeModal?.()}>
      <div onClick={e => e.stopPropagation()} style={{ background: 'var(--surface)', border: '1px solid var(--line)', borderRadius: 18, padding: 28, width: 420, maxWidth: 'calc(100vw - 32px)', boxShadow: 'var(--shadow-pop)' }}>
        <h2 style={{ margin: '0 0 6px', fontSize: 20 }}>Поделиться трипом</h2>
        <div className="muted" style={{ fontSize: 13.5, marginBottom: 18 }}>Скопируй ссылку и отправь участникам — она откроется без входа в аккаунт</div>
        <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
          <input className="input" readOnly value={loading ? '' : shareUrl} placeholder={loading ? 'Генерируем ссылку…' : ''} style={{ flex: 1, fontSize: 12.5 }} onClick={e => e.target.select()} />
          <Btn variant="primary" icon="check" onClick={copyLink} disabled={loading || !shareUrl}>{copied ? 'Скопировано!' : 'Копировать'}</Btn>
        </div>
        {error && <div style={{ color: 'var(--danger, #dc2626)', fontSize: 12.5, marginTop: 10 }}>{error}</div>}
        <div style={{ marginTop: 18, textAlign: 'right' }}>
          <Btn variant="ghost" onClick={() => window.__closeModal?.()}>Закрыть</Btn>
        </div>
      </div>
    </div>
  );
}

function MoreMenuDialog({ tripId }) {
  return (
    <div style={{ position: 'fixed', inset: 0, zIndex: 999, display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'rgba(15,23,42,.45)', backdropFilter: 'blur(4px)' }}
      onClick={() => window.__closeModal?.()}>
      <div onClick={e => e.stopPropagation()} style={{ background: 'var(--surface)', border: '1px solid var(--line)', borderRadius: 18, padding: 20, width: 320, maxWidth: 'calc(100vw - 32px)', boxShadow: 'var(--shadow-pop)' }}>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
          <button onClick={() => { window.__closeModal?.(); window.__navigate?.('settings'); }} style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '12px 14px', borderRadius: 10, border: 'none', background: 'transparent', cursor: 'pointer', textAlign: 'left', fontSize: 14, color: 'var(--ink)' }}
            onMouseEnter={e => e.currentTarget.style.background = 'var(--wash)'}
            onMouseLeave={e => e.currentTarget.style.background = 'transparent'}>
            <Icon name="settings" size={16} style={{ color: 'var(--muted)' }} /> Настройки трипа
          </button>
          <button onClick={() => { window.__closeModal?.(); window.__navigate?.('members'); }} style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '12px 14px', borderRadius: 10, border: 'none', background: 'transparent', cursor: 'pointer', textAlign: 'left', fontSize: 14, color: 'var(--ink)' }}
            onMouseEnter={e => e.currentTarget.style.background = 'var(--wash)'}
            onMouseLeave={e => e.currentTarget.style.background = 'transparent'}>
            <Icon name="users" size={16} style={{ color: 'var(--muted)' }} /> Участники
          </button>
          <div style={{ height: 1, background: 'var(--line-2)', margin: '6px 0' }} />
          <button onClick={() => window.__closeModal?.()} style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '12px 14px', borderRadius: 10, border: 'none', background: 'transparent', cursor: 'pointer', textAlign: 'left', fontSize: 14, color: 'var(--muted)' }}>
            <Icon name="close" size={16} /> Закрыть
          </button>
        </div>
      </div>
    </div>
  );
}

// ─── TripCoverStrip ──────────────────────────────────────────────────────────

function TripCoverStrip({ trip, visits, members, myRole, isEditMode, onToggleEdit }) {
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
            isEditMode
              ? <Btn variant="primary" size="sm" icon="check" onClick={onToggleEdit}>Готово</Btn>
              : <Btn variant="ghost" size="sm" icon="edit" onClick={onToggleEdit}>Редактировать</Btn>
          )}
          <Btn variant="ghost" size="sm" icon="share" onClick={() => window.__openModal?.(<ShareDialog trip={trip} />)}>Поделиться</Btn>
          <Btn variant="ghost" size="sm" icon="download" onClick={() => window.print()}>Экспорт</Btn>
          <Btn variant="ghost" size="sm" icon="more" onClick={() => window.__openModal?.(<MoreMenuDialog tripId={trip?.id} />)} />
        </div>
      </div>
    </div>
  );
}

// ─── ContextSide ──────────────────────────────────────────────────────────────

function ContextSide({ budget, budgetExpenses, members, services = [], user, trip, isLoading }) {
  if (isLoading) {
    return <div style={{ position: 'sticky', top: 80 }}><RightRailSkeleton /></div>;
  }
  const totalSpent = budgetExpenses.reduce((s, e) => s + Number(e.original_amount || 0), 0);
  const mainCurrency = budget?.currency || trip?.details?.main_currency || trip?.main_currency || 'EUR';

  // Always show the owner first, then admins, viewers, offline, pending.
  // The owner often isn't a trip_members row (tracked via trip.created_by), so
  // synthesize it when missing.
  const orderedMembers = (() => {
    const ownerEmail = trip?.created_by || user?.email || '';
    const all = members.filter(m => m.status !== 'declined');
    if (ownerEmail && !all.some(m => m.role === 'owner' || m.user_email === ownerEmail)) {
      all.unshift({ id: '__owner__', user_email: ownerEmail, user_full_name: ownerEmail, role: 'owner', status: 'active' });
    }
    const rank = (m) => {
      if (m.role === 'owner') return 0;
      if (m.status === 'pending' || m.status === 'invited') return 4;
      if (m.status === 'offline') return 3;
      if (m.role === 'admin') return 1;
      return 2; // viewer / editor
    };
    return all
      .map((m, i) => ({ m, i }))
      .sort((a, b) => rank(a.m) - rank(b.m) || a.i - b.i)
      .map(x => x.m);
  })();

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 14, position: 'sticky', top: 80 }}>
      {/* Budget widget */}
      <div style={{ background: 'var(--surface)', border: '1px solid var(--line)', borderRadius: 14, padding: 16 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 10 }}>
          <h3 style={{ flex: 1, marginBottom: 0, fontSize: 14 }}>Бюджет</h3>
          <button
            onClick={() => window.__navigate?.('budget')}
            style={{ width: 26, height: 26, borderRadius: 7, border: '1px solid var(--line)', background: 'transparent', cursor: 'pointer', display: 'grid', placeItems: 'center', color: 'var(--muted-2)' }}
            title="Открыть бюджет">
            <Icon name="chev" size={13} />
          </button>
        </div>
        {budget ? (
          <>
            <div className="num" style={{ fontFamily: 'var(--font-display)', fontSize: 22, fontWeight: 600 }}>
              {fmt(totalSpent, mainCurrency)}
              <span className="muted" style={{ fontSize: 13, fontWeight: 500 }}> / {fmt(budget.planned_amount || 0, mainCurrency)}</span>
            </div>
            <div style={{ height: 6, borderRadius: 3, background: 'var(--wash)', overflow: 'hidden', marginTop: 10, marginBottom: 4 }}>
              <div style={{ height: '100%', width: Math.min(100, budget.planned_amount > 0 ? totalSpent / budget.planned_amount * 100 : 0) + '%', background: 'var(--brand)' }} />
            </div>
          </>
        ) : (
          <div className="muted" style={{ fontSize: 12.5 }}>Бюджет не создан</div>
        )}
      </div>

      {/* Who's going widget */}
      <div style={{ background: 'var(--surface)', border: '1px solid var(--line)', borderRadius: 14, padding: 16 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 10 }}>
          <h3 style={{ flex: 1, marginBottom: 0, fontSize: 14 }}>Кто едет</h3>
          <button
            onClick={() => window.__navigate?.('members')}
            style={{ width: 26, height: 26, borderRadius: 7, border: '1px solid var(--line)', background: 'transparent', cursor: 'pointer', display: 'grid', placeItems: 'center', color: 'var(--muted-2)' }}
            title="Открыть участников">
            <Icon name="chev" size={13} />
          </button>
        </div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          {orderedMembers.map((m, i) => {
            const name = m.user_full_name || m.user_email || '—';
            const isOffline = m.status === 'offline';
            const isPending = m.status === 'pending' || m.status === 'invited';
            const roleIcon = m.role === 'owner' ? 'crown' : m.role === 'admin' ? 'shield' : 'eye';
            const roleColor = m.role === 'owner' ? 'var(--warm)' : m.role === 'admin' ? 'var(--brand)' : 'var(--muted)';
            const roleLabel = isPending ? 'Ожидает приглашение'
              : isOffline ? 'Офлайн'
              : m.role === 'owner' ? 'Владелец'
              : m.role === 'admin' ? 'Админ' : 'Зритель';
            return (
              <div key={m.id || i} style={{ display: 'flex', alignItems: 'center', gap: 10, opacity: (isPending || isOffline) ? 0.65 : 1 }}>
                <Avatar name={name} size="sm" />
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontSize: 12.5, fontWeight: 500, display: 'flex', alignItems: 'center', gap: 4, lineHeight: 1.3 }}>
                    <Icon name={roleIcon} size={11} style={{ color: roleColor, flexShrink: 0 }} />
                    <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{name}</span>
                  </div>
                  <div style={{ fontSize: 11, marginTop: 1, color: isPending ? 'var(--warning)' : 'var(--muted)' }}>{roleLabel}</div>
                </div>
              </div>
            );
          })}
        </div>
      </div>

      {/* Services widget */}
      <ServicesWidget services={services} />
    </div>
  );
}

// ─── ServicesWidget ───────────────────────────────────────────────────────────

function ServicesWidget({ services = [] }) {
  const [moreOpen, setMoreOpen] = useState(false);
  const activeServices = services.filter(s => s.status === 'active' || s.status === 'booked');
  const pendingServices = services.filter(s => !s.status || s.status === 'pending');

  return (
    <div style={{ background: 'var(--surface)', border: '1px solid var(--line)', borderRadius: 14, padding: 16 }}>
      <h3 style={{ marginBottom: 10, fontSize: 14 }}>Сервисы</h3>
      {activeServices.length === 0 && pendingServices.length === 0 ? (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
          <ServiceRowEmpty icon="esim" name="eSIM" desc="Связь за рубежом" />
          <ServiceRowEmpty icon="car" name="Прокат авто" desc="Аренда в пункте назначения" />
          {moreOpen
            ? <ServiceRowEmpty icon="shield" name="Страховка" desc="Не подключена" />
            : <button onClick={() => setMoreOpen(true)} style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '8px 4px', border: 'none', background: 'transparent', color: 'var(--muted)', fontSize: 12, cursor: 'pointer' }}>
                <Icon name="more" size={12} />
                <span>Ещё: страховка и др.</span>
              </button>
          }
        </div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
          {activeServices.map((s, i) => (
            <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 9, padding: '6px 0' }}>
              <div style={{ width: 28, height: 28, borderRadius: 7, background: 'var(--success-soft)', color: 'var(--success)', display: 'grid', placeItems: 'center', flexShrink: 0 }}>
                <Icon name="check" size={14} />
              </div>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontSize: 12.5, fontWeight: 500 }}>{s.name || s.service_type}</div>
                {s.notes && <div className="muted" style={{ fontSize: 11 }}>{s.notes}</div>}
              </div>
            </div>
          ))}
          {pendingServices.map((s, i) => (
            <ServiceRowEmpty key={i} icon="spark" name={s.name || s.service_type} desc="Не подключено" />
          ))}
        </div>
      )}
    </div>
  );
}

function ServiceRowEmpty({ icon, name, desc }) {
  return (
    <button style={{
      display: 'flex', alignItems: 'center', gap: 9, padding: '8px 8px',
      background: 'transparent', border: '1.5px dashed var(--line)', borderRadius: 8,
      cursor: 'pointer', textAlign: 'left', color: 'var(--ink)', width: '100%',
    }}
    onMouseEnter={e => { e.currentTarget.style.borderColor = 'var(--brand)'; e.currentTarget.style.background = 'var(--brand-soft)'; }}
    onMouseLeave={e => { e.currentTarget.style.borderColor = 'var(--line)'; e.currentTarget.style.background = 'transparent'; }}>
      <div style={{ width: 28, height: 28, borderRadius: 7, background: 'var(--wash)', color: 'var(--muted)', display: 'grid', placeItems: 'center', flexShrink: 0 }}>
        <Icon name={icon} size={14} />
      </div>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ fontSize: 12.5, fontWeight: 500 }}>
          <Icon name="plus" size={11} style={{ verticalAlign: -1, marginRight: 3, color: 'var(--brand)' }} />
          Добавить {name}
        </div>
        <div className="muted" style={{ fontSize: 11 }}>{desc}</div>
      </div>
    </button>
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

  const { isDark, toggle: toggleTheme } = useTheme();
  const [isEditMode, setIsEditMode] = useState(false);
  const [transferEdit, setTransferEdit] = useState({ open: false, fromVisit: null, toVisit: null, transfer: null });
  const [hotelEdit, setHotelEdit] = useState({ open: false, visit: null, hotel: null });
  const [visitEdit, setVisitEdit] = useState({ open: false, visit: null });
  const [newCityOpen, setNewCityOpen] = useState(false);
  const [newCityDefaultDay, setNewCityDefaultDay] = useState(null);
  const [activityEdit, setActivityEdit] = useState({ open: false, visit: null, activity: null, defaultStart: null });
  const [eventView, setEventView] = useState({ open: false, kind: null, id: null });
  const [deleteCity, setDeleteCity] = useState({ open: false, visit: null });
  const [deletingCity, setDeletingCity] = useState(false);
  const [payResult, setPayResult] = useState(null); // 'success' | 'fail' | null
  const [upgradeOpen, setUpgradeOpen] = useState(false);

  // Handle Stripe checkout return when the upgrade started from this trip page.
  useEffect(() => {
    const status = searchParams.get('stripe_status');
    if (!status) return;
    if (status === 'success') {
      setPayResult('success');
      qc.invalidateQueries({ queryKey: ['my-pro-status'] });
      qc.invalidateQueries({ queryKey: ['me'] });
    } else if (status === 'cancel') {
      setPayResult('fail');
    }
    const sp = new URLSearchParams(searchParams);
    sp.delete('stripe_status');
    sp.delete('session_id');
    setSearchParams(sp, { replace: true });
  }, [searchParams, setSearchParams, qc]);

  // Cascade-delete a city visit and everything inside it (hotels, activities, transfers).
  const confirmDeleteCity = async () => {
    const v = deleteCity.visit;
    if (!v?.id) return;
    setDeletingCity(true);
    try {
      await supabase.from('hotel_stays').delete().eq('city_visit_id', v.id);
      await supabase.from('activities').delete().eq('city_visit_id', v.id);
      await supabase.from('transfers').delete().or(`from_city_visit_id.eq.${v.id},to_city_visit_id.eq.${v.id}`);
      const { error } = await supabase.from('city_visits').delete().eq('id', v.id);
      if (error) throw error;
      setDeleteCity({ open: false, visit: null });
      qc.invalidateQueries({ queryKey: TRIP_SHELL_KEY(tripId) });
      qc.invalidateQueries({ queryKey: TRIP_CONTENT_KEY(tripId) });
    } catch (e) {
      alert('Не удалось удалить город: ' + (e?.message || e));
    } finally {
      setDeletingCity(false);
    }
  };

  // Open the read/edit dialog for a timeline event (hotel / transfer / activity)
  const openEventView = (e) => {
    let kind = null;
    if (e.type === 'hotel-checkin' || e.type === 'hotel-checkout') kind = 'hotel';
    else if (e.type === 'activity') kind = 'activity';
    else if (e.type === 'transfer' || e.type === 'flight') kind = 'transfer';
    if (!kind) return;
    const id = kind === 'hotel' ? e.hotelId : e.id;
    if (!id) return;
    setEventView({ open: true, kind, id });
  };

  // Wire window.__navigate so Screen components can navigate
  useEffect(() => {
    window.__navigate = (target) => {
      if (target === 'collection') { nav('/trips'); return; }
      if (target === 'ai-planner') { nav('/plan-trip-ai'); return; }
      const lensIds = ['timeline', 'map', 'calendar', 'budget', 'docs', 'members', 'settings', 'chat'];
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
  const services         = contentData?.services     || [];
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

  const isPro = isProActive(user);

  // If the URL points at a lens the trip has disabled, fall back to the timeline.
  const shownLens = isLensVisible(trip, lens) ? lens : 'timeline';

  if (loadingShell) return <LoadingScreen />;
  if (shellError || (!loadingShell && !trip)) return <ErrorScreen onBack={() => nav('/trips')} />;

  return (
    <div className="app" style={{ minHeight: '100vh', background: 'var(--bg, var(--wash))' }}>
      <TripHeader
        trip={trip}
        visits={visits}
        isPro={isPro}
        isDark={isDark}
        onToggleTheme={toggleTheme}
        user={user}
        nav={nav}
      />
      <div className="app-body">
        <TripSidebar tripId={tripId} trip={trip} lens={lens} onNavigate={setLens} isPro={isPro} onUpgrade={() => setUpgradeOpen(true)} />
        <main style={{ minWidth: 0, padding: '28px 28px 60px' }}>
          {/* TransferDialog — opened from missing-transfer warnings or edit mode */}
          <TransferDialog
            open={transferEdit.open}
            onOpenChange={(open) => setTransferEdit(s => ({ ...s, open }))}
            tripId={tripId}
            fromVisit={transferEdit.fromVisit}
            toVisit={transferEdit.toVisit}
            transfer={transferEdit.transfer}
          />
          {/* HotelDialog — opened from missing-hotel warnings or edit mode */}
          {hotelEdit.visit && (
            <HotelDialog
              open={hotelEdit.open}
              onOpenChange={(open) => setHotelEdit(s => ({ ...s, open }))}
              visit={hotelEdit.visit}
              hotel={hotelEdit.hotel}
            />
          )}
          {/* CityVisitDialog — edit existing visit notes */}
          {visitEdit.open && visitEdit.visit && (
            <CityVisitDialog
              key={`edit-visit-${visitEdit.visit.id}`}
              open={visitEdit.open}
              onOpenChange={(o) => setVisitEdit(s => ({ ...s, open: o }))}
              tripId={tripId}
              visit={visitEdit.visit}
              trip={trip}
              allVisits={visits}
            />
          )}
          {/* CityVisitDialog — add new city */}
          <CityVisitDialog
            key="new-city-from-edit"
            open={newCityOpen}
            onOpenChange={(o) => { setNewCityOpen(o); if (!o) setNewCityDefaultDay(null); }}
            tripId={tripId}
            visit={null}
            trip={newCityDefaultDay ? { ...trip, start_date: newCityDefaultDay } : trip}
            allVisits={visits}
          />
          {/* ActivityDialog — add new activity in edit mode */}
          {activityEdit.visit && (
            <ActivityDialog
              key={`activity-${activityEdit.visit?.id}-${activityEdit.activity?.id || 'new'}`}
              open={activityEdit.open}
              onOpenChange={(o) => setActivityEdit(s => ({ ...s, open: o }))}
              visit={activityEdit.visit}
              activity={activityEdit.activity}
              defaultStart={activityEdit.defaultStart}
            />
          )}
          {/* SourceViewLoader — opens the read/edit dialog when a timeline event is clicked */}
          <SourceViewLoader
            kind={eventView.kind}
            id={eventView.id}
            open={eventView.open}
            onOpenChange={(o) => setEventView(s => ({ ...s, open: o }))}
            canEdit={myRole !== 'viewer'}
          />

          {shownLens === 'timeline' && (
            <>
              <TripCoverStrip
                trip={trip}
                visits={visits}
                members={members}
                myRole={myRole}
                isEditMode={isEditMode}
                onToggleEdit={() => setIsEditMode(m => !m)}
              />
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 260px', gap: 24, alignItems: 'start' }}>
                <TimelineLens
                  stream={stream}
                  visits={visits}
                  transfers={transfers}
                  trip={trip}
                  isLoading={loadingContent}
                  onAddTransfer={(fromVisit, toVisit) =>
                    setTransferEdit({ open: true, fromVisit, toVisit, transfer: null })
                  }
                  onAddHotel={(visit) =>
                    setHotelEdit({ open: true, visit, hotel: null })
                  }
                  isEditMode={isEditMode}
                  onOpenEvent={openEventView}
                  onEditVisitNotes={(v) => setVisitEdit({ open: true, visit: v })}
                  onDeleteCity={(v) => setDeleteCity({ open: true, visit: v })}
                  onAddCityForDay={(dayKey) => {
                    setNewCityDefaultDay(dayKey || null);
                    setNewCityOpen(true);
                  }}
                  onAddActivityForDay={(dayKey) => {
                    const dayVisit = visits.find(v =>
                      v.kind === 'transit' && v.start_datetime && v.end_datetime &&
                      naiveDayKey(v.start_datetime) <= dayKey && dayKey <= naiveDayKey(v.end_datetime)
                    ) || visits.find(v => v.kind === 'transit' && v.start_datetime);
                    if (dayVisit) {
                      const tz = dayVisit.timezone || 'UTC';
                      const defaultStart = dayKey
                        ? DateTime.fromISO(`${dayKey}T10:00`, { zone: tz }).toUTC().toISO()
                        : null;
                      setActivityEdit({ open: true, visit: dayVisit, activity: null, defaultStart });
                    }
                  }}
                />
                <ContextSide
                  budget={budget}
                  budgetExpenses={budgetExpenses}
                  members={members}
                  services={services}
                  user={user}
                  trip={trip}
                  isLoading={loadingContent}
                />
              </div>
            </>
          )}
          {shownLens === 'budget' && (
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
              isPro={isPro}
              queryClient={qc}
            />
          )}
          {shownLens === 'chat' && (
            <ChatLens
              tripId={tripId}
              members={members}
              myRole={myRole}
            />
          )}
          {shownLens === 'map' && (
            <MapView
              visits={visits}
              transfers={transfers}
              visitsById={Object.fromEntries(visits.map(v => [v.id, v]))}
            />
          )}
        </main>
      </div>

      {deleteCity.open && (
        <div className="dlg-backdrop" style={{ zIndex: 280 }}
          onClick={(e) => { if (e.target === e.currentTarget && !deletingCity) setDeleteCity({ open: false, visit: null }); }}>
          <div className="dlg dlg--sm">
            <div className="dlg__head">
              <div style={{ width: 36, height: 36, borderRadius: 9, background: 'var(--danger-soft)', color: 'var(--danger)', display: 'grid', placeItems: 'center', flexShrink: 0 }}>
                <Icon name="trash" size={17} />
              </div>
              <h2>Удалить город?</h2>
            </div>
            <div className="dlg__body">
              <div style={{ fontSize: 14, marginBottom: 8 }}>
                Удалить <b>{deleteCity.visit?.city_name || 'город'}</b>?
              </div>
              <div className="muted" style={{ fontSize: 13, lineHeight: 1.6 }}>
                Все события внутри этого города (отели, активности, переезды) также будут удалены. Действие необратимо.
              </div>
            </div>
            <div className="dlg__foot">
              <Btn variant="ghost" onClick={() => setDeleteCity({ open: false, visit: null })} disabled={deletingCity}>Отмена</Btn>
              <Btn variant="danger-solid" icon="trash" onClick={confirmDeleteCity} disabled={deletingCity}>
                {deletingCity ? 'Удаляем…' : 'Удалить город'}
              </Btn>
            </div>
          </div>
        </div>
      )}

      <UpgradePlanDialog open={upgradeOpen} onOpenChange={setUpgradeOpen} tripId={tripId} />
      <PaymentSuccessDialog open={payResult === 'success'} onOpenChange={() => setPayResult(null)} />
      <PaymentFailDialog
        open={payResult === 'fail'}
        onOpenChange={() => setPayResult(null)}
        onRetry={() => { setPayResult(null); setUpgradeOpen(true); }}
      />

      <ModalHost />
      <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>
    </div>
  );
}
