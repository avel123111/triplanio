import React, { useState, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import { supabase } from '@/api/supabaseClient';
import { useQuery } from '@tanstack/react-query';
import { useAuth } from '@/lib/AuthContext';
import { isTripInPast, formatTripRange } from '@/lib/trip-dates';
import { isProActive } from '@/lib/subscription';
import { useTheme } from '@/lib/ThemeContext';
import { useI18n } from '@/lib/i18n/I18nContext';
import { Icon } from '../design/icons';
import { Avatar, Badge, Btn, Dialog, EmptyState, Skeleton } from '../design/index';
import { getGradientById } from '@/lib/trip-gradients';
import { transitVisits } from '@/lib/trip-cities';
import '../design/app.css';

import TripLimitDialog from '@/components/subscriptions/TripLimitDialog';
import AppHeader from '@/components/AppHeader';

// ─── helpers ────────────────────────────────────────────────────────────────
function strHue(str = '') {
  let h = 0;
  for (let i = 0; i < str.length; i++) h = (h * 31 + str.charCodeAt(i)) | 0;
  return Math.abs(h) % 360;
}

function scopeLabel(t, visits = []) {
  // Only transit destinations (no start/finish anchors, no waypoints), deduped
  // by name — same scope rule as the headline city count.
  const cities = [...new Set(transitVisits(visits).map(v => v.city_name).filter(Boolean))];
  if (cities.length === 0) return t('trips.no_cities');
  if (cities.length <= 3) return cities.join(' · ');
  return cities.slice(0, 2).join(' · ') + ' ' + t('trips.cities_more', { count: cities.length - 2 });
}

/**
 * Shape raw Supabase trip + visits into the object the card components expect.
 *
 * participants = rows from get_trip_participant_profiles RPC:
 *   { user_id, full_name, email, avatar_url, role, is_owner }
 *   Owner is always first (ensured by participantsByTrip grouping).
 *
 * "Shared" = trip has ≥2 participants (owner + at least 1 accepted member).
 */
function normalizeTrip(t, trip, visits = [], role = 'member', isPro = false, participants = []) {
  return {
    ...trip,
    coverHue:  strHue(trip.id),
    accentHue: strHue(trip.title || ''),
    days:      formatTripRange(visits, '-'),
    scope:     scopeLabel(t, visits),
    role,
    pro:       !!trip.is_pro_trip,
    userIsPro: isPro,
    status:    isTripInPast(visits) ? 'past' : 'active',
    isShared:  participants.length >= 2,
    members:   participants,
  };
}

// ─── Cover background helper ────────────────────────────────────────────────
function coverBg(trip) {
  const gradient = trip.cover_gradient ? getGradientById(trip.cover_gradient) : null;
  if (trip.cover_image_url) return null; // photo rendered separately
  if (gradient) return gradient.css;
  // Procedural fallback based on trip id / title hue
  const hue    = trip.coverHue ?? 210;
  const accent = trip.accentHue ?? 18;
  const isDark = document.documentElement.dataset.theme === 'dark';
  return `linear-gradient(to bottom left,
    hsl(${hue}, 60%, ${isDark ? 30 : 68}%) 0%,
    hsl(${(hue + accent) % 360}, 55%, ${isDark ? 22 : 58}%) 60%,
    hsl(${accent}, 70%, ${isDark ? 32 : 62}%) 100%)`;
}

// ─── Avatar stack — uses the same Avatar component as MembersLens/OverviewLens
const AvatarStack = ({ members, maxShow = 3, white = false }) => {
  if (!members || members.length === 0) return null;
  const shown    = members.slice(0, maxShow);
  const overflow = members.length - maxShow;
  return (
    <div className={`av-stack${white ? ' av-stack--white' : ''}`}>
      {shown.map((m, i) => (
        <Avatar
          key={m.user_id ?? i}
          name={m.full_name || m.email || '?'}
          photo={m.avatar_url || ''}
          size="sm"
        />
      ))}
      {overflow > 0 && (
        <Avatar name={`+${overflow}`} size="sm" style={{ background: 'var(--surface-2)', color: 'var(--muted)' }} />
      )}
    </div>
  );
};

// ─── Role label ─────────────────────────────────────────────────────────────
function roleLabel(t, role) {
  if (role === 'owner')  return t('trips.role_owner');
  if (role === 'admin')  return t('trips.role_admin');
  if (role === 'viewer') return t('trips.role_viewer');
  return t('trips.role_admin'); // safe fallback — 'member' role doesn't exist in schema
}

// ─── SVG icons (inline, matches design spec) ────────────────────────────────
const IconPin   = () => <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M12 21s-7-5.7-7-11a7 7 0 0114 0c0 5.3-7 11-7 11z"/><circle cx="12" cy="10" r="2.5"/></svg>;
const IconUsers = () => <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2"><circle cx="9" cy="8" r="3"/><path d="M3 20a6 6 0 0112 0M16 6a3 3 0 010 6M21 20a6 6 0 00-4-5.6"/></svg>;
const IconChev  = () => <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><path d="M9 6l6 6-6 6"/></svg>;
const IconCrown = () => <svg viewBox="0 0 24 24" fill="currentColor"><path d="M12 3l1.9 4.6L18.5 9.5 13.9 11.4 12 16l-1.9-4.6L5.5 9.5l4.6-1.9z"/></svg>;
const IconGlobe = () => <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8"><circle cx="12" cy="12" r="9"/><path d="M12 3c-2 3-3 5.5-3 9s1 6 3 9M12 3c2 3 3 5.5 3 9s-1 6-3 9M3 12h18"/></svg>;

// ─── Trip card (grid / poster view) ─────────────────────────────────────────
const TripCard = ({ trip, onClick }) => {
  const { t } = useI18n();
  const bg = coverBg(trip);

  return (
    <button className={`tc${trip.status === 'past' ? ' tc--past' : ''}`} onClick={onClick}>
      {/* background */}
      <div className="tc__bg" style={{ background: bg || undefined }}>
        {trip.cover_image_url && (
          <img className="tc__img" src={trip.cover_image_url} alt="" />
        )}
      </div>

      {/* decorative blobs (only on gradient covers, looks odd on photos) */}
      {!trip.cover_image_url && (
        <>
          <div className="tc__blob tc__b1" />
          <div className="tc__blob tc__b2" />
        </>
      )}

      {/* scrim */}
      <div className="tc__scrim" />

      {/* content */}
      <div className="tc__in">
        {/* top-right badges */}
        <div className="tc__tags">
          {trip.pro && (
            <span className="badge badge--pro">
              <IconCrown /> Pro
            </span>
          )}
        </div>

        <div className="tc__spacer" />

        {/* trip info */}
        <div className="tc__title">{trip.title}</div>
        <div className="tc__dates tab">{trip.days}</div>
        <div className="tc__scope">
          <IconPin />
          <span>{trip.scope}</span>
        </div>

        {/* shared footer: совместный chip + role + avatars */}
        {trip.isShared && (
          <div className="tc__foot">
            <span className="tc__glass">
              <IconUsers /> {t('trips.shared_badge')}
            </span>
            <span className="tc__glass">
              {roleLabel(t, trip.role)}
            </span>
            <AvatarStack members={trip.members} maxShow={3} white />
          </div>
        )}
      </div>
    </button>
  );
};

// ─── Trip row (list view) ────────────────────────────────────────────────────
const TripRow = ({ trip, onClick }) => {
  const { t } = useI18n();
  const bg = coverBg(trip);

  return (
    <button
      onClick={onClick}
      className={`tr${trip.status === 'past' ? ' tr--past' : ''}`}
    >
      {/* thumbnail */}
      <div className="tr__thumb" style={{ background: bg || undefined }}>
        {trip.cover_image_url && (
          <img src={trip.cover_image_url} alt="" style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', objectFit: 'cover' }} />
        )}
        <div className="tc__blob" style={{ width: 54, height: 54, top: -18, right: -14 }} />
        {trip.isShared && (
          <span className="tr__shared"><IconUsers /></span>
        )}
      </div>

      {/* main */}
      <div className="tr__main">
        <div className="tr__title">{trip.title}</div>
        <div className="tr__sub">
          <IconPin />
          <span>{trip.scope}</span>
        </div>
      </div>

      {/* meta */}
      <div className="tr__meta">
        <span className="tr__date tab tr-hideS">{trip.days}</span>
        {trip.isShared && (
          <div className="tr-hideS">
            <AvatarStack members={trip.members} maxShow={2} />
          </div>
        )}
        {trip.isShared && (
          <span className="tr-hideS">
            {trip.role === 'viewer'
              ? <Badge variant="quiet" icon="eye">{t('trips.role_viewer')}</Badge>
              : trip.role === 'owner'
                ? <Badge>{t('trips.role_owner')}</Badge>
                : <Badge>{roleLabel(t, trip.role)}</Badge>
            }
          </span>
        )}
        {trip.pro && (
          <span className="tr-hideS">
            <Badge variant="pro" icon="pro">Pro</Badge>
          </span>
        )}
        <span className="tr__chev"><IconChev /></span>
      </div>
    </button>
  );
};

// ─── New Trip Dialog ─────────────────────────────────────────────────────────
function NewTripDialog({ onClose, onManual, onAi }) {
  const { t } = useI18n();
  return (
    <Dialog
      title={t('trips.new')}
      icon="plus"
      size="sm"
      open={true}
      onOpenChange={(o) => { if (!o) onClose(); }}
      foot={<>
        <div style={{ flex: 1 }} />
        <Btn variant="ghost" onClick={onClose}>{t('common.cancel')}</Btn>
      </>}
    >
      <div style={{ color: 'var(--muted)', fontSize: 'var(--fs-base)', marginBottom: 18 }}>
        {t('trips.choice_subtitle')}
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
        <button
          onClick={onManual}
          style={{ padding: 18, background: 'var(--surface)', border: '1.5px solid var(--line)', borderRadius: 14, cursor: 'pointer', textAlign: 'left', transition: 'border-color .15s' }}
          onMouseEnter={e => e.currentTarget.style.borderColor = 'var(--brand)'}
          onMouseLeave={e => e.currentTarget.style.borderColor = 'var(--line)'}
        >
          <div style={{ width: 40, height: 40, borderRadius: 10, background: 'var(--brand)', color: 'white', display: 'grid', placeItems: 'center', marginBottom: 12 }}>
            <Icon name="edit" size={19} />
          </div>
          <div style={{ fontWeight: 600, marginBottom: 4 }}>{t('trips.start_manual')}</div>
          <div style={{ color: 'var(--muted)', fontSize: 'var(--fs-meta)', lineHeight: 1.5 }}>{t('trips.manual_desc_short')}</div>
        </button>
        <button
          onClick={onAi}
          className="ai-card"
          style={{ padding: 18, background: 'linear-gradient(135deg, var(--ai-soft) 0%, rgba(240,164,90,.05) 100%)', border: '1.5px solid var(--ai-soft-12)', borderRadius: 14, cursor: 'pointer', textAlign: 'left' }}
        >
          <div style={{ width: 40, height: 40, borderRadius: 10, background: 'var(--ai-grad)', color: 'white', display: 'grid', placeItems: 'center', marginBottom: 12 }}>
            <Icon name="sparkles" size={19} />
          </div>
          <div style={{ fontWeight: 600, marginBottom: 4, color: 'var(--ai)' }}>{t('trips.start_with_ai')}</div>
          <div style={{ color: 'var(--muted)', fontSize: 'var(--fs-meta)', lineHeight: 1.5 }}>{t('trips.ai_desc_short')}</div>
        </button>
      </div>
    </Dialog>
  );
}

// ─── Empty state ─────────────────────────────────────────────────────────────
function CollectionEmpty({ onManual, onAi }) {
  const { t } = useI18n();
  return (
    <div style={{ maxWidth: 720, margin: '60px auto', textAlign: 'center' }}>
      <div style={{ width: 96, height: 96, margin: '0 auto 22px', borderRadius: 24, background: 'linear-gradient(135deg, var(--brand-soft), var(--ai-soft))', display: 'grid', placeItems: 'center' }}>
        <span style={{ color: 'var(--brand)', display: 'contents' }}><IconGlobe /></span>
      </div>
      <h1 style={{ marginBottom: 10 }}>{t('trips.empty_heading')}</h1>
      <div className="muted" style={{ fontSize: 'var(--fs-h4)', marginBottom: 28, maxWidth: 480, margin: '0 auto 28px' }}>
        {t('trips.empty_desc')}
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 14, maxWidth: 600, margin: '0 auto' }}>
        <button onClick={onManual} style={{ padding: 22, background: 'var(--surface)', border: '1.5px solid var(--brand-soft-12)', borderRadius: 14, cursor: 'pointer', textAlign: 'left' }}>
          <div style={{ width: 40, height: 40, borderRadius: 10, background: 'var(--brand)', color: 'white', display: 'grid', placeItems: 'center', marginBottom: 14 }}>
            <Icon name="edit" size={19} />
          </div>
          <div style={{ fontWeight: 600, marginBottom: 4 }}>{t('trips.start_manual')}</div>
          <div className="muted" style={{ fontSize: 'var(--fs-meta)', lineHeight: 1.5 }}>{t('trips.manual_desc_full')}</div>
        </button>
        <button onClick={onAi} className="ai-card" style={{ padding: 22, background: 'linear-gradient(135deg, var(--ai-soft) 0%, rgba(240,164,90,.05) 100%)', border: '1.5px solid var(--ai-soft-12)', borderRadius: 14, cursor: 'pointer', textAlign: 'left' }}>
          <div style={{ width: 40, height: 40, borderRadius: 10, background: 'var(--ai-grad)', color: 'white', display: 'grid', placeItems: 'center', marginBottom: 14 }}>
            <Icon name="sparkles" size={19} />
          </div>
          <div style={{ fontWeight: 600, marginBottom: 4 }} className="ai-text">{t('trips.start_with_ai')} <Badge variant="pro" icon="pro" style={{ marginLeft: 4 }}>Pro</Badge></div>
          <div className="muted" style={{ fontSize: 'var(--fs-meta)', lineHeight: 1.5 }}>{t('trips.ai_desc_full')}</div>
        </button>
      </div>
    </div>
  );
}

