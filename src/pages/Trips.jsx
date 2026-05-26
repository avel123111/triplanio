import React, { useState, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import { supabase } from '@/api/supabaseClient';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useAuth } from '@/lib/AuthContext';
import { isTripInPast, computeTripRange, formatTripRange } from '@/lib/trip-dates';
import { Icon } from '../design/icons';
import '../design/app.css';

// Dialog components (keep existing working ones)
import NewTripModal from '@/components/trips/NewTripModal';
import TripFormDialog from '@/components/trips/TripFormDialog';
import TripLimitDialog from '@/components/subscriptions/TripLimitDialog';
import UpgradePlanDialog from '@/components/subscriptions/UpgradePlanDialog';
import UserMenu from '@/components/UserMenu';

// ─── helpers ────────────────────────────────────────────────────────────────

/** Deterministic hue from a string (for cover gradient) */
function strHue(str = '') {
  let h = 0;
  for (let i = 0; i < str.length; i++) h = (h * 31 + str.charCodeAt(i)) | 0;
  return Math.abs(h) % 360;
}

/** Derive city list string from visits */
function scopeLabel(visits = []) {
  const cities = [...new Set(visits.map(v => v.city_name).filter(Boolean))];
  if (cities.length === 0) return 'Нет городов';
  if (cities.length <= 3) return cities.join(' · ');
  return cities.slice(0, 2).join(' · ') + ` · ещё ${cities.length - 2}`;
}

// ─── Trip cover gradient ─────────────────────────────────────────────────────
function TripCover({ tripId, title, status }) {
  const hue       = strHue(tripId);
  const accentHue = strHue(title);
  const isDark    = document.documentElement.dataset.theme === 'dark';
  const bg = `linear-gradient(135deg,
    hsl(${hue}, 60%, ${isDark ? 28 : 66}%) 0%,
    hsl(${(hue + accentHue) % 360}, 55%, ${isDark ? 22 : 56}%) 70%,
    hsl(${accentHue}, 70%, ${isDark ? 35 : 62}%) 100%)`;

  return (
    <div style={{
      aspectRatio: '16/9',
      background: bg,
      borderRadius: 'var(--radius-card)',
      position: 'relative',
      overflow: 'hidden',
    }}>
      <svg viewBox="0 0 200 100" preserveAspectRatio="none"
        style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', opacity: 0.4 }}>
        <path
          d={`M0 ${60 + tripId.length % 20} Q 50 ${30 + tripId.length % 10} 100 ${50 + tripId.length % 15} T 200 ${40 + tripId.length % 12}`}
          stroke="white" strokeWidth="1" fill="none" strokeDasharray="2 3"
        />
      </svg>
      {status === 'past' && (
        <div style={{ position: 'absolute', inset: 0, background: 'rgba(15,23,42,.5)' }} />
      )}
    </div>
  );
}

// ─── Trip card (grid view) ───────────────────────────────────────────────────
function TripCard({ trip, visits, role, onClick }) {
  const [hovered, setHovered] = useState(false);
  const isPast = isTripInPast(visits);
  const dateStr = formatTripRange(visits, '—');

  return (
    <button
      onClick={onClick}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      style={{
        border: '1px solid var(--line)',
        background: 'var(--surface)',
        borderRadius: 'var(--radius-card)',
        padding: 14,
        textAlign: 'left',
        display: 'flex', flexDirection: 'column', gap: 12,
        cursor: 'pointer',
        transition: 'transform .15s, box-shadow .15s, border-color .15s',
        transform: hovered ? 'translateY(-2px)' : '',
        boxShadow: hovered ? 'var(--shadow-card)' : '',
        borderColor: hovered ? '#dbe1ec' : 'var(--line)',
      }}
    >
      <TripCover tripId={trip.id} title={trip.title} status={isPast ? 'past' : 'active'} />
      <div style={{ display: 'flex', alignItems: 'flex-start', gap: 8 }}>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{
            fontFamily: 'var(--font-display)', fontWeight: 600, fontSize: 17,
            letterSpacing: '-0.015em', marginBottom: 4,
            overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
          }}>
            {trip.title}
          </div>
          <div style={{ color: 'var(--muted)', fontSize: 12.5, fontVariantNumeric: 'tabular-nums' }}>
            {dateStr}
          </div>
        </div>
        {role === 'viewer' && (
          <span style={{
            display: 'inline-flex', alignItems: 'center', gap: 4,
            background: 'var(--wash)', color: 'var(--muted)', border: '1px solid var(--line)',
            fontSize: 11, fontWeight: 500, padding: '2px 7px', borderRadius: 6,
          }}>
            <Icon name="eye" size={11} /> Зритель
          </span>
        )}
      </div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 12, color: 'var(--muted)' }}>
        <Icon name="pin" size={13} />
        <span style={{ flex: 1, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
          {scopeLabel(visits)}
        </span>
        {role !== 'owner' && (
          <span style={{
            display: 'inline-flex', alignItems: 'center', gap: 4,
            background: 'rgba(15,23,42,.08)', color: 'var(--muted)',
            fontSize: 11, fontWeight: 500, padding: '2px 7px', borderRadius: 6,
          }}>
            <Icon name="users" size={11} /> Совместный
          </span>
        )}
      </div>
    </button>
  );
}

