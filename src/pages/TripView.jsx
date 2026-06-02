import React, { useMemo, useState, useEffect } from 'react';
import { useParams, useNavigate, useSearchParams } from 'react-router-dom';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { getWeather, weatherInfo } from '@/lib/weather';

import { supabase } from '@/api/supabaseClient';
import { useAuth } from '@/lib/AuthContext';
import { TRIP_SHELL_KEY, TRIP_CONTENT_KEY } from '@/lib/trip-data';
import { naiveDayKey, parseNaive, formatNaive } from '@/lib/naive-time';
import { formatTripRange, isTripInPast } from '@/lib/trip-dates';
import { isProActive } from '@/lib/subscription';
import TripProInfoDialog from '@/components/common/TripProInfoDialog';
import { isAddonEnabled } from '@/lib/tripAddons';
import { useUnreadChatCount } from '@/lib/chat';
import { useUserProfiles } from '@/lib/useUserProfiles';
import { displayName } from '@/lib/displayName';
import { useTheme } from '@/lib/ThemeContext';
import { useFxRates } from '@/lib/fx';
import { toMain as toMainCur, fmtMoney } from '@/lib/budget/money';
import { Icon } from '../design/icons';
import HeaderActions from '@/components/HeaderActions';
import { Avatar, Btn, EmptyState, Skeleton, ModalHost, fmtDate, weekday, StreamEventRow, fmt, CityPhoto } from '../design/index';
import { SystemStub } from '@/lib/PageNotFound';
import { sortVisits, cityIdentity } from '@/lib/validation';
import { useToast } from '@/components/ui/use-toast';
import { DateTime } from 'luxon';
import EventEditDialog from '@/components/common/EventEditDialog';
import SourceViewLoader from '../components/budget/SourceViewLoader';
import ForkPartnerModal from '@/components/bookings/ForkPartnerModal';
import ServiceDialog from '@/components/services/ServiceDialog';
import BudgetLens from './BudgetLens';
import MembersLens from './MembersLens';
import CalendarLens from './CalendarLens';
import DocsLens from './DocsLens';
import SettingsLens from './SettingsLens';
import ChatLens from './ChatLens';
import { uniqueCityCount } from '@/lib/trip-cities';
import ChatWidget from '@/components/chat/ChatWidget';
import ScreenMap from '@/pages/redesign/ScreenMap';
import TripFormDialog from '@/components/trips/TripFormDialog';
import { getGradientById } from '@/lib/trip-gradients';
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
    // Free-cancellation deadline - point event styled by StreamEventRow's
    // `hotel-deadline` branch (rose accent + warning icon).
    if (h.free_cancellation && h.free_cancellation_until) {
      events.push({
        type: 'hotel-deadline',
        id: 'h-cancel-' + h.id,
        date: naiveDayKey(h.free_cancellation_until),
        time: formatNaive(h.free_cancellation_until, 'HH:mm'),
        city,
        title: 'Дедлайн бесплатной отмены · ' + h.name,
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
      duration: a.end_datetime ? formatDuration(a.start_datetime, a.end_datetime) : null,
      _ms: parseNaive(a.start_datetime)?.toMillis() ?? 0,
    });
  }

  for (const t of transfers) {
    const kind = t.transport_type || t.kind || 'car';
    const isPlane = kind === 'plane';
    // If the transfer has no explicit start_datetime (e.g. created via the
    // ManualPlanner transport step), anchor it to the arrival day of the
    // to-visit so it still appears in the timeline above the city header.
    const explicitDate = naiveDayKey(t.start_datetime);
    const toVisit = visits.find(v => v.id === t.to_city_visit_id);
    const fromVisit = visits.find(v => v.id === t.from_city_visit_id);
    // For dateless transfers anchor to the to-visit's arrival day, or - for
    // legs into a dateless end anchor - to the from-visit's end day.
    const fallbackDate = (toVisit && naiveDayKey(toVisit.start_datetime))
      || (fromVisit && naiveDayKey(fromVisit.end_datetime))
      || null;
    const eventDate = explicitDate || fallbackDate;
    const eventMs = parseNaive(t.start_datetime)?.toMillis()
      ?? parseNaive(toVisit?.start_datetime)?.toMillis()
      ?? parseNaive(fromVisit?.end_datetime)?.toMillis()
      ?? 0;
    events.push({
      type: isPlane ? 'flight' : 'transfer',
      id: t.id,
      date: eventDate,
      time: formatNaive(t.start_datetime, 'HH:mm'),
      title: t.carrier || (isPlane ? 'Перелёт' : 'Переезд'),
      from: cityForVisit(t.from_city_visit_id, visits) || t.from_address,
      to: cityForVisit(t.to_city_visit_id, visits) || t.to_address,
      from_address: t.from_address || null,
      to_address: t.to_address || null,
      kind,
      carrier: t.carrier,
      num: t.booking_reference,
      price: t.price,
      cur: t.currency,
      platformUrl: t.booking_url,
      duration: t.end_datetime ? formatDuration(t.start_datetime, t.end_datetime) : null,
      _ms: eventMs,
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
            <div className="app-side__group-label">Разделы путешествия</div>
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
          {/* Timeline + sidebar skeleton - same building blocks as the loaded
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
  const nav = useNavigate();
  const { logout } = useAuth();
  const loginOther = async () => {
    try { await logout?.(false); } catch { /* ignore */ }
    nav('/login');
  };
  return (
    <div style={{ minHeight: '100vh', background: 'var(--wash)' }}>
      <SystemStub
        icon="lock"
        tone="warm"
        title="Нет доступа к этому путешествию"
        body="Возможно, тебя нет в списке участников, приглашение отозвали или путешествие был удалёно."
        primary={{ label: 'К моим путешествиям', onClick: onBack }}
        secondary={{ label: 'Войти другим аккаунтом', onClick: loginOther }}
      />
    </div>
  );
}

// ─── TripHeader ───────────────────────────────────────────────────────────────

function TripHeader({ trip, visits, isPro, isDark, onToggleTheme, user, nav }) {
  const dateRange = formatTripRange(visits, '-');

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
          {dateRange && dateRange !== '-' && (
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

// Addon-gated lenses: hidden unless the trip explicitly enabled them.
// Default OFF - a fresh trip shows none of these until enabled in Settings.
const GATED_LENS_ADDON = { calendar: 'calendar', budget: 'budget', chat: 'chat' };

function isLensVisible(trip, lensId) {
  const key = GATED_LENS_ADDON[lensId];
  if (!key) return true;
  return trip?.details?.addons?.[key] === true;
}

function TripSidebar({ tripId, trip, lens, onNavigate, isPro, proResolved = true, isOwner, myRole, onUpgrade, onProInfo }) {
  const lensItems = LENS_ITEMS.filter(item => isLensVisible(trip, item.id));
  // Viewers can't open Settings or Members - hide those menu items entirely.
  const mgmtItems = MGMT_ITEMS.filter(item =>
    !(myRole === 'viewer' && (item.id === 'settings' || item.id === 'members')));
  // Viewers can't mint a share token (ensureShareToken is owner/admin-only).
  const canShare = myRole !== 'viewer';
  // Only after Pro state is resolved - avoids the banner flashing on pro trips.
  const showUpgrade = proResolved && !isPro; // isPro = trip-level Pro (owner sub OR pro_trip)
  const chatUnread = useUnreadChatCount(tripId);
  return (
    <aside className="app-side">
      <div className="app-side__group">
        <div className="app-side__group-label">Разделы путешествия</div>
        {lensItems.map(item => (
          <button
            key={item.id}
            className={'app-side__item' + (lens === item.id ? ' active' : '')}
            onClick={() => onNavigate(item.id)}
          >
            <Icon name={item.icon} size={15} />
            {item.label}
            {item.id === 'chat' && chatUnread > 0 && (
              <span className="app-side__item-badge" style={{ marginLeft: 'auto', background: 'var(--warm)', color: '#fff', borderRadius: 999, fontSize: 10.5, fontWeight: 700, minWidth: 18, height: 18, display: 'inline-flex', alignItems: 'center', justifyContent: 'center', padding: '0 5px' }}>
                {chatUnread > 99 ? '99+' : chatUnread}
              </span>
            )}
          </button>
        ))}
      </div>
      {(mgmtItems.length > 0 || canShare) && (
        <div className="app-side__group">
          <div className="app-side__group-label">Управление</div>
          {mgmtItems.map(item => (
            <button
              key={item.id}
              className={'app-side__item' + (lens === item.id ? ' active' : '')}
              onClick={() => onNavigate(item.id)}
            >
              <Icon name={item.icon} size={15} />
              {item.label}
            </button>
          ))}
          {/* Share opens the same dialog as the header button. Hidden from
              viewers - ensureShareToken is owner/admin-only (a viewer just
              gets a 403), matching the header share gate (myRole !== 'viewer'). */}
          {canShare && (
            <button
              className="app-side__item"
              onClick={() => window.__openModal?.(<ShareDialog trip={trip} />)}
            >
              <Icon name="share" size={15} />
              Поделиться
            </button>
          )}
        </div>
      )}
      {showUpgrade && (
        <div style={{ margin: '10px 6px 0', padding: 12, borderRadius: 10, background: 'var(--warm-tint)' }}>
          <div style={{ fontSize: 12.5, fontWeight: 600, color: 'var(--warm)', marginBottom: 4 }}>Free-путешествие</div>
          <div style={{ fontSize: 11.5, color: 'var(--ink-2)', marginBottom: 8, lineHeight: 1.45 }}>
            Календарь, бюджет-разбивка, ИИ и чат закрыты Pro.
          </div>
          {isOwner ? (
            <Btn variant="primary" size="sm" block icon="pro" onClick={onUpgrade}>Апгрейд путешествия</Btn>
          ) : (
            <Btn variant="ghost" size="sm" block icon="lock" onClick={onProInfo}>Подключает владелец</Btn>
          )}
        </div>
      )}
    </aside>
  );
}

// ─── AddDayButton - shown in edit mode after each day ────────────────────────
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
          {/* "Add city" lives in the Structure editor now - timeline only adds activities. */}
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

// Right-rail (budget / who's going / services) placeholder - shared by the
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

// Fetch daily weather for all transit visits → { [dayKey]: { icon, temp } }.
// Open-Meteo returns up to ~16 days ahead; past days yield nothing.
function useWeatherByDay(visits) {
  const [weatherByDay, setWeatherByDay] = useState({});
  useEffect(() => {
    const transit = (visits || []).filter(v => v.kind !== 'start' && v.kind !== 'end' && v.latitude && v.longitude && v.start_datetime && v.end_datetime);
    if (transit.length === 0) { setWeatherByDay({}); return; }
    let cancelled = false;
    (async () => {
      const map = {};
      for (const v of transit) {
        const res = await getWeather(v.latitude, v.longitude, naiveDayKey(v.start_datetime), naiveDayKey(v.end_datetime)).catch(() => null);
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

function CityHero({ city, country, dateRange, nights, hotels = [], visit, onAddHotel, isEditMode, onEditNotes, onDeleteCity, onOpenEvent, showBookingWarnings = true }) {
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
            {/* City add/edit/delete moved entirely to the Structure editor
                (/trip/:id/edit). No city-level mutations on the timeline. */}
          </div>
        </div>
      </div>
      <div style={{ padding: '12px 16px', borderTop: '1px solid var(--line-2)', display: 'flex', flexDirection: 'column', gap: 8 }}>
        {hotels.length > 0 ? hotels.map((h, i) => (
          <button
            key={i}
            type="button"
            onClick={() => onOpenEvent?.({ type: 'hotel-checkin', hotelId: h.hotelId })}
            disabled={!onOpenEvent || !h.hotelId}
            style={{
              display: 'flex', alignItems: 'center', gap: 12,
              padding: 10, background: 'var(--wash)', borderRadius: 10, border: '1px solid var(--line-2)',
              cursor: onOpenEvent && h.hotelId ? 'pointer' : 'default',
              width: '100%', textAlign: 'left',
            }}
          >
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
          </button>
        )) : (
          showBookingWarnings ? <MissingHotelWarning city={city} onAdd={() => onAddHotel?.(visit)} /> : null
        )}
      </div>
    </div>
  );
}

function TimelineLens({ stream, visits, transfers, trip, isLoading, onAddTransfer, onAddHotel, isEditMode, onAddCityForDay, onAddActivityForDay, onEditVisitNotes, onOpenEvent, onDeleteCity, isViewer = false }) {
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
        title="Хронология пуста"
        body="Добавь отели, переезды и активности - они появятся здесь в хронологическом порядке."
      />
    );
  }

  // Determine timeline bounds. Start/end anchors are pure markers and have
  // no datetimes - derive the trip range from the first/last TRANSIT visit
  // (the cities the user actually stays in). Falls back to trip.start_date /
  // trip.end_date when there are no transits with dates.
  const datedTransits = sortVisits(visits)
    .filter(v => v.kind !== 'start' && v.kind !== 'end' && v.start_datetime && v.end_datetime);
  const transitStart = datedTransits.length ? naiveDayKey(datedTransits[0].start_datetime) : null;
  const transitEnd = datedTransits.length ? naiveDayKey(datedTransits[datedTransits.length - 1].end_datetime) : null;
  const tripStart = transitStart || trip.start_date || null;
  const tripEnd = transitEnd || trip.end_date || null;

  if (!tripStart || !tripEnd) {
    return (
      <EmptyState
        icon="list"
        title="Даты путешествия не заданы"
        body="Укажи даты путешествия, чтобы увидеть хронологию."
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

  // One ordered walk of TRANSIT cities drives BOTH the render order and the
  // transfer/warning pairing - so a warning's "from" is always the city shown
  // directly above it (no sortVisits ↔ visitForDay divergence). Anchors are
  // rendered separately as StreamAnchor.
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
    const vStart = naiveDayKey(city.start_datetime);
    const vEnd = naiveDayKey(city.end_datetime);
    const nights = nightsBetween(vStart, vEnd);
    const dateRange = vStart && vEnd ? `${fmtDate(vStart)} - ${fmtDate(vEnd)}` : null;
    out.push(
      <CityHero
        key={`city-${city.id}`}
        city={city.city_name}
        country={city.country || city.country_name}
        dateRange={dateRange}
        nights={nights}
        hotels={hotelsByVisit[city.id] || []}
        visit={city}
        onAddHotel={onAddHotel}
        isEditMode={isEditMode}
        onEditNotes={onEditVisitNotes}
        onDeleteCity={onDeleteCity}
        onOpenEvent={onOpenEvent}
        showBookingWarnings={showBookingWarnings}
      />
    );
    return out;
  };

  const rows = [];
  // Running predecessor across the whole itinerary walk (seed = start anchor).
  let prevCity = ordered[0]?.kind === 'start' ? ordered[0] : null;

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
    // All transit cities ARRIVING this day (by start day), in itinerary order.
    // Multiple cities can arrive the same day (e.g. a one-day pass-through that
    // shares its single day with the previous and next city).
    const arrivingToday = transitCities.filter(c => naiveDayKey(c.start_datetime) === day);
    const isArrival = arrivingToday.length > 0;

    // Header chip = the latest transit city whose range covers this day.
    const dayCity = [...transitCities].reverse().find(c => {
      const s = naiveDayKey(c.start_datetime), e = naiveDayKey(c.end_datetime);
      return s && e && day >= s && day <= e;
    }) || null;

    const allDayEvents = eventsByDate[day] || [];
    const dayEvents = allDayEvents.filter(e => !inboundEventIds.has(e.id));

    rows.push(
      <div key={`day-${day}`} style={{ marginBottom: 24 }}>
        {/* Date separator - matches design: large bold date */}
        <div style={{ display: 'flex', alignItems: 'flex-end', gap: 12, padding: '12px 0 10px' }}>
          <div style={{ display: 'flex', alignItems: 'baseline', gap: 8 }}>
            <span className="num" style={{ fontFamily: 'var(--font-display)', fontWeight: 700, fontSize: 22, letterSpacing: '-0.02em', color: 'var(--ink)' }}>
              {fmtDate(day)}
            </span>
            <span className="muted" style={{ fontSize: 12, textTransform: 'uppercase', letterSpacing: '.08em', fontWeight: 600 }}>
              {weekday(day)}
            </span>
          </div>
          {dayCity && (
            <span style={{ display: 'inline-flex', alignItems: 'center', gap: 5, padding: '2px 8px 2px 6px', borderRadius: 999, background: 'var(--brand-soft)', color: 'var(--brand)', fontSize: 11.5, fontWeight: 500, marginBottom: 2 }}>
              <Icon name="pin" size={11} />
              {dayCity.city_name}
            </span>
          )}
          {weatherByDay[day] && (
            <span className="num" style={{ display: 'inline-flex', alignItems: 'center', gap: 4, padding: '2px 8px', borderRadius: 999, background: 'var(--wash)', color: 'var(--ink)', fontSize: 11.5, fontWeight: 500, marginBottom: 2 }}>
              <span>{weatherByDay[day].icon}</span><span>{weatherByDay[day].temp}°</span>
            </span>
          )}
          <div style={{ flex: 1, borderBottom: '1px solid var(--line-2)', marginBottom: 6 }} />
        </div>

        {/* Each city arriving this day: [transfer card | missing-transfer
            warning] then its CityHero. prevCity carries through the whole
            itinerary so a warning's "from" is always the city directly above. */}
        {arrivingToday.flatMap(c => { const block = renderArrival(c, prevCity); prevCity = c; return block; })}

        {/* Events or placeholder - never show the empty-day placeholder on an
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
        <h2 style={{ margin: '0 0 6px', fontSize: 20 }}>Поделиться путешествием</h2>
        <div className="muted" style={{ fontSize: 13.5, marginBottom: 18 }}>Скопируй ссылку и отправь участникам - она откроется без входа в аккаунт</div>
        <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
          <input className="input" readOnly value={loading ? '' : shareUrl} placeholder={loading ? 'Генерируем ссылку…' : ''} style={{ flex: 1, fontSize: 12.5 }} onClick={e => e.target.select()} />
          {loading ? (
            <Btn variant="primary" disabled>
              <span className="spin-mini" style={{
                display: 'inline-block', width: 14, height: 14,
                border: '2px solid currentColor', borderRightColor: 'transparent',
                borderRadius: '50%', animation: 'spin .7s linear infinite',
                marginRight: 6, verticalAlign: -2,
              }} />
              Генерируем…
            </Btn>
          ) : (
            <Btn variant="primary" icon="check" onClick={copyLink} disabled={!shareUrl}>
              {copied ? 'Скопировано!' : 'Копировать'}
            </Btn>
          )}
        </div>
        {error && <div style={{ color: 'var(--danger, #dc2626)', fontSize: 12.5, marginTop: 10 }}>{error}</div>}
        <div style={{ marginTop: 18, textAlign: 'right' }}>
          <Btn variant="ghost" onClick={() => window.__closeModal?.()}>Закрыть</Btn>
        </div>
      </div>
    </div>
  );
}

function MoreMenuDialog({ trip, visits, canEditMode, onEditStructure, onEditMetadata }) {
  const openEditMetadata = () => {
    onEditMetadata?.();
  };
  const itemStyle = { display: 'flex', alignItems: 'center', gap: 12, padding: '12px 14px', borderRadius: 10, border: 'none', background: 'transparent', cursor: 'pointer', textAlign: 'left', fontSize: 14, color: 'var(--ink)' };
  return (
    <div style={{ position: 'fixed', inset: 0, zIndex: 999, display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'rgba(15,23,42,.45)', backdropFilter: 'blur(4px)' }}
      onClick={() => window.__closeModal?.()}>
      <div onClick={e => e.stopPropagation()} style={{ background: 'var(--surface)', border: '1px solid var(--line)', borderRadius: 18, padding: 20, width: 320, maxWidth: 'calc(100vw - 32px)', boxShadow: 'var(--shadow-pop)' }}>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
          {canEditMode && (
            <button onClick={() => onEditStructure?.()} style={{ ...itemStyle, color: 'var(--brand)', fontWeight: 600 }}
              onMouseEnter={e => e.currentTarget.style.background = 'var(--wash)'}
              onMouseLeave={e => e.currentTarget.style.background = 'transparent'}>
              <Icon name="map" size={16} style={{ color: 'var(--brand)' }} /> Редактировать структуру
            </button>
          )}
          <button onClick={openEditMetadata} style={itemStyle}
            onMouseEnter={e => e.currentTarget.style.background = 'var(--wash)'}
            onMouseLeave={e => e.currentTarget.style.background = 'transparent'}>
            <Icon name="edit" size={16} style={{ color: 'var(--muted)' }} /> Редактировать метаданные
          </button>
          <button onClick={() => { window.__closeModal?.(); window.__navigate?.('settings'); }} style={itemStyle}
            onMouseEnter={e => e.currentTarget.style.background = 'var(--wash)'}
            onMouseLeave={e => e.currentTarget.style.background = 'transparent'}>
            <Icon name="settings" size={16} style={{ color: 'var(--muted)' }} /> Настройки путешествия
          </button>
          <button onClick={() => { window.__closeModal?.(); window.__navigate?.('members'); }} style={itemStyle}
            onMouseEnter={e => e.currentTarget.style.background = 'var(--wash)'}
            onMouseLeave={e => e.currentTarget.style.background = 'transparent'}>
            <Icon name="users" size={16} style={{ color: 'var(--muted)' }} /> Участники
          </button>
          <div style={{ height: 1, background: 'var(--line-2)', margin: '6px 0' }} />
          <button onClick={() => window.__closeModal?.()} style={{ ...itemStyle, color: 'var(--muted)' }}>
            <Icon name="close" size={16} /> Закрыть
          </button>
        </div>
      </div>
    </div>
  );
}

// ─── TripCoverStrip ──────────────────────────────────────────────────────────

function TripCoverStrip({ trip, visits, members, myRole, canEditMode, frozen, isEditMode, onToggleEdit }) {
  const nav = useNavigate();
  const [routeOpen, setRouteOpen] = useState(false);
  const [editingMetadata, setEditingMetadata] = useState(false);
  const activeMemberCount = members.filter(m => m.status === 'active').length || 1;
  const cities = visits.map(v => v.city_name).filter(Boolean);
  const cityCount = uniqueCityCount(visits); // dedup repeated cities (e.g. Москва … Москва) for the count
  const dateRange = formatTripRange(visits, '-');

  // Cover priority: uploaded photo → preset gradient → default HSL gradient + SVG waves.
  const gradient = getGradientById(trip?.cover_gradient);
  const hasPhoto = !!trip?.cover_image_url;
  const hasGradient = !hasPhoto && !!gradient;
  const useDefault = !hasPhoto && !hasGradient;
  const coverBg = hasGradient
    ? gradient.css
    : useDefault
      ? 'linear-gradient(135deg, hsl(210, 60%, 55%) 0%, hsl(195, 55%, 50%) 40%, hsl(25, 65%, 60%) 100%)'
      : 'var(--wash)';

  return (
    <div style={{ marginBottom: 22, borderBottom: '1px solid var(--line-2)', paddingBottom: 22 }}>
      {/* Cover */}
      <div style={{
        position: 'relative', marginBottom: 18, height: 160, borderRadius: 16,
        overflow: 'hidden',
        background: coverBg,
      }}>
        {hasPhoto && (
          <img src={trip.cover_image_url} alt="" style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', objectFit: 'cover' }} />
        )}
        {useDefault && (
          <svg viewBox="0 0 800 200" preserveAspectRatio="none" style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', opacity: 0.55 }}>
            <path d="M0 130 Q 200 80 400 110 T 800 95 L 800 200 L 0 200 Z" fill="rgba(255,255,255,.55)" />
            <path d="M0 160 Q 250 110 450 140 T 800 130 L 800 200 L 0 200 Z" fill="rgba(255,255,255,.32)" />
            <circle cx="680" cy="50" r="28" fill="rgba(255,255,255,.65)" />
          </svg>
        )}
        <div style={{ position: 'absolute', inset: 0, background: 'linear-gradient(180deg, transparent 30%, rgba(0,0,0,.38) 100%)' }} />
        <div style={{ position: 'absolute', left: 22, right: 22, bottom: 18 }}>
          <div style={{
            color: 'white', fontFamily: 'var(--font-display)', fontWeight: 700,
            fontSize: 'clamp(24px, 4vw, 36px)', letterSpacing: '-0.03em', lineHeight: 1,
            textShadow: '0 2px 12px rgba(0,0,0,.3)',
          }}>{trip?.title || '…'}</div>
          {dateRange && dateRange !== '-' && (
            <div className="num" style={{ color: 'rgba(255,255,255,.85)', fontSize: 13, marginTop: 8, fontWeight: 500 }}>
              {dateRange}
            </div>
          )}
        </div>
      </div>

      <TripFormDialog
        open={editingMetadata}
        onOpenChange={setEditingMetadata}
        trip={trip}
        visits={visits}
      />

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
                {cityCount} {cityCount === 1 ? 'город' : cityCount < 5 ? 'города' : 'городов'}
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
            frozen
              ? <Btn variant="ghost" size="sm" icon="lock" disabled>Редактируется</Btn>
              : isEditMode
                ? <Btn variant="primary" size="sm" icon="check" onClick={onToggleEdit}>Готово</Btn>
                : <Btn variant="ghost" size="sm" icon="edit" onClick={onToggleEdit}>Редактировать</Btn>
          )}
          {/* Only owner/admin can mint a share token (ensureShareToken is admin-only);
              showing this to a viewer just produced a 403 "не удалось создать ссылку". */}
          {myRole !== 'viewer' && (
            <Btn variant="ghost" size="sm" icon="share" onClick={() => window.__openModal?.(<ShareDialog trip={trip} />)}>Поделиться</Btn>
          )}
          <Btn variant="ghost" size="sm" icon="download" onClick={() => window.print()}>Экспорт</Btn>
          {/* The "…" menu only holds owner/admin actions (edit, settings, delete) -               every item is unavailable to a viewer, so hide the whole button. */}
          {myRole !== 'viewer' && (
            <Btn variant="ghost" size="sm" icon="more" onClick={() => window.__openModal?.(<MoreMenuDialog trip={trip} visits={visits} canEditMode={canEditMode} onEditStructure={() => { window.__closeModal?.(); nav(`/trip/${trip.id}/edit`); }} onEditMetadata={() => { window.__closeModal?.(); setEditingMetadata(true); }} />)} />
          )}
        </div>
      </div>
    </div>
  );
}

// ─── ContextSide ──────────────────────────────────────────────────────────────

function ContextSide({ budget, budgetExpenses, budgetCategories = [], members, services = [], user, trip, isLoading, onAddService, canManage = false, budgetEnabled = false, onBudgetLocked }) {
  const mainCurrencyCtx = trip?.details?.main_currency || budget?.currency || 'EUR';
  const { data: fxCtx } = useFxRates(mainCurrencyCtx);
  const overridesCtx = budget?.fx_overrides || {};
  const moneyCtx = (v) => fmtMoney(v, mainCurrencyCtx, 'ru-RU');
  const convCtx = (e) => toMainCur(e.original_amount, e.original_currency || mainCurrencyCtx, mainCurrencyCtx, fxCtx, overridesCtx);
  // Resolve display names from profiles so the widget shows real names, not
  // emails. Include the trip owner (often missing from trip_members) and the
  // current user so the synthetic owner row and the current user resolve.
  const profileIds = [
    ...((members || []).map(m => m.user_id)),
    trip?.created_by,
    user?.id,
  ].filter(Boolean);
  const profiles = useUserProfiles(profileIds, trip?.id);
  if (isLoading) {
    return <div style={{ position: 'sticky', top: 80 }}><RightRailSkeleton /></div>;
  }
  const mainCurrency = mainCurrencyCtx;

  // Per-category breakdown (converted to main currency). Drives the segmented
  // bar + legend. Only convertible expenses are summed.
  const catBreakdown = (budgetCategories || [])
    .map(cat => {
      const items = (budgetExpenses || []).filter(e => e.category_id === cat.id);
      const spent = items.reduce((s, e) => { const r = convCtx(e); return s + (r.ok ? r.value : 0); }, 0);
      return { id: cat.id, name: cat.name, color: cat.color || 'var(--muted)', spent };
    })
    .filter(c => c.spent > 0)
    .sort((a, b) => b.spent - a.spent);
  const totalSpent = catBreakdown.reduce((s, c) => s + c.spent, 0);

  // Any expense whose currency can't be converted → warning indicator.
  const hasMissingRate = (budgetExpenses || []).some(
    e => e.original_currency && e.original_currency !== mainCurrency && !convCtx(e).ok
  );

  // Always show the owner first, then admins, viewers, offline, pending.
  // The owner often isn't a trip_members row (tracked via trip.created_by), so
  // synthesize it when missing. Use the authenticated user's own name when the
  // owner row is the current user - otherwise leave user_full_name empty and
  // let the profile resolver fill it in.
  const orderedMembers = (() => {
    const ownerId = trip?.created_by || user?.id || '';
    const all = members.filter(m => m.status !== 'declined');
    if (ownerId && !all.some(m => m.role === 'owner' || m.user_id === ownerId)) {
      const isMeOwner = user?.id && ownerId === user.id;
      all.unshift({
        id: '__owner__',
        user_id: ownerId,
        user_full_name: isMeOwner ? (user?.full_name || '') : '',
        role: 'owner',
        status: 'active',
      });
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
          {canManage && (
            <button
              onClick={() => (budgetEnabled ? window.__navigate?.('budget') : onBudgetLocked?.())}
              style={{ width: 26, height: 26, borderRadius: 7, border: '1px solid var(--line)', background: 'transparent', cursor: 'pointer', display: 'grid', placeItems: 'center', color: 'var(--muted-2)' }}
              title={budgetEnabled ? 'Открыть бюджет' : 'Включить аддон бюджета'}>
              <Icon name="chev" size={13} />
            </button>
          )}
        </div>
        {budget ? (
          <>
            <div className="num" style={{ fontFamily: 'var(--font-display)', fontSize: 22, fontWeight: 600 }}>
              {moneyCtx(totalSpent)}
            </div>
            {hasMissingRate && (
              <div style={{ display: 'flex', alignItems: 'center', gap: 5, marginTop: 6, fontSize: 11.5, color: 'var(--warning)' }}>
                <Icon name="warning" size={12} />
                <span>Часть трат не пересчитана - нет курса</span>
              </div>
            )}
            {/* Segmented bar - one segment per category */}
            <div style={{ height: 8, borderRadius: 4, background: 'var(--wash)', overflow: 'hidden', marginTop: 10, marginBottom: 10, display: 'flex' }}>
              {catBreakdown.map(c => (
                <div key={c.id} title={c.name} style={{
                  height: '100%',
                  width: (totalSpent > 0 ? (c.spent / totalSpent) * 100 : 0) + '%',
                  // keep a tiny segment visible even for very small expenses
                  minWidth: c.spent > 0 ? 4 : 0,
                  background: c.color,
                }} />
              ))}
            </div>
            {/* Legend */}
            {catBreakdown.length > 0 ? (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 5 }}>
                {catBreakdown.map(c => (
                  <div key={c.id} style={{ display: 'flex', alignItems: 'center', gap: 7, fontSize: 12 }}>
                    <span style={{ width: 8, height: 8, borderRadius: '50%', background: c.color, flexShrink: 0 }} />
                    <span style={{ flex: 1, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{c.name}</span>
                    <span className="num" style={{ fontWeight: 600 }}>{moneyCtx(c.spent)}</span>
                  </div>
                ))}
              </div>
            ) : (
              <div className="muted" style={{ fontSize: 12 }}>Пока нет ни одной траты</div>
            )}
          </>
        ) : (
          <div className="muted" style={{ fontSize: 12.5 }}>Бюджет не создано</div>
        )}
      </div>

      {/* Who's going widget */}
      <div style={{ background: 'var(--surface)', border: '1px solid var(--line)', borderRadius: 14, padding: 16 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 10 }}>
          <h3 style={{ flex: 1, marginBottom: 0, fontSize: 14 }}>Кто едет</h3>
          {canManage && (
            <button
              onClick={() => window.__navigate?.('members')}
              style={{ width: 26, height: 26, borderRadius: 7, border: '1px solid var(--line)', background: 'transparent', cursor: 'pointer', display: 'grid', placeItems: 'center', color: 'var(--muted-2)' }}
              title="Открыть участников">
              <Icon name="chev" size={13} />
            </button>
          )}
        </div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          {orderedMembers.map((m, i) => {
            const profile = profiles[m.user_id];
            const resolved = profile?.full_name || m.user_full_name
              || (m.user_id && user?.id && m.user_id === user.id ? user.full_name : '')
              || '';
            const name = displayName(m.invite_email, resolved);
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
                <Avatar name={name} photo={profile?.avatar_url || ''} size="lg" />
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
      <ServicesWidget services={services} onAddService={onAddService} />
    </div>
  );
}

// ─── ServicesWidget ───────────────────────────────────────────────────────────

function ServicesWidget({ services = [], onAddService }) {
  const [moreOpen, setMoreOpen] = useState(false);
  const activeServices = services.filter(s => s.status === 'active' || s.status === 'booked');
  const pendingServices = services.filter(s => !s.status || s.status === 'pending');

  return (
    <div style={{ background: 'var(--surface)', border: '1px solid var(--line)', borderRadius: 14, padding: 16 }}>
      <h3 style={{ marginBottom: 10, fontSize: 14 }}>Сервисы</h3>
      {activeServices.length === 0 && pendingServices.length === 0 ? (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
          <ServiceRowEmpty icon="esim" name="eSIM" desc="Связь за рубежом" onClick={() => onAddService?.('esim')} />
          <ServiceRowEmpty icon="car" name="Прокат авто" desc="Аренда в пункте назначения" onClick={() => onAddService?.('car_rental')} />
          {moreOpen
            ? <ServiceRowEmpty icon="shield" name="Страховка" desc="Не подключена" onClick={() => onAddService?.('insurance')} />
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

function ServiceRowEmpty({ icon, name, desc, onClick }) {
  return (
    <button onClick={onClick} style={{
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
  const { toast } = useToast();
  const lens = searchParams.get('lens') || 'timeline';

  const { isDark, toggle: toggleTheme } = useTheme();
  const [isEditMode, setIsEditMode] = useState(false);
  const [transferEdit, setTransferEdit] = useState({ open: false, fromVisit: null, toVisit: null, transfer: null });
  const [hotelEdit, setHotelEdit] = useState({ open: false, visit: null, hotel: null });
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
    let kind = null;
    if (e.type === 'hotel-checkin' || e.type === 'hotel-checkout' || e.type === 'hotel-deadline') kind = 'hotel';
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
    () => buildEventStream(hotels, activities, transfers, visits),
    [hotels, activities, transfers, visits],
  );

  // Account-level Pro (header chip). For IN-TRIP gating use tripIsPro below.
  const accountPro = isProActive(user);
  const isOwner = myRole === 'owner';

  // Trip-level Pro = is_pro_trip OR the OWNER has an active subscription.
  // is_pro_trip is known instantly; the owner-subscription part is resolved by
  // the server (checkSubscriptionStatus, owner-aware). A participant's own
  // subscription does NOT unlock someone else's trip.
  const [ownerProResolved, setOwnerProResolved] = useState(false);
  // proResolved: have we resolved the owner-subscription state yet? Until then
  // we DON'T show the "upgrade trip" banner - otherwise it flashes on pro trips
  // (is_pro_trip=false but owner has a sub) during the async resolve.
  const [proResolved, setProResolved] = useState(false);
  useEffect(() => {
    if (!tripId) return;
    let cancelled = false;
    setProResolved(false);
    supabase.functions.invoke('checkSubscriptionStatus', { body: { tripId } })
      .then((res) => { if (!cancelled) { setOwnerProResolved(!!res.data?.isPro); setProResolved(true); } })
      .catch(() => { if (!cancelled) { setOwnerProResolved(false); setProResolved(true); } });
    return () => { cancelled = true; };
  }, [tripId, trip?.is_pro_trip]);
  const tripIsPro = !!trip?.is_pro_trip || ownerProResolved;
  // Edit Mode (structure editor) gate - exact current model (TRIP_EDIT_MODE_TZ §2):
  // anyone but a viewer; past trips require the trip to be Pro (or owner Pro).
  const canEditMode = myRole !== 'viewer' && (!isTripInPast(visits) || tripIsPro);
  // Structure Edit Mode lock held (by anyone, incl. self in another tab) → freeze
  // timeline mutations (TRIP_EDIT_MODE_TZ §3a). Reflected on load/refetch of the shell.
  const frozen = !!trip?.editing_by;
  // While the trip is being edited in the Structure editor, freeze ALL event
  // mutations on the timeline (add/edit/delete) - viewing stays allowed (TZ §3a).
  const frozenNote = () => toast({ description: 'Путешествие сейчас редактируется в режиме структуры - изменения временно недоступны.' });
  // Banner can show only once we KNOW the trip isn't pro (or it's instantly a pro_trip).
  const tripProResolved = !!trip?.is_pro_trip || proResolved;
  const [tripProInfoOpen, setTripProInfoOpen] = useState(false);
  const [budgetAddonOff, setBudgetAddonOff] = useState(false);

  // If the URL points at a lens the trip has disabled, fall back to the timeline.
  // Viewers can't open Settings/Members even by deep link → fall back too.
  const VIEWER_BLOCKED_LENSES = new Set(['settings', 'members']);
  let shownLens = isLensVisible(trip, lens) ? lens : 'timeline';
  if (myRole === 'viewer' && VIEWER_BLOCKED_LENSES.has(shownLens)) shownLens = 'timeline';

  if (loadingShell) return <LoadingScreen />;
  if (shellError || (!loadingShell && !trip)) return <ErrorScreen onBack={() => nav('/trips')} />;

  return (
    <div className="app" style={{ minHeight: '100vh', background: 'var(--bg, var(--wash))' }}>
      <TripHeader
        trip={trip}
        visits={visits}
        isPro={accountPro}
        isDark={isDark}
        onToggleTheme={toggleTheme}
        user={user}
        nav={nav}
      />
      <div className="app-body">
        <TripSidebar tripId={tripId} trip={trip} lens={lens} onNavigate={setLens} isPro={tripIsPro} proResolved={tripProResolved} isOwner={isOwner} myRole={myRole} onUpgrade={openUpgrade} onProInfo={() => setTripProInfoOpen(true)} />
        <main style={{
          minWidth: 0,
          padding: shownLens === 'map' ? 0 : shownLens === 'chat' ? '28px 28px 28px' : '28px 28px 60px',
          height: (shownLens === 'map' || shownLens === 'chat') ? 'calc(100vh - 56px)' : undefined,
          overflow: (shownLens === 'map' || shownLens === 'chat') ? 'hidden' : undefined,
        }}>
          {/* Transfer - opened from missing-transfer warnings or edit mode */}
          {transferEdit.fromVisit && transferEdit.toVisit && (
            <EventEditDialog
              open={transferEdit.open}
              onOpenChange={(open) => setTransferEdit(s => ({ ...s, open }))}
              kind="transfer"
              tripId={tripId}
              fromVisit={transferEdit.fromVisit}
              toVisit={transferEdit.toVisit}
              entity={transferEdit.transfer}
              defaultCurrency={trip?.details?.main_currency || 'EUR'}
            />
          )}
          {/* Hotel - opened from missing-hotel warnings or edit mode */}
          {hotelEdit.visit && (
            <EventEditDialog
              open={hotelEdit.open}
              onOpenChange={(open) => setHotelEdit(s => ({ ...s, open }))}
              kind="hotel"
              visit={hotelEdit.visit}
              entity={hotelEdit.hotel}
              defaultCurrency={trip?.details?.main_currency || 'EUR'}
            />
          )}
          {/* Hotel choice - sits between the warning button and the edit form */}
          <ForkPartnerModal
            open={hotelChoice.open}
            onOpenChange={(o) => setHotelChoice(s => ({ ...s, open: o }))}
            type="hotel"
            visit={hotelChoice.visit}
            tripId={tripId}
            onManual={() => setHotelEdit({ open: true, visit: hotelChoice.visit, hotel: null })}
          />
          {/* Transfer choice - sits between the warning button and the edit form */}
          <ForkPartnerModal
            open={transferChoice.open}
            onOpenChange={(o) => setTransferChoice(s => ({ ...s, open: o }))}
            type="transfer"
            fromVisit={transferChoice.fromVisit}
            toVisit={transferChoice.toVisit}
            tripId={tripId}
            onManual={() =>
              setTransferEdit({
                open: true,
                fromVisit: transferChoice.fromVisit,
                toVisit: transferChoice.toVisit,
                transfer: null,
              })
            }
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
              entity={null}
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
              service={null}
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
          />

          {shownLens === 'timeline' && (
            <>
              <TripCoverStrip
                trip={trip}
                visits={visits}
                members={members}
                myRole={myRole}
                canEditMode={canEditMode}
                frozen={frozen}
                isEditMode={isEditMode}
                onToggleEdit={() => setIsEditMode(m => !m)}
              />
              {frozen && (
                <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '10px 14px', marginBottom: 14, borderRadius: 10, background: 'var(--wash)', border: '1px solid var(--line)', fontSize: 13, color: 'var(--ink-2)' }}>
                  <Icon name="lock" size={14} /> Путешествие сейчас редактируется в режиме структуры - изменения временно недоступны.
                </div>
              )}
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 260px', gap: 24, alignItems: 'start' }}>
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
                  isEditMode={isEditMode}
                  onOpenEvent={openEventView}
                  onAddActivityForDay={frozen ? frozenNote : (dayKey) => {
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
                  budgetCategories={budgetCategories}
                  members={members}
                  services={services}
                  user={user}
                  trip={trip}
                  isLoading={loadingContent}
                  onAddService={frozen ? frozenNote : (type) => setServiceChoice({ open: true, type })}
                  canManage={myRole !== 'viewer'}
                  budgetEnabled={isAddonEnabled(trip, 'budget')}
                  onBudgetLocked={() => setBudgetAddonOff(true)}
                />
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
          {shownLens === 'map' && (
            <ScreenMap
              trip={trip}
              visits={visits ?? []}
              transfers={transfers ?? []}
              hotels={hotels ?? []}
              activities={activities ?? []}
              canEdit={myRole === 'owner' || myRole === 'editor' || myRole === 'admin'}
              openEvent={(kind, id) => setEventView({ open: true, kind, id })}
            />
          )}
        </main>
      </div>


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
              <h2>Бюджет-разбивка выключена</h2>
              <button className="icon-btn" onClick={() => setBudgetAddonOff(false)}><Icon name="close" size={16} /></button>
            </div>
            <div className="dlg__body">
              <div className="muted" style={{ fontSize: 13, lineHeight: 1.6 }}>
                Полная разбивка бюджета - опциональная Pro-фича путешествия. Включи её в настройках путешествия, чтобы открыть раздел бюджета.
              </div>
            </div>
            <div className="dlg__foot">
              <Btn variant="ghost" onClick={() => setBudgetAddonOff(false)}>Закрыть</Btn>
              <Btn variant="primary" icon="settings" onClick={() => { setBudgetAddonOff(false); setLens('settings'); }}>Открыть настройки</Btn>
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

      <ModalHost />
      <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>
    </div>
  );
}
