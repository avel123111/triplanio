import React, { useMemo, useState, useEffect } from 'react';
import { useParams, useNavigate, useSearchParams } from 'react-router-dom';
import { useQuery, useQueryClient } from '@tanstack/react-query';

import { supabase } from '@/api/supabaseClient';
import { useAuth } from '@/lib/AuthContext';
import { TRIP_SHELL_KEY, TRIP_CONTENT_KEY } from '@/lib/trip-data';
import { naiveDayKey, parseNaive, formatNaive } from '@/lib/naive-time';
import { isTripInPast, formatTripRange } from '@/lib/trip-dates';
import { Icon } from '../design/icons';
import { Avatar, Btn, Badge, EmptyState, Skeleton, groupByDate, fmtDate, weekday, StreamEventRow, fmt } from '../design/index';
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

      <div className="app-header__brand" onClick={() => nav('/trips')}>
        <div className="app-header__brand-mark" style={{ background: 'var(--brand)', display: 'grid', placeItems: 'center' }}>
          <Icon name="brand" size={18} style={{ color: 'white' }} />
        </div>
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

function DateHeader({ date, visits }) {
  const city = visits.find(v => {
    const s = naiveDayKey(v.start_datetime);
    const e = naiveDayKey(v.end_datetime);
    return s && e && date >= s && date <= e;
  })?.city_name;

  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 10, marginTop: 4 }}>
      <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--ink-2)' }}>
        {fmtDate(date)}
        <span style={{ color: 'var(--muted-2)', fontWeight: 400, marginLeft: 5 }}>· {weekday(date)}</span>
      </div>
      {city && (
        <span style={{ display: 'inline-flex', alignItems: 'center', gap: 5, padding: '2px 8px 2px 6px', borderRadius: 999, background: 'var(--brand-soft)', color: 'var(--brand)', fontSize: 11.5, fontWeight: 500 }}>
          <Icon name="pin" size={11} />
          {city}
        </span>
      )}
    </div>
  );
}

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

function TimelineLens({ stream, visits, trip, isLoading }) {
  if (isLoading) return <SkeletonTimeline />;

  if (!stream.length) {
    return (
      <EmptyState
        icon="list"
        title="Хронология пуста"
        body="Добавь отели, переезды и активности — они появятся здесь в хронологическом порядке."
      />
    );
  }

  const groups = groupByDate(stream);

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 24 }}>
      {groups.map(({ date, items }) => (
        <div key={date}>
          <DateHeader date={date} visits={visits} />
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            {items.map((e, idx) => (
              <StreamEventRow key={e.id} e={e} last={idx === items.length - 1} onClick={() => {}} />
            ))}
          </div>
        </div>
      ))}
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
            <TimelineLens
              stream={stream}
              visits={visits}
              trip={trip}
              isLoading={loadingContent}
            />
          )}
          {lens === 'budget' && (
            <BudgetLens
              tripId={tripId}
              budget={budget}
              budgetCategories={budgetCategories}
              budgetExpenses={budgetExpenses}
              members={members}
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

      <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>
    </div>
  );
}