// ─── Trip row (list view) ────────────────────────────────────────────────────
function TripRow({ trip, visits, role, onClick }) {
  const [hovered, setHovered] = useState(false);
  const hue     = strHue(trip.id);
  const isPast  = isTripInPast(visits);
  const dateStr = formatTripRange(visits, '—');

  return (
    <button
      onClick={onClick}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      style={{
        display: 'grid',
        gridTemplateColumns: '44px 1fr auto auto 28px',
        alignItems: 'center', gap: 14,
        padding: '12px 16px',
        background: 'var(--surface)',
        border: `1px solid ${hovered ? '#dbe1ec' : 'var(--line)'}`,
        borderRadius: 12,
        cursor: 'pointer', textAlign: 'left',
        fontSize: 13.5, transition: 'border-color .12s',
      }}
    >
      <div style={{
        width: 44, height: 44, borderRadius: 10,
        background: `hsl(${hue}, 55%, ${document.documentElement.dataset.theme === 'dark' ? 32 : 60}%)`,
        position: 'relative', flexShrink: 0,
      }}>
        {role !== 'owner' && (
          <span style={{
            position: 'absolute', bottom: -3, right: -3,
            width: 20, height: 20, borderRadius: '50%',
            background: 'var(--surface)', border: '2px solid var(--surface)',
            display: 'grid', placeItems: 'center',
          }}>
            <Icon name="users" size={11} style={{ color: 'var(--brand)' }} />
          </span>
        )}
      </div>
      <div style={{ minWidth: 0 }}>
        <div style={{
          fontWeight: 600, color: 'var(--ink)', marginBottom: 2,
          overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
        }}>
          {trip.title}
        </div>
        <div style={{ color: 'var(--muted)', fontSize: 12 }}>{scopeLabel(visits)}</div>
      </div>
      <div style={{ color: 'var(--muted)', fontSize: 12.5, whiteSpace: 'nowrap', fontVariantNumeric: 'tabular-nums' }}>
        {dateStr}
      </div>
      <div>
        {role === 'owner' && (
          <span style={{ background: 'var(--brand-soft)', color: 'var(--brand)', fontSize: 11, fontWeight: 500, padding: '2px 8px', borderRadius: 6 }}>
            Владелец
          </span>
        )}
        {role === 'admin' && (
          <span style={{ background: 'var(--wash)', color: 'var(--muted)', border: '1px solid var(--line)', fontSize: 11, fontWeight: 500, padding: '2px 8px', borderRadius: 6 }}>
            Админ
          </span>
        )}
        {role === 'viewer' && (
          <span style={{ background: 'var(--wash)', color: 'var(--muted)', border: '1px solid var(--line)', fontSize: 11, fontWeight: 500, padding: '2px 8px', borderRadius: 6, display: 'inline-flex', alignItems: 'center', gap: 4 }}>
            <Icon name="eye" size={11} /> Зритель
          </span>
        )}
      </div>
      <Icon name="chev" size={14} style={{ color: 'var(--muted-2)' }} />
    </button>
  );
}

