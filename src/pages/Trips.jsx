import React, { useState, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import { supabase } from '@/api/supabaseClient';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useAuth } from '@/lib/AuthContext';
import { isTripInPast, formatTripRange } from '@/lib/trip-dates';
import { Icon } from '../design/icons';
import { Avatar, Badge, Btn, EmptyState } from '../design/index';
import '../design/app.css';

import TripLimitDialog from '@/components/subscriptions/TripLimitDialog';
import UpgradePlanDialog from '@/components/subscriptions/UpgradePlanDialog';

// ─── helpers ────────────────────────────────────────────────────────────────
function strHue(str = '') {
  let h = 0;
  for (let i = 0; i < str.length; i++) h = (h * 31 + str.charCodeAt(i)) | 0;
  return Math.abs(h) % 360;
}

function scopeLabel(visits = []) {
  const cities = [...new Set(visits.map(v => v.city_name).filter(Boolean))];
  if (cities.length === 0) return 'Нет городов';
  if (cities.length <= 3) return cities.join(' · ');
  return cities.slice(0, 2).join(' · ') + ` · ещё ${cities.length - 2}`;
}

/** Shape raw Supabase trip + visits into the object the card components expect */
function normalizeTrip(trip, visits = [], role = 'member', isPro = false) {
  return {
    ...trip,
    coverHue:  strHue(trip.id),
    accentHue: strHue(trip.title || ''),
    days:      formatTripRange(visits, '—'),
    scope:     scopeLabel(visits),
    role,
    pro:       isPro,
    status:    isTripInPast(visits) ? 'past' : 'active',
  };
}

// ─── Trip cover gradient ──────────────────────────────────────────────────────
const CollectionTripCover = ({ trip }) => {
  const hue      = trip.coverHue ?? 210;
  const accent   = trip.accentHue ?? 18;
  const isDark   = document.documentElement.dataset.theme === 'dark';
  const bg = `linear-gradient(135deg,
    hsl(${hue}, 60%, ${isDark ? 28 : 70}%) 0%,
    hsl(${(hue + accent) % 360}, 55%, ${isDark ? 22 : 60}%) 70%,
    hsl(${accent}, 70%, ${isDark ? 35 : 65}%) 100%)`;
  return (
    <div style={{ aspectRatio: '16/9', background: bg, borderRadius: 'var(--radius-card)', position: 'relative', overflow: 'hidden' }}>
      <svg viewBox="0 0 200 100" preserveAspectRatio="none" style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', opacity: 0.45 }}>
        <path d={`M0 ${60 + trip.id.length % 20} Q 50 ${30 + trip.id.length % 10} 100 ${50 + trip.id.length % 15} T 200 ${40 + trip.id.length % 12}`}
          stroke="white" strokeWidth="1" fill="none" strokeDasharray="2 3" />
      </svg>
      <div style={{ position: 'absolute', top: 12, right: 12, display: 'flex', gap: 6 }}>
        {trip.pro && (
          <div style={{ background: 'rgba(255,255,255,.92)', color: 'var(--warm)', fontSize: 11, fontWeight: 700, letterSpacing: '.05em', padding: '3px 8px', borderRadius: 999 }}>Pro</div>
        )}
        {trip.role !== 'owner' && (
          <div style={{ background: 'rgba(15,23,42,.6)', color: 'white', fontSize: 11, fontWeight: 600, padding: '3px 8px', borderRadius: 999, backdropFilter: 'blur(8px)', display: 'inline-flex', alignItems: 'center', gap: 4 }}>
            <Icon name="users" size={11} /> Совместный
          </div>
        )}
      </div>
      {trip.status === 'past' && (
        <div style={{ position: 'absolute', inset: 0, background: 'rgba(15,23,42,.55)' }} />
      )}
    </div>
  );
};