// ─── Skeleton ─────────────────────────────────────────────────────────────────
function TripsHeaderSkeleton() {
  return (
    <>
      <div style={{ display: 'flex', alignItems: 'flex-start', gap: 16, marginBottom: 24, flexWrap: 'wrap' }}>
        <div style={{ flex: 1, minWidth: 200 }}>
          <Skeleton w={170} h={28} r={8} style={{ marginBottom: 8 }} />
          <Skeleton w={220} h={15} r={6} />
        </div>
        <Skeleton w={150} h={44} r={10} />
      </div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 20, flexWrap: 'wrap' }}>
        <Skeleton w={240} h={36} r={10} />
        <div style={{ flex: 1 }} />
        <Skeleton w={72} h={36} r={10} />
      </div>
    </>
  );
}

function TripSkeleton({ viewMode }) {
  if (viewMode === 'list') {
    return (
      <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
        {Array.from({ length: 5 }).map((_, i) => (
          <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 14, padding: '12px 16px', background: 'var(--surface)', border: '1px solid var(--line)', borderRadius: 'var(--r-md)' }}>
            <Skeleton w={62} h={46} r={12} />
            <div style={{ flex: 1 }}>
              <Skeleton w="55%" h={14} r={5} style={{ marginBottom: 6 }} />
              <Skeleton w="32%" h={11} r={4} />
            </div>
            <Skeleton w={80} h={12} r={5} />
          </div>
        ))}
      </div>
    );
  }
  return (
    <div className="tc-grid">
      {Array.from({ length: 6 }).map((_, i) => (
        <div key={i} style={{ borderRadius: 'var(--r-card)', overflow: 'hidden', minHeight: 256 }}>
          <Skeleton w="100%" h={256} r={0} />
        </div>
      ))}
    </div>
  );
}