// ─── Empty state ─────────────────────────────────────────────────────────────
function EmptyCollection({ onManual, onAi }) {
  return (
    <div style={{ maxWidth: 640, margin: '60px auto', textAlign: 'center' }}>
      <div style={{
        width: 88, height: 88, margin: '0 auto 22px',
        borderRadius: 22,
        background: 'linear-gradient(135deg, var(--brand-soft), var(--ai-soft))',
        display: 'grid', placeItems: 'center',
      }}>
        <Icon name="globe" size={38} style={{ color: 'var(--brand)' }} />
      </div>
      <h1 style={{ marginBottom: 10, fontSize: 28 }}>Спланируй первый трип</h1>
      <p style={{ color: 'var(--muted)', fontSize: 15, marginBottom: 28, maxWidth: 440, margin: '0 auto 28px' }}>
        Triplanio собирает города, переезды, отели, активности и бюджет в одну картину.
      </p>
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12, maxWidth: 520, margin: '0 auto' }}>
        <button onClick={onManual} style={{
          padding: 20, background: 'var(--surface)', border: '1.5px solid var(--line)', borderRadius: 14,
          cursor: 'pointer', textAlign: 'left', transition: 'border-color .12s',
        }}
          onMouseEnter={e => e.currentTarget.style.borderColor = 'var(--brand-soft-12)'}
          onMouseLeave={e => e.currentTarget.style.borderColor = 'var(--line)'}
        >
          <div style={{ width: 40, height: 40, borderRadius: 10, background: 'var(--brand)', color: 'white', display: 'grid', placeItems: 'center', marginBottom: 12 }}>
            <Icon name="edit" size={18} />
          </div>
          <div style={{ fontWeight: 600, marginBottom: 4 }}>Собрать руками</div>
          <div style={{ color: 'var(--muted)', fontSize: 12.5, lineHeight: 1.5 }}>Выбрать города, даты, отели и активности вручную.</div>
        </button>
        <button onClick={onAi} style={{
          padding: 20,
          background: 'linear-gradient(135deg, var(--ai-soft) 0%, rgba(240,164,90,.05) 100%)',
          border: '1.5px solid var(--ai-soft-12)', borderRadius: 14,
          cursor: 'pointer', textAlign: 'left',
        }}>
          <div style={{ width: 40, height: 40, borderRadius: 10, background: 'linear-gradient(135deg, #6a3ee2, #c66ce2)', color: 'white', display: 'grid', placeItems: 'center', marginBottom: 12 }}>
            <Icon name="sparkles" size={18} />
          </div>
          <div style={{ fontWeight: 600, marginBottom: 4, color: 'var(--ai)' }}>
            Начать с ИИ
          </div>
          <div style={{ color: 'var(--muted)', fontSize: 12.5, lineHeight: 1.5 }}>Описать словами — получить черновик трипа.</div>
        </button>
      </div>
    </div>
  );
}

// ─── Skeleton ────────────────────────────────────────────────────────────────
function TripSkeleton({ viewMode }) {
  const count = 4;
  if (viewMode === 'list') {
    return (
      <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
        {Array.from({ length: count }).map((_, i) => (
          <div key={i} style={{ height: 68, borderRadius: 12, background: 'var(--wash)', animation: 'pulse 1.4s ease-in-out infinite' }} />
        ))}
      </div>
    );
  }
  return (
    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(280px, 1fr))', gap: 16 }}>
      {Array.from({ length: count }).map((_, i) => (
        <div key={i} style={{ borderRadius: 'var(--radius-card)', background: 'var(--wash)', height: 260, animation: 'pulse 1.4s ease-in-out infinite' }} />
      ))}
    </div>
  );
}