// ─── Trip card (grid view) ───────────────────────────────────────────────────
const TripCard = ({ trip, onClick }) => (
  <button
    onClick={onClick}
    style={{ border: '1px solid var(--line)', background: 'var(--surface)', borderRadius: 'var(--radius-card)', padding: 14, textAlign: 'left', display: 'flex', flexDirection: 'column', gap: 12, cursor: 'pointer', transition: 'transform .15s, box-shadow .15s, border-color .15s' }}
    onMouseEnter={e => { e.currentTarget.style.transform = 'translateY(-2px)'; e.currentTarget.style.boxShadow = 'var(--shadow-card)'; e.currentTarget.style.borderColor = '#dbe1ec'; }}
    onMouseLeave={e => { e.currentTarget.style.transform = ''; e.currentTarget.style.boxShadow = ''; e.currentTarget.style.borderColor = 'var(--line)'; }}
  >
    <CollectionTripCover trip={trip} />
    <div style={{ display: 'flex', alignItems: 'flex-start', gap: 8 }}>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ fontFamily: 'var(--font-display)', fontWeight: 600, fontSize: 17, letterSpacing: '-0.015em', marginBottom: 4, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{trip.title}</div>
        <div className="muted num" style={{ fontSize: 12.5 }}>{trip.days}</div>
      </div>
      {trip.role === 'viewer' && <Badge variant="quiet" icon="eye">Зритель</Badge>}
      {trip.role === 'admin'  && <Badge>Админ</Badge>}
    </div>
    <div style={{ display: 'flex', alignItems: 'center', gap: 10, fontSize: 12, color: 'var(--muted)' }}>
      <Icon name="pin" size={13} />
      <span style={{ flex: 1, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{trip.scope}</span>
      {trip.status === 'draft' && <Badge variant="warning" dot>Черновик</Badge>}
    </div>
  </button>
);

// ─── Trip row (list view) ────────────────────────────────────────────────────
const TripRow = ({ trip, onClick }) => (
  <button onClick={onClick} style={{ display: 'grid', gridTemplateColumns: '44px 1fr 180px 140px 100px 30px', alignItems: 'center', gap: 14, padding: '12px 16px', background: 'var(--surface)', border: '1px solid var(--line)', borderRadius: 12, cursor: 'pointer', textAlign: 'left', fontSize: 13.5 }}
    onMouseEnter={e => e.currentTarget.style.borderColor = '#dbe1ec'}
    onMouseLeave={e => e.currentTarget.style.borderColor = 'var(--line)'}>
    <div style={{ width: 44, height: 44, borderRadius: 10, background: `hsl(${trip.coverHue ?? 210}, 50%, 60%)`, position: 'relative' }}>
      {trip.role !== 'owner' && (
        <span style={{ position: 'absolute', bottom: -3, right: -3, width: 20, height: 20, borderRadius: '50%', background: 'var(--surface)', border: '2px solid var(--surface)', display: 'grid', placeItems: 'center' }}>
          <Icon name="users" size={11} style={{ color: 'var(--brand)' }} />
        </span>
      )}
    </div>
    <div>
      <div style={{ fontWeight: 600, color: 'var(--ink)', marginBottom: 2, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{trip.title}</div>
      <div className="muted" style={{ fontSize: 12 }}>{trip.scope}</div>
    </div>
    <div className="muted num" style={{ fontSize: 12.5 }}>{trip.days}</div>
    <div>
      {trip.role === 'owner'  && <Badge>Владелец</Badge>}
      {trip.role === 'admin'  && <Badge>Админ</Badge>}
      {trip.role === 'viewer' && <Badge variant="quiet" icon="eye">Зритель</Badge>}
    </div>
    <div>{trip.pro && <Badge variant="warm">Pro</Badge>}</div>
    <Icon name="chev" size={14} style={{ color: 'var(--muted-2)' }} />
  </button>
);

// ─── New Trip Dialog ─────────────────────────────────────────────────────────
function NewTripDialog({ onClose, onManual, onAi }) {
  return (
    <div style={{ position: 'fixed', inset: 0, zIndex: 999, display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'rgba(15,23,42,.45)', backdropFilter: 'blur(4px)' }}
      onClick={onClose}>
      <div onClick={e => e.stopPropagation()}
        style={{ background: 'var(--surface)', border: '1px solid var(--line)', borderRadius: 18, padding: 28, width: 440, maxWidth: 'calc(100vw - 32px)', boxShadow: 'var(--shadow-pop)' }}>
        <h2 style={{ margin: '0 0 6px', fontSize: 20, fontWeight: 700 }}>Новый трип</h2>
        <div style={{ color: 'var(--muted)', fontSize: 14, marginBottom: 22 }}>Как хочешь начать?</div>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
          <button onClick={onManual} style={{ padding: 20, background: 'var(--surface)', border: '1.5px solid var(--line)', borderRadius: 14, cursor: 'pointer', textAlign: 'left' }}
            onMouseEnter={e => e.currentTarget.style.borderColor = 'var(--brand)'}
            onMouseLeave={e => e.currentTarget.style.borderColor = 'var(--line)'}>
            <div style={{ width: 40, height: 40, borderRadius: 10, background: 'var(--brand)', color: 'white', display: 'grid', placeItems: 'center', marginBottom: 12 }}>
              <Icon name="edit" size={19} />
            </div>
            <div style={{ fontWeight: 600, marginBottom: 4 }}>Собрать руками</div>
            <div style={{ color: 'var(--muted)', fontSize: 12.5, lineHeight: 1.5 }}>Выбрать города, даты, отели вручную.</div>
          </button>
          <button onClick={onAi} className="ai-card" style={{ padding: 20, background: 'linear-gradient(135deg, var(--ai-soft) 0%, rgba(240,164,90,.05) 100%)', border: '1.5px solid var(--ai-soft-12)', borderRadius: 14, cursor: 'pointer', textAlign: 'left' }}>
            <div style={{ width: 40, height: 40, borderRadius: 10, background: 'linear-gradient(135deg, #6a3ee2, #c66ce2)', color: 'white', display: 'grid', placeItems: 'center', marginBottom: 12 }}>
              <Icon name="sparkles" size={19} />
            </div>
            <div style={{ fontWeight: 600, marginBottom: 4, color: 'var(--ai)' }}>Начать с ИИ</div>
            <div style={{ color: 'var(--muted)', fontSize: 12.5, lineHeight: 1.5 }}>Описать словами — получить черновик.</div>
          </button>
        </div>
        <div style={{ marginTop: 16, textAlign: 'right' }}>
          <Btn variant="ghost" onClick={onClose}>Отмена</Btn>
        </div>
      </div>
    </div>
  );
}

// ─── Empty state ─────────────────────────────────────────────────────────────
function CollectionEmpty({ onManual, onAi }) {
  return (
    <div style={{ maxWidth: 720, margin: '60px auto', textAlign: 'center' }}>
      <div style={{ width: 96, height: 96, margin: '0 auto 22px', borderRadius: 24, background: 'linear-gradient(135deg, var(--brand-soft), var(--ai-soft))', display: 'grid', placeItems: 'center' }}>
        <Icon name="globe" size={42} style={{ color: 'var(--brand)' }} />
      </div>
      <h1 style={{ marginBottom: 10 }}>Спланируй первый трип</h1>
      <div className="muted" style={{ fontSize: 16, marginBottom: 28, maxWidth: 480, margin: '0 auto 28px' }}>
        Triplanio собирает города, переезды, отели, активности и бюджет в одну картину. Начни с любого.
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 14, maxWidth: 600, margin: '0 auto' }}>
        <button onClick={onManual} style={{ padding: 22, background: 'var(--surface)', border: '1.5px solid var(--brand-soft-12)', borderRadius: 14, cursor: 'pointer', textAlign: 'left' }}>
          <div style={{ width: 40, height: 40, borderRadius: 10, background: 'var(--brand)', color: 'white', display: 'grid', placeItems: 'center', marginBottom: 14 }}>
            <Icon name="edit" size={19} />
          </div>
          <div style={{ fontWeight: 600, marginBottom: 4 }}>Собрать руками</div>
          <div className="muted" style={{ fontSize: 12.5, lineHeight: 1.5 }}>Сам выбираю города, даты, отели и активности. Полный контроль.</div>
        </button>
        <button onClick={onAi} style={{ padding: 22, background: 'linear-gradient(135deg, var(--ai-soft) 0%, rgba(240,164,90,.05) 100%)', border: '1.5px solid var(--ai-soft-12)', borderRadius: 14, cursor: 'pointer', textAlign: 'left' }}
          className="ai-card">
          <div style={{ width: 40, height: 40, borderRadius: 10, background: 'linear-gradient(135deg, #6a3ee2, #c66ce2)', color: 'white', display: 'grid', placeItems: 'center', marginBottom: 14 }}>
            <Icon name="sparkles" size={19} />
          </div>
          <div style={{ fontWeight: 600, marginBottom: 4 }} className="ai-text">Начать с ИИ <Badge variant="warm" style={{ marginLeft: 4 }}>Pro</Badge></div>
          <div className="muted" style={{ fontSize: 12.5, lineHeight: 1.5 }}>Описать словами — получить черновик и доработать с ассистентом.</div>
        </button>
      </div>
    </div>
  );
}

// ─── Skeleton ─────────────────────────────────────────────────────────────────
function TripSkeleton({ viewMode }) {
  if (viewMode === 'list') {
    return (
      <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
        {Array.from({ length: 4 }).map((_, i) => (
          <div key={i} style={{ height: 68, borderRadius: 12, background: 'var(--wash)', animation: 'pulse 1.4s ease-in-out infinite' }} />
        ))}
      </div>
    );
  }
  return (
    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(280px, 1fr))', gap: 16 }}>
      {Array.from({ length: 4 }).map((_, i) => (
        <div key={i} style={{ borderRadius: 'var(--radius-card)', background: 'var(--wash)', height: 260, animation: 'pulse 1.4s ease-in-out infinite' }} />
      ))}
    </div>
  );
}

// ─── Main page ────────────────────────────────────────────────────────────────
export default function Trips() {
  const { user }  = useAuth();
  const nav       = useNavigate();
  const qc        = useQueryClient();

  const [theme, setTheme] = useState(() => {
    try { return localStorage.getItem('triplanio:theme') || 'light'; } catch { return 'light'; }
  });
  React.useEffect(() => {
    document.documentElement.setAttribute('data-theme', theme);
    try { localStorage.setItem('triplanio:theme', theme); } catch { /* ignore */ }
  }, [theme]);

  const [viewMode,    setViewMode]    = useState(() => {
    try { return localStorage.getItem('trips:viewMode') === 'list' ? 'list' : 'grid'; } catch { return 'grid'; }
  });
  const [filterMode,  setFilterMode]  = useState('active');
  const [search,      setSearch]      = useState('');
  const [showNewTrip, setShowNewTrip] = useState(false);
  const [showLimit,   setShowLimit]   = useState(false);
  const [showUpgrade, setShowUpgrade] = useState(false);
  const [pendingPick, setPendingPick] = useState(null);

  React.useEffect(() => {
    try { localStorage.setItem('trips:viewMode', viewMode); } catch { /* ignore */ }
  }, [viewMode]);

  const isPro = ['pro_monthly', 'pro_yearly', 'pro_trip'].includes(user?.subscription_status);

  // ── Fetch trips ─────────────────────────────────────────────────────────────
  const { data: allTrips = [], isLoading } = useQuery({
    queryKey: ['trips', user?.id],
    queryFn: async () => {
      const { data, error } = await supabase.from('trips').select('*').order('created_at', { ascending: false });
      if (error) throw error;
      return data || [];
    },
    enabled: !!user?.id,
  });

  const { data: myMemberships = [] } = useQuery({
    queryKey: ['my-memberships', user?.email],
    queryFn: async () => {
      const { data, error } = await supabase.from('trip_members').select('*').eq('user_email', user.email).eq('status', 'active');
      if (error) throw error;
      return data || [];
    },
    enabled: !!user?.email,
  });

  const tripIds  = allTrips.map(t => t.id);
  const hasTrips = tripIds.length > 0;

  const { data: allVisits = [], isLoading: loadingVisits } = useQuery({
    queryKey: ['all-city-visits', tripIds.join(',')],
    queryFn: async () => {
      const { data, error } = await supabase.from('city_visits').select('*').in('trip_id', tripIds);
      if (error) throw error;
      return data || [];
    },
    enabled: hasTrips,
  });

  const visitsByTrip = useMemo(() => {
    const m = {};
    allVisits.forEach(v => { (m[v.trip_id] ||= []).push(v); });
    return m;
  }, [allVisits]);

  const getRoleFor = (trip) => {
    if (trip.created_by === user?.email) return 'owner';
    const m = myMemberships.find(m => m.trip_id === trip.id);
    return m?.role || 'member';
  };

  // ── Partition ────────────────────────────────────────────────────────────────
  const matches = (tr) => {
    const q = search.trim().toLowerCase();
    return !q || tr.title?.toLowerCase().includes(q) || tr.description?.toLowerCase().includes(q);
  };

  const activeTrips = allTrips.filter(t => !isTripInPast(visitsByTrip[t.id] || []) && matches(t));
  const pastTrips   = allTrips.filter(t =>  isTripInPast(visitsByTrip[t.id] || []) && matches(t));
  const shown       = filterMode === 'active' ? activeTrips : pastTrips;

  // Normalize to the shape TripCard / TripRow expect
  const shownNorm = shown.map(t => normalizeTrip(t, visitsByTrip[t.id] || [], getRoleFor(t), isPro));

  // ── Create flow ───────────────────────────────────────────────────────────────
  const checkLimit = (pick) => {
    if (!isPro && activeTrips.length >= 1) {
      setPendingPick(pick); setShowLimit(true);
    } else {
      nav(pick === 'ai' ? '/plan-trip-ai' : '/new-trip');
    }
  };
  const handleProceed = () => {
    setShowLimit(false);
    nav(pendingPick === 'ai' ? '/plan-trip-ai' : '/new-trip');
    setPendingPick(null);
  };

  const isLoadingData = isLoading || (hasTrips && loadingVisits);

  // ── Render ────────────────────────────────────────────────────────────────────
  return (
    <div style={{ display: 'flex', flexDirection: 'column', minHeight: '100vh', background: 'var(--bg, var(--wash))' }}>

      {/* APP HEADER */}
      <header className="app-header" style={{ position: 'sticky', top: 0, zIndex: 50 }}>
        <div className="app-header__brand" onClick={() => nav('/trips')} style={{ cursor: 'pointer' }}>
          <img src="/triplanio-logo.svg" alt="Triplanio" style={{ width: 28, height: 28, borderRadius: 7, flexShrink: 0 }} />
          <span className="app-header__brand-name">Triplanio</span>
        </div>
        <div className="app-header__right">
          <button className="icon-btn" title="Сменить тему" onClick={() => setTheme(t => t === 'light' ? 'dark' : 'light')}>
            <Icon name={theme === 'light' ? 'moon' : 'sun'} size={17} />
          </button>
          <button className="icon-btn" title="Уведомления" style={{ position: 'relative' }} onClick={() => nav('/inbox')}>
            <Icon name="bell" size={17} />
          </button>
          <button className="icon-btn" title={user?.full_name || user?.email || 'Аккаунт'} onClick={() => nav('/settings')} style={{ padding: '0 2px' }}>
            <Avatar name={user?.full_name || user?.email || '?'} photo={user?.avatar_url} size="sm" />
          </button>
        </div>
      </header>

      {/* PAGE CONTENT */}
      <main style={{ flex: 1, padding: '32px 28px', maxWidth: 1240, margin: '0 auto', width: '100%', boxSizing: 'border-box' }}>

        {/* Empty collection */}
        {!isLoadingData && allTrips.length === 0 && (
          <CollectionEmpty onManual={() => checkLimit('manual')} onAi={() => checkLimit('ai')} />
        )}

        {/* Normal view */}
        {(isLoadingData || allTrips.length > 0) && (
          <>
            {/* Header row */}
            <div style={{ display: 'flex', alignItems: 'flex-start', gap: 16, marginBottom: 24, flexWrap: 'wrap' }}>
              <div style={{ flex: 1, minWidth: 200 }}>
                <h1 style={{ marginBottom: 6 }}>Твои трипы</h1>
                <div className="muted" style={{ fontSize: 15 }}>
                  {activeTrips.length} активных · {pastTrips.length} в архиве
                </div>
              </div>
              <Btn variant="primary" size="lg" icon="plus" onClick={() => setShowNewTrip(true)}>Новый трип</Btn>
            </div>

            {/* Filters row */}
            <div style={{ display: 'flex', alignItems: 'center', gap: 14, marginBottom: 18, flexWrap: 'wrap' }}>
              <div className="tweaks__seg" style={{ flexShrink: 0 }}>
                <button className={filterMode === 'active' ? 'active' : ''} onClick={() => setFilterMode('active')} style={{ whiteSpace: 'nowrap' }}>
                  Активные · {activeTrips.length}
                </button>
                <button className={filterMode === 'past' ? 'active' : ''} onClick={() => setFilterMode('past')} style={{ whiteSpace: 'nowrap' }}>
                  Прошедшие · {pastTrips.length}
                </button>
              </div>
              <div style={{ position: 'relative', flex: 1, minWidth: 220, maxWidth: 360 }}>
                <Icon name="search" size={15} style={{ position: 'absolute', left: 11, top: '50%', transform: 'translateY(-50%)', color: 'var(--muted-2)' }} />
                <input className="input" placeholder="Поиск по названию, городу, описанию" value={search} onChange={e => setSearch(e.target.value)} style={{ paddingLeft: 34 }} />
              </div>
              <div style={{ flex: 1 }} />
              <div className="tweaks__seg" title="Вид">
                <button className={viewMode === 'grid' ? 'active' : ''} onClick={() => setViewMode('grid')}><Icon name="grid" size={13} /></button>
                <button className={viewMode === 'list' ? 'active' : ''} onClick={() => setViewMode('list')}><Icon name="list" size={13} /></button>
              </div>
            </div>

            {/* Trip list */}
            {isLoadingData ? (
              <TripSkeleton viewMode={viewMode} />
            ) : shownNorm.length === 0 ? (
              <EmptyState
                icon={filterMode === 'past' ? 'calendar' : 'search'}
                title={filterMode === 'past' ? 'В архиве пока ничего нет' : 'По этому запросу ничего не нашлось'}
                body={filterMode === 'past' ? 'Завершённые трипы будут собираться здесь.' : 'Поправь поиск или переключись на другую вкладку.'}
              />
            ) : viewMode === 'grid' ? (
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(280px, 1fr))', gap: 16 }}>
                {shownNorm.map(t => (
                  <TripCard key={t.id} trip={t} onClick={() => nav(`/trip/${t.id}`)} />
                ))}
                {filterMode === 'active' && (
                  <button
                    onClick={() => setShowNewTrip(true)}
                    style={{ border: '1.5px dashed var(--line)', background: 'transparent', borderRadius: 'var(--radius-card)', padding: 24, display: 'flex', flexDirection: 'column', justifyContent: 'center', alignItems: 'center', gap: 10, cursor: 'pointer', color: 'var(--muted)', minHeight: 260 }}
                    onMouseEnter={e => { e.currentTarget.style.borderColor = 'var(--brand)'; e.currentTarget.style.color = 'var(--brand)'; }}
                    onMouseLeave={e => { e.currentTarget.style.borderColor = 'var(--line)'; e.currentTarget.style.color = 'var(--muted)'; }}
                  >
                    <Icon name="plus" size={22} />
                    <div style={{ fontWeight: 500 }}>Добавить трип</div>
                    <div style={{ fontSize: 12, textAlign: 'center', maxWidth: 200 }}>Собрать руками или начать с ИИ.</div>
                  </button>
                )}
              </div>
            ) : (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                {shownNorm.map(t => (
                  <TripRow key={t.id} trip={t} onClick={() => nav(`/trip/${t.id}`)} />
                ))}
              </div>
            )}

            {/* Free-limit banner */}
            {!isPro && filterMode === 'active' && (
              <div className="ai-card" style={{ marginTop: 36, padding: '18px 22px', background: 'linear-gradient(135deg, var(--ai-soft) 0%, rgba(240,164,90,.06) 100%)', border: '1px solid var(--ai-soft-12)', borderRadius: 'var(--radius-card)', display: 'flex', alignItems: 'center', gap: 16, flexWrap: 'wrap' }}>
                <div style={{ width: 40, height: 40, borderRadius: 10, background: 'linear-gradient(135deg, #6a3ee2, #c66ce2)', color: 'white', display: 'grid', placeItems: 'center' }}>
                  <Icon name="sparkles" size={18} />
                </div>
                <div style={{ flex: 1, minWidth: 200 }}>
                  <div style={{ fontWeight: 600, marginBottom: 2 }}>На Free доступен 1 активный трип</div>
                  <div className="muted" style={{ fontSize: 12.5 }}>Pro — безлимит трипов, ИИ-планировщик и парсинг бронирований.</div>
                </div>
                <Btn variant="primary" onClick={() => setShowUpgrade(true)}>Перейти к Pro</Btn>
              </div>
            )}
          </>
        )}
      </main>

      {/* Dialogs */}
      {showNewTrip && (
        <NewTripDialog
          onClose={() => setShowNewTrip(false)}
          onManual={() => { setShowNewTrip(false); checkLimit('manual'); }}
          onAi={() => { setShowNewTrip(false); checkLimit('ai'); }}
        />
      )}
      <TripLimitDialog
        open={showLimit}
        onOpenChange={setShowLimit}
        onProceed={handleProceed}
        activeCount={activeTrips.length}
        isPro={isPro}
      />
      <UpgradePlanDialog
        open={showUpgrade}
        onOpenChange={setShowUpgrade}
        hidePerTrip
        onUpgradeComplete={() => { qc.invalidateQueries({ queryKey: ['me'] }); setShowUpgrade(false); }}
      />
    </div>
  );
}
