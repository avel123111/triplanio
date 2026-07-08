import React, { useState, useMemo, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { supabase } from '@/api/supabaseClient';
import { useQuery } from '@tanstack/react-query';
import { useAuth } from '@/lib/AuthContext';
import { isTripInPast, formatTripRange, computeTripRange } from '@/lib/trip-dates';
import { isProActive } from '@/lib/subscription';
import { displayName } from '@/lib/displayName';
import { useTheme } from '@/lib/ThemeContext';
import { useI18n } from '@/lib/i18n/I18nContext';
import { pluralize } from '@/lib/i18n/format';
import { Icon } from '../design/icons';
import { Avatar, Badge, Btn, EmptyState, Skeleton } from '../design/index';
import { coverGradientCss } from '@/lib/trip-gradients';
import { uniqueTransitCities, localizeVisits } from '@/lib/trip-cities';
import { homeStats, worldExplored } from '@/lib/travel-stats';
import { useQueryGate } from '@/lib/useQueryGate';
import { SystemStub } from '@/lib/PageNotFound';
import StatsMap from '@/components/views/StatsMap';
import {
  Greeting, StatBar, WorldMini, AllStatsCta,
} from '@/components/stats/widgets';
import '../design/app.css';

import { useCreateTrip, ChoiceCard } from '@/components/create/CreateTripProvider';
import { useActiveTripsLimit } from '@/hooks/useActiveTripsLimit';
import AppHeader from '@/components/AppHeader';

// ─── helpers ────────────────────────────────────────────────────────────────
function scopeLabel(t, visits = []) {
  // Same deduped transit set that backs the city COUNT (uniqueTransitCities) —
  // so the card's city list and every "N городов" number can never disagree.
  const cities = uniqueTransitCities(visits).map(v => v.city_name).filter(Boolean);
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
function normalizeTrip(t, trip, visits = [], role = 'member', isPro = false, participants = [], serverPro = undefined) {
  return {
    ...trip,
    days:      formatTripRange(visits, '-'),
    scope:     scopeLabel(t, visits),
    role,
    // Owner-aware Pro badge (TRIP-121). Effective Pro = is_pro_trip OR the trip
    // OWNER has an active subscription — true for EVERY trip the user sees, incl.
    // foreign trips made Pro by their owner's sub. The server computes it once in
    // get_user_travel_stats via the canonical is_trip_pro() predicate (the client
    // can't see a foreign owner's billing), exposed per trip as `serverPro`.
    // Fallback (older RPC build with no is_pro field): the client predicate —
    // own trips only (is_pro_trip OR I'm the owner with an active sub) — so a
    // stale deploy degrades gracefully instead of dropping all badges.
    pro:       typeof serverPro === 'boolean' ? serverPro : (!!trip.is_pro_trip || (role === 'owner' && isPro)),
    userIsPro: isPro,
    status:    isTripInPast(visits) ? 'past' : 'active',
    isShared:  participants.length >= 2,
    members:   participants,
  };
}

// ─── Cover background helper ────────────────────────────────────────────────
// Photo (when present) is rendered as a separate <img> overlay → return null so
// the cover element has no background behind it; otherwise the trip's gradient
// (always one of our built-in set, default-backed).
function coverBg(trip) {
  if (trip.cover_image_url) return null;
  return coverGradientCss(trip.cover_gradient);
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
          name={displayName(m.email, m.full_name)}
          photo={m.avatar_url || ''}
          deleted={m.is_deleted}
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

// ─── Next-trip rail card / empty states ────────────────────────────────────────
function NextTripCard({ trip, onClick, t }) {
  const bg = coverBg(trip);
  const cd = trip.countdown;
  return (
    <button type="button" className="nextcard" onClick={onClick}>
      <span className="nextcard__cover" style={{ background: bg || undefined }}>
        {trip.cover_image_url && <img src={trip.cover_image_url} alt="" style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', objectFit: 'cover' }} />}
      </span>
      <span className="nextcard__tx">
        <span className="t-mono" style={{ color: 'var(--muted-2)' }}>{t('stats.next_trip_title')}</span>
        <b>{trip.title}</b>
        <span className="rt">{trip.scope}</span>
        <span className="nextcard__tag"><Icon name="calendar" />{t('stats.next_start_in')}</span>
        <span className="nextcard__cd">
          <span className="cdu"><b>{cd.d}</b><span>{t('stats.cd_days')}</span></span>
          <span className="cdu"><b>{cd.h}</b><span>{t('stats.cd_hours')}</span></span>
          <span className="cdu"><b>{cd.m}</b><span>{t('stats.cd_min')}</span></span>
        </span>
      </span>
      <span className="nextcard__chev"><Icon name="chev" /></span>
    </button>
  );
}

function NoNextCard({ variant, onPlan, t }) {
  const isEmpty = variant === 'empty';
  return (
    <div className="nonext">
      <span className="ic"><Icon name="calendar" /></span>
      <div>
        <b>{t('stats.next_trip')}</b>
        <p>{isEmpty ? t('stats.next_empty_sub') : t('stats.no_planned_sub')}</p>
      </div>
      {!isEmpty && (
        <Btn variant="primary" size="sm" icon="plus" onClick={onPlan}>{t('stats.plan_trip')}</Btn>
      )}
    </div>
  );
}

// ─── Map hero + rail (shared by filled + empty screens) ────────────────────────
function StatHero({ points, home, world, showMap, scheme, nextTrip, onAllStats, onPlan, onOpenNext, t, ghost = false }) {
  const items = [
    { key: 'countries', value: home.countries, label: t('stats.sb_countries'), icon: <Icon name="globe" /> },
    { key: 'cities',    value: home.cities,    label: t('stats.sb_cities'),     tone: 'city',     icon: <Icon name="buildings" /> },
    { key: 'trips',     value: home.trips,     label: t('stats.sb_trips'),      tone: 'trip',     icon: <Icon name="suitcase" /> },
    { key: 'transfers', value: home.transfers, label: t('stats.sb_transfers'),  tone: 'transfer', icon: <Icon name="arrowSwap" /> },
  ];
  return (
    <>
      <div className="t-mono tp-caption" style={{ margin: '36px 0 12px' }}>{t('stats.trips_summary')}</div>
      <StatBar items={items} cta={<AllStatsCta label={t('stats.all_stats')} onClick={onAllStats} />} className={ghost ? 'is-ghost' : ''} />
      <div className={`dash-hero${ghost ? ' is-ghost' : ''}`}>
        <div className="mapwrap">
          {showMap
            ? <StatsMap points={points} colorScheme={scheme} pins={false} />
            : <div className="map-skel"><Icon name="globe" /><div>{t('stats.map_loading')}</div></div>}
        </div>
        <div className="rail">
          <WorldMini
            world={world}
            title={t('stats.world_explored')}
            subCaption={t('stats.world_countries_visited')}
          />
          {nextTrip
            ? <NextTripCard trip={nextTrip} onClick={onOpenNext} t={t} />
            : <NoNextCard variant={home.trips > 0 ? 'no-planned' : 'empty'} onPlan={onPlan} t={t} />}
        </div>
      </div>
    </>
  );
}

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
            <Badge variant="pro" icon="pro">PRO</Badge>
          )}
        </div>

        <div className="tc__spacer" />

        {/* trip info */}
        <div className="tc__title">{trip.title}</div>
        <div className="tc__dates tab">{trip.days}</div>
        <div className="tc__scope">
          <Icon name="pin" />
          <span>{trip.scope}</span>
        </div>

        {/* shared footer: совместный chip + role + avatars */}
        {trip.isShared && (
          <div className="tc__foot">
            <span className="tc__glass">
              <Icon name="users" /> {t('trips.shared_badge')}
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
          <span className="tr__shared"><Icon name="users" /></span>
        )}
      </div>

      {/* main */}
      <div className="tr__main">
        <div className="tr__title">{trip.title}</div>
        <div className="tr__sub">
          <Icon name="pin" />
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
            <Badge variant="pro" icon="pro">PRO</Badge>
          </span>
        )}
        <span className="tr__chev"><Icon name="chev" /></span>
      </div>
    </button>
  );
};