// ─── Main page ───────────────────────────────────────────────────────────────
export default function Trips() {
  const { user }  = useAuth();
  const nav       = useNavigate();
  const qc        = useQueryClient();

  const [viewMode,     setViewMode]     = useState(() => {
    try { return localStorage.getItem('trips:viewMode') === 'list' ? 'list' : 'grid'; } catch { return 'grid'; }
  });
  const [filterMode,   setFilterMode]   = useState('active');
  const [search,       setSearch]       = useState('');
  const [showNewModal, setShowNewModal] = useState(false);
  const [showCreate,   setShowCreate]   = useState(false);
  const [showLimit,    setShowLimit]    = useState(false);
  const [showUpgrade,  setShowUpgrade]  = useState(false);
  const [pendingPick,  setPendingPick]  = useState(null);

  React.useEffect(() => {
    try { localStorage.setItem('trips:viewMode', viewMode); } catch { /* ignore */ }
  }, [viewMode]);

  const isPro = ['pro_monthly', 'pro_yearly', 'pro_trip'].includes(user?.subscription_status);

  // ── Fetch trips ────────────────────────────────────────────────────────────
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

  const tripIds   = allTrips.map(t => t.id);
  const hasTrips  = tripIds.length > 0;

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

  // ── Partition ──────────────────────────────────────────────────────────────
  const matches = (tr) => {
    const q = search.trim().toLowerCase();
    return !q || tr.title?.toLowerCase().includes(q) || tr.description?.toLowerCase().includes(q);
  };

  const activeTrips = allTrips.filter(t => !isTripInPast(visitsByTrip[t.id] || []) && matches(t));
  const pastTrips   = allTrips.filter(t =>  isTripInPast(visitsByTrip[t.id] || []) && matches(t));
  const shown       = filterMode === 'active' ? activeTrips : pastTrips;

  const getRoleFor = (trip) => {
    if (trip.created_by === user?.email) return 'owner';
    const m = myMemberships.find(m => m.trip_id === trip.id);
    return m?.role || 'member';
  };

  // ── Create flow ────────────────────────────────────────────────────────────
  const checkLimit = (pick) => {
    if (!isPro && activeTrips.length >= 1) {
      setPendingPick(pick); setShowLimit(true);
    } else {
      if (pick === 'ai') nav('/plan-trip-ai');
      else { setShowCreate(true); }
    }
  };

  const handleProceed = () => {
    setShowLimit(false);
    if (pendingPick === 'ai') nav('/plan-trip-ai');
    else setShowCreate(true);
    setPendingPick(null);
  };

  const isLoadingData = isLoading || (hasTrips && loadingVisits);

  // ── Render ─────────────────────────────────────────────────────────────────
  return (
    <div style={{ display: 'flex', flexDirection: 'column', minHeight: '100vh', background: 'var(--bg, var(--wash))' }}>
      {/* ── APP HEADER ── */}
      <header className="app-header" style={{ position: 'sticky', top: 0, zIndex: 50 }}>
        <div className="app-header__brand" onClick={() => nav('/trips')}>
          <span className="app-header__brand-name">Triplanio</span>
        </div>
        <div className="app-header__right">
          <UserMenu user={user} />
        </div>
      </header>

      {/* ── PAGE CONTENT ── */}
      <main style={{ flex: 1, padding: '32px 28px', maxWidth: 1240, margin: '0 auto', width: '100%', boxSizing: 'border-box' }}>

        {/* Empty collection */}
        {!isLoadingData && allTrips.length === 0 && (
          <EmptyCollection
            onManual={() => checkLimit('manual')}
            onAi={() => checkLimit('ai')}
          />
        )}

        {/* Normal view */}
        {(isLoadingData || allTrips.length > 0) && (
          <>
            {/* Header row */}
            <div style={{ display: 'flex', alignItems: 'flex-start', gap: 16, marginBottom: 24, flexWrap: 'wrap' }}>
              <div style={{ flex: 1, minWidth: 200 }}>
                <h1 style={{ marginBottom: 6 }}>Твои трипы</h1>
                <div style={{ color: 'var(--muted)', fontSize: 15 }}>
                  {activeTrips.length} активных · {pastTrips.length} в архиве
                </div>
              </div>
              <button
                onClick={() => setShowNewModal(true)}
                style={{
                  display: 'flex', alignItems: 'center', gap: 7,
                  padding: '11px 18px', borderRadius: 12, border: 'none',
                  background: 'var(--brand)', color: 'white',
                  fontWeight: 600, fontSize: 14.5, cursor: 'pointer',
                  transition: 'background .12s, transform .12s',
                }}
                onMouseEnter={e => { e.currentTarget.style.background = 'var(--brand-600)'; e.currentTarget.style.transform = 'translateY(-1px)'; }}
                onMouseLeave={e => { e.currentTarget.style.background = 'var(--brand)'; e.currentTarget.style.transform = ''; }}
              >
                <Icon name="plus" size={17} /> Новый трип
              </button>
            </div>

            {/* Filters row */}
            <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 20, flexWrap: 'wrap' }}>
              {/* Active / Past tabs */}
              <div className="tweaks__seg" style={{ flexShrink: 0 }}>
                <button className={filterMode === 'active' ? 'active' : ''} onClick={() => setFilterMode('active')}>
                  Активные · {activeTrips.length}
                </button>
                <button className={filterMode === 'past' ? 'active' : ''} onClick={() => setFilterMode('past')}>
                  Прошедшие · {pastTrips.length}
                </button>
              </div>

              {/* Search */}
              <div style={{ position: 'relative', flex: 1, minWidth: 200, maxWidth: 360 }}>
                <Icon name="search" size={15} style={{ position: 'absolute', left: 11, top: '50%', transform: 'translateY(-50%)', color: 'var(--muted-2)' }} />
                <input
                  className="input"
                  placeholder="Поиск по названию, городу"
                  value={search}
                  onChange={e => setSearch(e.target.value)}
                  style={{ paddingLeft: 34 }}
                />
              </div>

              <div style={{ flex: 1 }} />

              {/* Grid / List toggle */}
              <div className="tweaks__seg" title="Вид">
                <button className={viewMode === 'grid' ? 'active' : ''} onClick={() => setViewMode('grid')}>
                  <Icon name="grid" size={13} />
                </button>
                <button className={viewMode === 'list' ? 'active' : ''} onClick={() => setViewMode('list')}>
                  <Icon name="list" size={13} />
                </button>
              </div>
            </div>

            {/* Trip list / skeleton */}
            {isLoadingData ? (
              <TripSkeleton viewMode={viewMode} />
            ) : shown.length === 0 ? (
              <div style={{
                textAlign: 'center', padding: '40px 20px',
                background: 'var(--surface)', borderRadius: 'var(--radius-card)',
                border: '1.5px dashed var(--line)',
                color: 'var(--muted)',
              }}>
                {filterMode === 'past' ? 'В архиве пока ничего нет.' : 'По этому запросу ничего не нашлось.'}
              </div>
            ) : viewMode === 'grid' ? (
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(280px, 1fr))', gap: 16 }}>
                {shown.map(trip => (
                  <TripCard
                    key={trip.id}
                    trip={trip}
                    visits={visitsByTrip[trip.id] || []}
                    role={getRoleFor(trip)}
                    onClick={() => nav(`/trip/${trip.id}`)}
                  />
                ))}
                {filterMode === 'active' && (
                  <button
                    onClick={() => setShowNewModal(true)}
                    style={{
                      border: '1.5px dashed var(--line)', background: 'transparent',
                      borderRadius: 'var(--radius-card)', padding: 24,
                      display: 'flex', flexDirection: 'column', justifyContent: 'center', alignItems: 'center', gap: 10,
                      cursor: 'pointer', color: 'var(--muted)', minHeight: 240,
                      transition: 'border-color .12s, color .12s',
                    }}
                    onMouseEnter={e => { e.currentTarget.style.borderColor = 'var(--brand)'; e.currentTarget.style.color = 'var(--brand)'; }}
                    onMouseLeave={e => { e.currentTarget.style.borderColor = 'var(--line)'; e.currentTarget.style.color = 'var(--muted)'; }}
                  >
                    <Icon name="plus" size={22} />
                    <div style={{ fontWeight: 500 }}>Добавить трип</div>
                    <div style={{ fontSize: 12, textAlign: 'center', maxWidth: 180 }}>
                      Собрать руками или начать с ИИ
                    </div>
                  </button>
                )}
              </div>
            ) : (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                {shown.map(trip => (
                  <TripRow
                    key={trip.id}
                    trip={trip}
                    visits={visitsByTrip[trip.id] || []}
                    role={getRoleFor(trip)}
                    onClick={() => nav(`/trip/${trip.id}`)}
                  />
                ))}
              </div>
            )}

            {/* Free-limit banner */}
            {!isPro && filterMode === 'active' && activeTrips.length >= 1 && (
              <div style={{
                marginTop: 36, padding: '18px 22px',
                background: 'linear-gradient(135deg, var(--ai-soft) 0%, rgba(240,164,90,.06) 100%)',
                border: '1px solid var(--ai-soft-12)',
                borderRadius: 'var(--radius-card)',
                display: 'flex', alignItems: 'center', gap: 16, flexWrap: 'wrap',
              }}>
                <div style={{ width: 40, height: 40, borderRadius: 10, background: 'linear-gradient(135deg, #6a3ee2, #c66ce2)', color: 'white', display: 'grid', placeItems: 'center' }}>
                  <Icon name="sparkles" size={18} />
                </div>
                <div style={{ flex: 1, minWidth: 200 }}>
                  <div style={{ fontWeight: 600, marginBottom: 2 }}>На Free доступен 1 активный трип</div>
                  <div style={{ color: 'var(--muted)', fontSize: 12.5 }}>
                    Pro — безлимит трипов, ИИ-планировщик и парсинг бронирований.
                  </div>
                </div>
                <button
                  onClick={() => setShowUpgrade(true)}
                  style={{
                    padding: '10px 18px', borderRadius: 10, border: 'none',
                    background: 'var(--brand)', color: 'white',
                    fontWeight: 600, fontSize: 14, cursor: 'pointer',
                  }}
                >
                  Перейти к Pro
                </button>
              </div>
            )}
          </>
        )}
      </main>

      {/* ── Dialogs ── */}
      <NewTripModal
        open={showNewModal}
        onOpenChange={setShowNewModal}
        onManualPick={() => { setShowNewModal(false); checkLimit('manual'); }}
        onAiPick={() => { setShowNewModal(false); checkLimit('ai'); }}
      />
      <TripFormDialog open={showCreate} onOpenChange={setShowCreate} />
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