// ─── Main page ────────────────────────────────────────────────────────────────
export default function Trips() {
  const { t }     = useI18n();
  const { user }  = useAuth();
  const nav       = useNavigate();

  const { isDark, toggle: toggleTheme } = useTheme();

  const [viewMode,    setViewMode]    = useState(() => {
    try { return localStorage.getItem('trips:viewMode') === 'list' ? 'list' : 'grid'; } catch { return 'grid'; }
  });
  const [filterMode,  setFilterMode]  = useState('active');
  const [search,      setSearch]      = useState('');
  const [showNewTrip, setShowNewTrip] = useState(false);
  const [showLimit,   setShowLimit]   = useState(false);
  const openUpgrade = () => nav('/pro?hidePerTrip=1');
  const [pendingPick, setPendingPick] = useState(null);

  React.useEffect(() => {
    try { localStorage.setItem('trips:viewMode', viewMode); } catch { /* ignore */ }
  }, [viewMode]);

  const isPro = isProActive(user);

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

  const tripIds  = allTrips.map(tr => tr.id);
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

  // ── Single RPC: all participants (owner + active members) with avatar_url ──
  const { data: allParticipants = [] } = useQuery({
    queryKey: ['trip-participant-profiles', tripIds.join(',')],
    queryFn: async () => {
      const { data, error } = await supabase.rpc('get_trip_participant_profiles', {
        trip_id_list: tripIds,
      });
      if (error) throw error;
      return data || [];
    },
    enabled: hasTrips,
    staleTime: 30_000,
  });

  // Group participants by trip_id, owner always first
  const participantsByTrip = useMemo(() => {
    const m = {};
    allParticipants.forEach(p => {
      if (!m[p.trip_id]) m[p.trip_id] = [];
      if (p.is_owner) m[p.trip_id].unshift(p);
      else m[p.trip_id].push(p);
    });
    return m;
  }, [allParticipants]);

  const visitsByTrip = useMemo(() => {
    const m = {};
    allVisits.forEach(v => { (m[v.trip_id] ||= []).push(v); });
    return m;
  }, [allVisits]);

  // Derive current user's role from the participant profiles RPC result
  const getRoleFor = (trip) => {
    const parts = participantsByTrip[trip.id] || [];
    const me = parts.find(p => p.user_id === user?.id);
    if (!me) return trip.created_by === user?.id ? 'owner' : 'member';
    return me.is_owner ? 'owner' : (me.role || 'member');
  };

  // ── Partition ────────────────────────────────────────────────────────────────
  const matches = (tr) => {
    const q = search.trim().toLowerCase();
    return !q || tr.title?.toLowerCase().includes(q) || tr.description?.toLowerCase().includes(q);
  };

  const activeTrips = allTrips.filter(tr => !isTripInPast(visitsByTrip[tr.id] || []) && matches(tr));
  const pastTrips   = allTrips.filter(tr =>  isTripInPast(visitsByTrip[tr.id] || []) && matches(tr));
  const shown       = filterMode === 'active' ? activeTrips : pastTrips;

  // Free-limit is owner-scoped: only trips the user owns count toward the 1-trip cap.
  // Invited trips (admin/viewer) are excluded — matches backend getActiveTrips (created_by).
  const ownedActiveTrips = activeTrips.filter(tr => getRoleFor(tr) === 'owner');

  const shownNorm = shown.map(tr =>
    normalizeTrip(t, tr, visitsByTrip[tr.id] || [], getRoleFor(tr), isPro, participantsByTrip[tr.id] || [])
  );

  // ── Create flow ───────────────────────────────────────────────────────────────
  const checkLimit = (pick) => {
    if (!isPro && ownedActiveTrips.length >= 1) {
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
      <AppHeader user={user} isPro={isPro} isDark={isDark} onToggleTheme={toggleTheme} />

      {/* PAGE CONTENT */}
      <main style={{ flex: 1, padding: '32px 28px', maxWidth: 1240, margin: '0 auto', width: '100%', boxSizing: 'border-box' }}>

        {/* Loading skeleton */}
        {isLoadingData && allTrips.length === 0 && (
          <>
            <TripsHeaderSkeleton />
            <TripSkeleton viewMode={viewMode} />
          </>
        )}

        {/* Empty collection */}
        {!isLoadingData && allTrips.length === 0 && (
          <CollectionEmpty onManual={() => checkLimit('manual')} onAi={() => checkLimit('ai')} />
        )}

        {/* Normal view */}
        {allTrips.length > 0 && (
          <>
            {/* Header row */}
            <div style={{ display: 'flex', alignItems: 'flex-start', gap: 16, marginBottom: 24, flexWrap: 'wrap' }}>
              <div style={{ flex: 1, minWidth: 200 }}>
                <h1 style={{ marginBottom: 6 }}>{t('trips.page_title')}</h1>
                <div className="muted" style={{ fontSize: 'var(--fs-strong)' }}>
                  {t('trips.count_summary', { active: activeTrips.length, past: pastTrips.length })}
                </div>
              </div>
              <Btn variant="primary" size="lg" icon="plus" onClick={() => setShowNewTrip(true)}>{t('trips.new')}</Btn>
            </div>

            {/* Filters row */}
            <div style={{ display: 'flex', alignItems: 'center', gap: 14, marginBottom: 18, flexWrap: 'wrap' }}>
              <div className="seg" role="group" aria-label={t('trips.tab_active')}>
                <button aria-pressed={filterMode === 'active'} onClick={() => setFilterMode('active')}>
                  {t('trips.tab_active')} · <span className="num">{activeTrips.length}</span>
                </button>
                <button aria-pressed={filterMode === 'past'} onClick={() => setFilterMode('past')}>
                  {t('trips.tab_past')} · <span className="num">{pastTrips.length}</span>
                </button>
              </div>
              <div style={{ position: 'relative', flex: 1, minWidth: 180, maxWidth: 340 }}>
                <Icon name="search" size={15} style={{ position: 'absolute', left: 11, top: '50%', transform: 'translateY(-50%)', color: 'var(--muted-2)' }} />
                <input className="input" placeholder={t('trips.search_placeholder')} value={search} onChange={e => setSearch(e.target.value)} style={{ paddingLeft: 34 }} />
              </div>
              <div style={{ flex: 1 }} />
              <div className="seg" role="group" title={t('trips.view')}>
                <button aria-pressed={viewMode === 'grid'} onClick={() => setViewMode('grid')}><Icon name="grid" size={13} /></button>
                <button aria-pressed={viewMode === 'list'} onClick={() => setViewMode('list')}><Icon name="list" size={13} /></button>
              </div>
            </div>

            {/* Trip list */}
            {isLoadingData ? (
              <TripSkeleton viewMode={viewMode} />
            ) : shownNorm.length === 0 ? (
              <EmptyState
                icon={filterMode === 'past' ? 'calendar' : 'search'}
                title={filterMode === 'past' ? t('trips.empty_archive_title') : t('trips.empty_search_title')}
                body={filterMode === 'past' ? t('trips.empty_archive_body') : t('trips.empty_search_body')}
              />
            ) : viewMode === 'grid' ? (
              <div className="tc-grid">
                {shownNorm.map(tr => (
                  <TripCard key={tr.id} trip={tr} onClick={() => nav(`/trip/${tr.id}`)} />
                ))}
                {filterMode === 'active' && (
                  <button className="tc-add" onClick={() => setShowNewTrip(true)}>
                    <div className="tc-add__ic">
                      <Icon name="plus" size={24} />
                    </div>
                    <b>{t('trips.add_trip')}</b>
                    <small>{t('trips.add_trip_sub')}</small>
                  </button>
                )}
              </div>
            ) : (
              <div className="tr-list">
                {shownNorm.map(tr => (
                  <TripRow key={tr.id} trip={tr} onClick={() => nav(`/trip/${tr.id}`)} />
                ))}
              </div>
            )}

            {/* Free-limit banner — Pro style, not AI style */}
            {!isPro && filterMode === 'active' && (
              <div className="limitcard">
                <div className="limitcard__ic">
                  <Icon name="pro" size={22} />
                </div>
                <div className="limitcard__body">
                  <div className="limitcard__top">
                    <b>{t('trips.free_limit_title')}</b>
                    <span className="limitcard__count num">
                      {ownedActiveTrips.length} / 1
                    </span>
                  </div>
                  <div className="limitcard__sub">{t('trips.free_limit_desc')}</div>
                </div>
                <Btn variant="pro" icon="crown" onClick={openUpgrade}>{t('trips.go_pro')}</Btn>
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
        activeCount={ownedActiveTrips.length}
        isPro={isPro}
      />
    </div>
  );
}