// ─── Empty collection · "Маршрут" — itinerary-rail hero + manual/AI choices ─────
// Decorative orbs are inline-styled (no shared `.blob` class in this stylesheet);
// the rail illustration + copy + choice pair sit above them (z-index 1).
const _ORB = { position: 'absolute', borderRadius: '50%', filter: 'blur(12px)', pointerEvents: 'none', zIndex: 0 };
function EmptyRoute({ onManual, onAi }) {
  const { t } = useI18n();
  return (
    <div className="eroute" style={{ marginTop: 28 }}>
      <span style={{ ..._ORB, width: 300, height: 300, background: 'var(--brand-grad)', top: -150, right: -60, opacity: 0.12 }} />
      <span style={{ ..._ORB, width: 170, height: 170, background: 'var(--ai-gradient)', top: -30, right: '26%', opacity: 0.10 }} />
      <div className="eroute__rail">
        <svg viewBox="0 0 560 64" preserveAspectRatio="xMidYMid meet" aria-hidden="true">
          <path className="rl" d="M30 36 H330" />
          <path className="rl-dash" d="M330 36 H512" />
          <circle className="rnode" cx="30" cy="36" r="7" /><circle className="rfill" cx="30" cy="36" r="2.6" />
          <circle className="rnode" cx="180" cy="36" r="7" /><circle className="rfill" cx="180" cy="36" r="2.6" />
          <circle className="rnode" cx="330" cy="36" r="7" /><circle className="rfill" cx="330" cy="36" r="2.6" />
          <path className="rplane" d="M249 30 l16 6 -16 6 4 -6 z" />
          <circle className="radd" cx="512" cy="36" r="10" /><path className="radd-plus" d="M512 31 v10 M507 36 h10" />
        </svg>
      </div>
      <h3>{t('trips.empty_heading')}</h3>
      <p>{t('trips.empty_route_sub')}</p>
      <div className="eroute__create">
        <ChoiceCard variant="man" icon="edit" title={t('trips.start_manual')} sub={t('trips.manual_desc_short')} onClick={onManual} />
        <ChoiceCard variant="ai" icon="sparkles" title={t('trips.start_with_ai')} sub={t('trips.ai_desc_short')} onClick={onAi} />
      </div>
    </div>
  );
}

// ─── Skeleton ─────────────────────────────────────────────────────────────────
// First-load skeleton — mirrors the new home layout: greeting hero, stat-bar,
// the map+rail dash-hero, then the trips section header + a card/list skeleton.
// Reuses the real .head / .dash-hero / .rail grids so columns line up.
function HomeSkeleton({ viewMode }) {
  return (
    <>
      <div className="head">
        <div className="head__row">
          <Skeleton w={60} h={60} r={16} />
          <div className="grow">
            <Skeleton w={220} h={32} r={8} style={{ marginBottom: 10 }} />
            <Skeleton w={260} h={15} r={6} />
          </div>
        </div>
      </div>
      <Skeleton w="100%" h={86} r={20} />
      <div className="dash-hero" style={{ marginTop: 18 }}>
        <Skeleton w="100%" h={340} r={24} />
        <div className="rail">
          <Skeleton w="100%" h={150} r={20} />
          <Skeleton w="100%" h={120} r={20} />
        </div>
      </div>
      <div style={{ display: 'flex', alignItems: 'flex-start', gap: 16, margin: '30px 0 16px', flexWrap: 'wrap' }}>
        <div style={{ flex: 1, minWidth: 200 }}>
          <Skeleton w={170} h={26} r={8} style={{ marginBottom: 8 }} />
          <Skeleton w={140} h={14} r={6} />
        </div>
        <Skeleton w={150} h={44} r={12} />
      </div>
      <TripSkeleton viewMode={viewMode} />
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
  const { t, lang } = useI18n();
  const { user }  = useAuth();
  const nav       = useNavigate();

  const { isDark, toggle: toggleTheme } = useTheme();

  const [viewMode,    setViewMode]    = useState(() => {
    try { return localStorage.getItem('trips:viewMode') === 'list' ? 'list' : 'grid'; } catch { return 'grid'; }
  });
  const [filterMode,  setFilterMode]  = useState('active');
  const [search,      setSearch]      = useState('');
  // Create-trip flow lives in the global CreateTripProvider so the same sheet is
  // reachable from every screen (and the bottom-nav "+"); no more ?new=1 routing.
  const { openChoice, startCreate } = useCreateTrip();
  // Lazy-mount the map hero after the first paint so the heavy Mapbox surface
  // doesn't block initial render of the content above the fold.
  const [showMap, setShowMap] = useState(false);
  useEffect(() => {
    const id = requestAnimationFrame(() => setShowMap(true));
    return () => cancelAnimationFrame(id);
  }, []);
  const openUpgrade = () => nav('/pro?hidePerTrip=1');

  React.useEffect(() => {
    try { localStorage.setItem('trips:viewMode', viewMode); } catch { /* ignore */ }
  }, [viewMode]);

  const isPro = isProActive(user);
  // Single source for the free-limit banner — same getActiveTrips → active_owned_trips() as the create/copy gate.
  const { isBlocked: limitReached } = useActiveTripsLimit(user?.id);
  const scheme = isDark ? 'DARK' : 'LIGHT';
  const greetName = displayName(user?.email, user?.full_name);

  // ── Fetch trips ─────────────────────────────────────────────────────────────
  const {
    data: allTrips = [], isLoading,
    error: tripsError, isPending: tripsPending, fetchStatus: tripsFetchStatus, refetch: refetchTrips,
  } = useQuery({
    queryKey: ['trips', user?.id],
    queryFn: async () => {
      // Select only the columns the cards / role / search / cover actually read —
      // not select('*'). Keeps the home payload lean; the per-trip visit rows and
      // covers come from the get_user_travel_stats RPC.
      const { data, error } = await supabase
        .from('trips')
        .select('id, title, description, cover_gradient, cover_image_url, created_by, is_pro_trip')
        .order('created_at', { ascending: false });
      if (error) throw error;
      return data || [];
    },
    enabled: !!user?.id,
  });

  const tripIds  = allTrips.map(tr => tr.id);
  const hasTrips = tripIds.length > 0;

  // ── Travel-stats RPC: one call powers the stat-bar, map fill/pins, "world
  // explored" AND the trip cards. `trip_visits` carries each trip's visit rows
  // (date range / past-active / city scope), so the home no longer needs a
  // separate `select * from city_visits` round-trip. Year filtering / aggregates
  // happen client-side (here it's unfiltered).
  const { data: travelStats } = useQuery({
    queryKey: ['travel-stats', user?.id],
    queryFn: async () => {
      const { data, error } = await supabase.rpc('get_user_travel_stats');
      if (error) throw error;
      return data || { points: [], trips: {}, transfers_total: 0, trip_visits: {} };
    },
    enabled: !!user?.id,
    staleTime: 30_000,
  });
  const statsLoaded    = travelStats !== undefined;
  const rpcTripVisits  = travelStats?.trip_visits || null; // null only on a pre-0044 RPC build
  const statsPoints    = useMemo(() => localizeVisits(travelStats?.points || [], lang), [travelStats, lang]);
  const transfersTotal = travelStats?.transfers_total || 0;
  const home  = useMemo(() => homeStats(statsPoints, transfersTotal), [statsPoints, transfersTotal]);
  const world = useMemo(() => worldExplored(statsPoints), [statsPoints]);

  // Backward-compatible fallback: only fetch city_visits separately when the RPC
  // build in this environment hasn't shipped `trip_visits` yet (pre-0044). Once
  // 0044 is deployed this query is permanently disabled — no extra round-trip.
  const { data: allVisits = [], isLoading: loadingVisits } = useQuery({
    queryKey: ['all-city-visits', tripIds.join(',')],
    queryFn: async () => {
      const { data, error } = await supabase.from('city_visits').select('*').in('trip_id', tripIds);
      if (error) throw error;
      return data || [];
    },
    enabled: hasTrips && statsLoaded && !rpcTripVisits,
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
      // Anonymized (soft-deleted) users: show a localized label instead of the
      // scrubbed empty name (also yields one uniform avatar gradient for all).
      const pp = p.is_deleted ? { ...p, full_name: t('common.deleted_user') } : p;
      if (!m[pp.trip_id]) m[pp.trip_id] = [];
      if (pp.is_owner) m[pp.trip_id].unshift(pp);
      else m[pp.trip_id].push(pp);
    });
    return m;
  }, [allParticipants, t]);

  // Cards read per-trip visits from the RPC's trip_visits when present, else from
  // the fallback query. Either way the shape is { trip_id: [visit rows] } and the
  // downstream helpers (isTripInPast / scopeLabel / computeTripRange) are unchanged.
  const visitsByTrip = useMemo(() => {
    const base = rpcTripVisits || allVisits.reduce((m, v) => { (m[v.trip_id] ||= []).push(v); return m; }, {});
    // Localize each trip's city names from the per-visit snapshot (TRIP-146).
    const out = {};
    for (const k in base) out[k] = localizeVisits(base[k], lang);
    return out;
  }, [rpcTripVisits, allVisits, lang]);

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

  // Trip date range comes from the same computeTripRange used everywhere else:
  // .start = earliest city start_date, .end = latest city end_date.
  const rangeOf = (tr) => computeTripRange(visitsByTrip[tr.id] || []);

  // Active → earliest start first (asc). Undated trips (no start; treated as
  // active) sink to the bottom, tie-broken by created_at desc (allTrips is
  // already created_at-desc, so a stable 0 keeps that order).
  const activeTrips = allTrips
    .filter(tr => !isTripInPast(visitsByTrip[tr.id] || []) && matches(tr))
    .sort((a, b) => {
      const sa = rangeOf(a).start, sb = rangeOf(b).start;
      if (!sa && !sb) return 0;
      if (!sa) return 1;
      if (!sb) return -1;
      return new Date(sa) - new Date(sb);
    });

  // Past → most recently finished first (end desc). Past trips always have an
  // end date (isTripInPast requires it), so no null guard is needed.
  const pastTrips = allTrips
    .filter(tr => isTripInPast(visitsByTrip[tr.id] || []) && matches(tr))
    .sort((a, b) => new Date(rangeOf(b).end) - new Date(rangeOf(a).end));

  const shown       = filterMode === 'active' ? activeTrips : pastTrips;

  const shownNorm = shown.map(tr =>
    normalizeTrip(t, tr, visitsByTrip[tr.id] || [], getRoleFor(tr), isPro, participantsByTrip[tr.id] || [], travelStats?.trips?.[tr.id]?.is_pro)
  );

  // ── Next upcoming trip (nearest future start) for the rail card ──────────────
  const nextTrip = useMemo(() => {
    const now = Date.now();
    let best = null;
    for (const tr of allTrips) {
      const visits = visitsByTrip[tr.id] || [];
      const { start } = computeTripRange(visits);
      if (!start) continue;
      const startMs = new Date(start).getTime();
      if (startMs <= now) continue;
      if (!best || startMs < best.startMs) best = { tr, visits, startMs };
    }
    if (!best) return null;
    const diff = best.startMs - now;
    return {
      ...best.tr,
      scope:     scopeLabel(t, best.visits),
      countdown: {
        d: Math.floor(diff / 864e5),
        h: Math.floor((diff % 864e5) / 36e5),
        m: Math.floor((diff % 36e5) / 6e4),
      },
    };
  }, [allTrips, visitsByTrip, t]);


  // Visits come from the RPC (ready once stats load) or the fallback query.
  const isLoadingData = isLoading || (hasTrips && !rpcTripVisits && (!statsLoaded || loadingVisits));
  // TRIP-188: склоняем каждое существительное отдельно (Intl.PluralRules) — «1 путешествие»,
  // «2 страны», «5 городов» вместо застывшего множественного числа.
  const subText = hasTrips
    ? [
        pluralize(t, home.trips,     'stats.sum_trips',     lang, { count: home.trips }),
        pluralize(t, home.countries, 'stats.sum_countries', lang, { count: home.countries }),
        pluralize(t, home.cities,    'stats.sum_cities',    lang, { count: home.cities }),
      ].join(' · ')
    : t('stats.home_sub_empty');

  // ── Load gate (TRIP-208) ──────────────────────────────────────────────────────
  // A failed PRIMARY trips load must surface an error + retry, not silently fall
  // through to the "no trips yet" empty state. Only the trips list gates the
  // screen; travel-stats/participants are enrichment and degrade silently. Cached
  // list wins (hasData) — a background refetch error never blanks a shown list.
  const tripsGate = useQueryGate(
    { isPending: tripsPending, fetchStatus: tripsFetchStatus, error: tripsError },
    allTrips.length > 0,
  );
  if (tripsGate === 'temporary' || tripsGate === 'access') {
    const isAccess = tripsGate === 'access';
    return (
      <div style={{ minHeight: '100vh' }}>
        <SystemStub
          icon={isAccess ? 'lock' : 'warning'}
          tone={isAccess ? 'warm' : 'warning'}
          title={t(isAccess ? 'sys.no_access_title' : 'sys.load_error_title')}
          body={t(isAccess ? 'sys.no_access_body' : 'sys.load_error_desc')}
          primary={{ label: t('sys.retry'), onClick: () => refetchTrips() }}
        />
      </div>
    );
  }

  // ── Render ────────────────────────────────────────────────────────────────────
  return (
    <div className={`app-shell${!isLoadingData && allTrips.length === 0 ? ' stats-ghost' : ''}`} style={{ display: 'flex', flexDirection: 'column', minHeight: '100vh', background: 'var(--bg, var(--wash))' }}>

      {/* APP HEADER */}
      <AppHeader user={user} isPro={isPro} isDark={isDark} onToggleTheme={toggleTheme} />

      {/* PAGE CONTENT */}
      <main style={{ flex: 1, padding: '32px 28px', maxWidth: 1240, margin: '0 auto', width: '100%', boxSizing: 'border-box' }}>

        {/* Loading skeleton */}
        {isLoadingData && allTrips.length === 0 && (
          <HomeSkeleton viewMode={viewMode} />
        )}

        {/* Greeting + stats hero — shown for both empty and filled (not while the
            first-load skeleton is up). */}
        {!(isLoadingData && allTrips.length === 0) && (
          <>
            <Greeting greeting={t('stats.greeting', { name: greetName })} name={greetName} avatarName={greetName} photo={user?.avatar_url} sub={subText} eyebrow={t('trips.brand_eyebrow')} />
            <StatHero
              points={statsPoints}
              home={home}
              world={world}
              showMap={showMap}
              scheme={scheme}
              nextTrip={nextTrip}
              onAllStats={() => nav('/stats')}
              onPlan={() => openChoice()}
              onOpenNext={() => nextTrip && nav(`/trip/${nextTrip.id}`)}
              t={t}
              ghost={!isLoadingData && allTrips.length === 0}
            />
          </>
        )}

        {/* Empty collection — "Маршрут" itinerary-rail hero below the ghost stats */}
        {!isLoadingData && allTrips.length === 0 && (
          <EmptyRoute onManual={() => startCreate('manual')} onAi={() => startCreate('ai')} />
        )}

        {/* Normal view */}
        {allTrips.length > 0 && (
          <>
            {/* Section header row */}
            <div style={{ display: 'flex', alignItems: 'flex-start', gap: 16, margin: '30px 0 16px', flexWrap: 'wrap' }}>
              <div style={{ flex: 1, minWidth: 200 }}>
                <div className="t-mono tp-caption" style={{ marginBottom: 6 }}>{t('trips.my_trips_eyebrow')}</div>
                <h2 className="t-title">{pluralize(t, allTrips.length, 'stats.sum_trips', lang, { count: allTrips.length })}</h2>
              </div>
            </div>

            {/* Filters row — adaptive (.trips-toolbar): wraps the search to its own
                full-width line on phones, segments share the first line. */}
            <div className="trips-toolbar">
              <div className="seg seg--filter" role="group" aria-label={t('trips.tab_active')}>
                <button aria-pressed={filterMode === 'active'} onClick={() => setFilterMode('active')}>
                  {t('trips.tab_active')} · <span className="num">{activeTrips.length}</span>
                </button>
                <button aria-pressed={filterMode === 'past'} onClick={() => setFilterMode('past')}>
                  {t('trips.tab_past')} · <span className="num">{pastTrips.length}</span>
                </button>
              </div>
              <div className="trips-toolbar__search">
                <Icon name="search" size={15} style={{ position: 'absolute', left: 11, top: '50%', transform: 'translateY(-50%)', color: 'var(--muted-2)' }} />
                <input className="input" placeholder={t('trips.search_placeholder')} value={search} onChange={e => setSearch(e.target.value)} style={{ paddingLeft: 34 }} />
              </div>
              <div className="trips-toolbar__spacer" />
              <div className="seg seg--view" role="group" title={t('trips.view')}>
                <button aria-pressed={viewMode === 'grid'} onClick={() => setViewMode('grid')}><Icon name="grid" size={13} /></button>
                <button aria-pressed={viewMode === 'list'} onClick={() => setViewMode('list')}><Icon name="list" size={13} /></button>
              </div>
            </div>

            {/* Free-limit banner — под фильтрами, над списком (TRIP-187): спокойный
                бренд-акцент, PRO-пилюля (звезда) даёт акцент, CTA — бренд-кнопка.
                Shown only when owned active trips reach/exceed the free cap (1). */}
            {filterMode === 'active' && limitReached && (
              <div className="limitcard">
                <Badge variant="pro" icon="pro">PRO</Badge>
                <div className="limitcard__body">
                  <div className="limitcard__top">
                    <b>{t('trips.free_limit_title')}</b>
                  </div>
                  <div className="limitcard__sub">{t('trips.free_limit_desc')}</div>
                </div>
                <Btn variant="primary" iconRight="arrowR" onClick={openUpgrade}>{t('trips.go_pro')}</Btn>
              </div>
            )}

            {/* Trip list */}
            {isLoadingData ? (
              <TripSkeleton viewMode={viewMode} />
            ) : shownNorm.length === 0 ? (
              // Active tab with no upcoming/active trips (past ones exist) → invite,
              // not a generic empty. A real search miss still shows empty_search.
              (filterMode === 'active' && !search.trim()) ? (
                <div className="invite">
                  <span className="invite__ic"><Icon name="sparkles" size={28} /></span>
                  <div className="invite__tx">
                    <h3>{t('trips.invite_title')}</h3>
                    <p>{t('trips.invite_desc')}</p>
                  </div>
                  <div className="invite__act">
                    <Btn variant="primary" icon="plus" onClick={() => openChoice()}>{t('trips.invite_create')}</Btn>
                    <Btn variant="ghost" onClick={() => setFilterMode('past')}>{t('trips.invite_show_past')}</Btn>
                  </div>
                </div>
              ) : (
                <EmptyState
                  icon={filterMode === 'past' ? 'calendar' : 'search'}
                  title={filterMode === 'past' ? t('trips.empty_archive_title') : t('trips.empty_search_title')}
                  body={filterMode === 'past' ? t('trips.empty_archive_body') : t('trips.empty_search_body')}
                />
              )
            ) : viewMode === 'grid' ? (
              <div className="tc-grid">
                {shownNorm.map(tr => (
                  <TripCard key={tr.id} trip={tr} onClick={() => nav(`/trip/${tr.id}`)} />
                ))}
                {filterMode === 'active' && (
                  <button className="tc-add" onClick={() => openChoice()}>
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
                {filterMode === 'active' && (
                  <button className="tr tr--add" onClick={() => openChoice()}>
                    <span className="tr__addic"><Icon name="plus" size={20} /></span>
                    <span className="tr__main">
                      <b>{t('trips.add_trip')}</b>
                      <small>{t('trips.add_trip_sub')}</small>
                    </span>
                  </button>
                )}
              </div>
            )}
          </>
        )}
      </main>
    </div>
  );
}
