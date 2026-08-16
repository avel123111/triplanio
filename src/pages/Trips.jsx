// @ts-check
import React, { useState, useMemo, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { invokeFn } from '@/lib/invokeFn';
import { useQuery } from '@tanstack/react-query';
import { useAuth } from '@/lib/AuthContext';
import { isTripInPast, formatTripRange, computeTripRange } from '@/lib/trip-dates';
import { isProActive } from '@/lib/subscription';
import { displayName } from '@/lib/displayName';
import { resolveAuthor } from '@/lib/resolveAuthor';
import { useTheme } from '@/lib/ThemeContext';
import { useI18n } from '@/lib/i18n/I18nContext';
import { pluralize, localizeCountry } from '@/lib/i18n/format';
import { Icon } from '../design/icons';
import { AvatarStack, Badge, Btn, Card, EmptyState, Input, RoleBadge, Seg, Skeleton, Tile } from '../design/index';
import { coverGradientCss } from '@/lib/trip-gradients';
import { uniqueTransitCities, localizeVisits } from '@/lib/trip-cities';
import { homeStats, worldExplored } from '@/lib/travel-stats';
import { useQueryGate } from '@/lib/useQueryGate';
import { gateStubProps } from '@/lib/loadStateClassify';
import { SystemStub } from '@/lib/PageNotFound';
import StatsMap from '@/components/views/StatsMap';
import {
  Greeting, StatBar, WorldMini, AllStatsCta,
} from '@/components/stats/widgets';

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
 * Shape a getTrips card (+ its localized visits) into the object the card
 * components expect.
 *
 * participants = the card's participants (owner + active members, owner first):
 *   { user_id, full_name, email, avatar_url, is_owner, is_deleted }
 *   from get_my_trip_cards (TRIP-403).
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
    // foreign trips made Pro by their owner's sub. getTrips computes it once via
    // is_user_pro (the client can't see a foreign owner's billing), exposed per
    // card as `serverPro` (card.is_pro) — the SINGLE source of the badge (TRIP-403).
    // Fallback (stale deploy with no is_pro field): the client predicate — own
    // trips only (is_pro_trip OR I'm the owner with an active sub) — so it degrades
    // gracefully instead of dropping all badges.
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

// ─── Avatar stack — the canonical <AvatarStack> from the design system. This
// file used to carry its own copy (third implementation of the same element),
// with its own `.av-stack` CSS twin of `.avatar-stack`.
const TripAvatars = ({ members, maxShow = 3, white = false }) => {
  if (!members || members.length === 0) return null;
  // `members` are already resolved to the <Avatar> shape (name/photo/deleted) by
  // the shared identity ladder in getTrips (see participantsByTrip) — no per-card
  // copy of displayName()/is_deleted here.
  return (
    <AvatarStack
      max={maxShow}
      className={white ? 'avatar-stack--white' : ''}
      people={members}
    />
  );
};

// ─── Next-trip rail card / empty states ────────────────────────────────────────
function NextTripCard({ trip, onClick, t }) {
  const bg = coverBg(trip);
  const cd = trip.countdown;
  return (
    <Card as="button" radius="lg" interactive className="nextcard" onClick={onClick}>
      <span className="nextcard__cover" style={{ background: bg || undefined }}>
        {trip.cover_image_url && <img src={trip.cover_image_url} alt="" style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', objectFit: 'cover' }} />}
      </span>
      <span className="nextcard__tx">
        <span className="t-label tp-caption">{t('stats.next_trip_title')}</span>
        <b>{trip.title}</b>
        <span className="rt">{trip.scope}</span>
        <span className="badge badge--sm nextcard__tag"><Icon name="calendar" />{t('stats.next_start_in')}</span>
        <span className="nextcard__cd">
          {/* Утоплённые плитки отсчёта — скин на канон `<Card recessed>`, раскладку/
              типографику держит `.cdu` (TRIP-343 объект 2). */}
          <Card as="div" recessed radius="md" pad="none" className="cdu"><b>{cd.d}</b><span>{t('stats.cd_days')}</span></Card>
          <Card as="div" recessed radius="md" pad="none" className="cdu"><b>{cd.h}</b><span>{t('stats.cd_hours')}</span></Card>
          <Card as="div" recessed radius="md" pad="none" className="cdu"><b>{cd.m}</b><span>{t('stats.cd_min')}</span></Card>
        </span>
      </span>
      <span className="nextcard__chev"><Icon name="chev" /></span>
    </Card>
  );
}

function NoNextCard({ variant, onPlan, t }) {
  const isEmpty = variant === 'empty';
  return (
    <Card radius="lg" className="nonext">
      <Tile as="span"><Icon name="calendar" /></Tile>
      <div>
        <b>{t('stats.next_trip')}</b>
        <p>{isEmpty ? t('stats.next_empty_sub') : t('stats.no_planned_sub')}</p>
      </div>
      {!isEmpty && (
        <Btn variant="primary" icon="plus" onClick={onPlan}>{t('stats.plan_trip')}</Btn>
      )}
    </Card>
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
      <div className="t-label tp-caption" style={{ margin: '36px 0 12px' }}>{t('stats.trips_summary')}</div>
      <StatBar items={items} cta={<AllStatsCta label={t('stats.all_stats')} onClick={onAllStats} />} className={ghost ? 'is-ghost' : ''} />
      <div className={`dash-hero${ghost ? ' is-ghost' : ''}`}>
        <div className="mapwrap">
          {showMap
            ? <StatsMap points={points} colorScheme={scheme} pins={false} />
            : <Skeleton style={{ position: 'absolute', inset: 0 }} h="100%" r={0} />}
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
    <Card as="button" pad="none" radius="lg" className={`tc${trip.status === 'past' ? ' tc--past' : ''}`} onClick={onClick}>
      {/* cover layer — фото ИЛИ градиент + декоративные блобы. Всё внутри .tc__bg,
          который и зумится на ховере: у градиентных карточек видимый зум дают блобы
          (плоский градиент сам по себе при scale не читается — увеличивать нечего) */}
      <div className="tc__bg" style={{ background: bg || undefined }}>
        {trip.cover_image_url ? (
          <img className="tc__img" src={trip.cover_image_url} alt="" />
        ) : (
          <>
            <div className="tc__blob tc__b1" />
            <div className="tc__blob tc__b2" />
          </>
        )}
      </div>

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
          <span className="trunc">{trip.scope}</span>
        </div>

        {/* shared footer: совместный chip + role + avatars */}
        {trip.isShared && (
          <div className="tc__foot">
            <span className="tc__glass">
              <Icon name="users" /> {t('trips.shared_badge')}
            </span>
            <RoleBadge role={trip.role} />
            <TripAvatars members={trip.members} maxShow={3} white />
          </div>
        )}
      </div>
    </Card>
  );
};

// ─── Trip row (list view) ────────────────────────────────────────────────────
const TripRow = ({ trip, onClick }) => {
  const { t } = useI18n();
  const bg = coverBg(trip);

  return (
    <Card
      as="button"
      radius="lg"
      interactive
      onClick={onClick}
      className={`tr${trip.status === 'past' ? ' tr--past' : ''}`}
    >
      {/* thumbnail — фото переиспользует канон-класс .tc__img (убирает инлайн-стили),
          чтобы ховер-зум был как в гриде; градиент остаётся фоном .tr__thumb */}
      <div className="tr__thumb" style={{ background: bg || undefined }}>
        {trip.cover_image_url && (
          <img className="tc__img" src={trip.cover_image_url} alt="" />
        )}
        <div className="tc__blob" />
        {trip.isShared && (
          <span className="tr__shared"><Icon name="users" /></span>
        )}
      </div>

      {/* main */}
      <div className="tr__main">
        <div className="tr__title">{trip.title}</div>
        <div className="tr__sub">
          <Icon name="pin" />
          <span className="trunc">{trip.scope}</span>
        </div>
      </div>

      {/* meta */}
      <div className="tr__meta">
        <span className="tr__date tab tr-hideS">{trip.days}</span>
        {trip.isShared && (
          <div className="tr-hideS">
            <TripAvatars members={trip.members} maxShow={2} />
          </div>
        )}
        {trip.isShared && (
          <span className="tr-hideS">
            <RoleBadge role={trip.role} />
          </span>
        )}
        {trip.pro && (
          <span className="tr-hideS">
            <Badge variant="pro" icon="pro">PRO</Badge>
          </span>
        )}
        <span className="tr__chev"><Icon name="chev" /></span>
      </div>
    </Card>
  );
};

// ─── Empty collection · "Маршрут" — itinerary-rail hero + manual/AI choices ─────
// Decorative orbs are inline-styled (no shared `.blob` class in this stylesheet);
// the rail illustration + copy + choice pair sit above them (z-index 1).
const _ORB = /** @type {React.CSSProperties} */ ({ position: 'absolute', borderRadius: '50%', filter: 'blur(12px)', pointerEvents: 'none', zIndex: 0 });
function EmptyRoute({ onManual, onAi }) {
  const { t } = useI18n();
  return (
    <Card radius="card" className="eroute" style={{ marginTop: 28 }}>
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
    </Card>
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
          {/* аватар = круг (как реальный .head__av 60×60 border-radius:50%), а не квадрат */}
          <Skeleton w={60} h={60} r="50%" />
          <div className="grow">
            {/* eyebrow + заголовок + подзаголовок — как компонент Greeting (marginBottom 6 / sub margin-top 8) */}
            <Skeleton w={90} h={12} r={5} style={{ marginBottom: 6 }} />
            <Skeleton w={240} h={38} r={'var(--r-sm)'} style={{ marginBottom: 8 }} />
            <Skeleton w={200} h={15} r={6} />
          </div>
        </div>
      </div>
      <Skeleton w="100%" h={86} r={'var(--r-xl)'} />
      <div className="dash-hero" style={{ marginTop: 18 }}>
        <Skeleton w="100%" h={340} r={'var(--r-card)'} />
        <div className="rail">
          <Skeleton w="100%" h={150} r={'var(--r-xl)'} />
          <Skeleton w="100%" h={120} r={'var(--r-xl)'} />
        </div>
      </div>
      <div style={{ display: 'flex', alignItems: 'flex-start', gap: 16, margin: '30px 0 16px', flexWrap: 'wrap' }}>
        <div style={{ flex: 1, minWidth: 200 }}>
          <Skeleton w={170} h={26} r={'var(--r-sm)'} style={{ marginBottom: 8 }} />
          <Skeleton w={140} h={14} r={6} />
        </div>
        <Skeleton w={150} h={44} r={'var(--r-sm)'} />
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
          <Card key={i} radius="md" pad="none" style={{ display: 'flex', alignItems: 'center', gap: 14, padding: '12px 16px' }}>
            <Skeleton w={62} h={46} r={'var(--r-sm)'} />
            <div className="grow">
              <Skeleton w="55%" h={14} r={5} style={{ marginBottom: 6 }} />
              <Skeleton w="32%" h={11} r={4} />
            </div>
            <Skeleton w={80} h={12} r={5} />
          </Card>
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
    // Композит главной (TRIP-403, ярус B): edge getTrips (actor из JWT → RPC
    // get_my_trip_cards под service_role) отдаёт карточку ЦЕЛИКОМ одним вызовом —
    // список + owner-aware is_pro (БЕЙДЖ отсюда) + моя роль + визиты + участники
    // (owner первым). Заменяет прямой .from('trips') + RPC профилей участников
    // + карточные слайсы getTravelStats. Порядок — created_at desc (в самой RPC).
    queryFn: async () => {
      const { data, error, code, message } = await invokeFn('getTrips');
      // Бросаем исходный error (помечен __seamHandled) — без повторного отчёта.
      if (error || code) throw error || new Error(message || code);
      return data || [];
    },
    enabled: !!user?.id,
  });

  const hasTrips = allTrips.length > 0;

  // ── Travel-stats reader — верхние виджеты только: stat-bar, map fill/pins,
  // "world explored". Главная берёт ОТСЮДА лишь points и transfers_total; карточные
  // слайсы (trips/trip_visits) ушли в getTrips (TRIP-403). Year filtering /
  // aggregates happen client-side (here it's unfiltered).
  const { data: travelStats } = useQuery({
    queryKey: ['travel-stats', user?.id],
    // Общий ридер яруса A (TRIP-402): тот же edge getTravelStats и кэш-ключ, что у
    // «Моей статистики» (Statistics.jsx) — читаем из общего кэша.
    queryFn: async () => {
      const { data, error, code, message } = await invokeFn('getTravelStats');
      // Бросаем исходный error (помечен __seamHandled) — без повторного отчёта.
      if (error || code) throw error || new Error(message || code);
      return data || { points: [], transfers_total: 0 };
    },
    enabled: !!user?.id,
    staleTime: 30_000,
  });
  const statsLoaded    = travelStats !== undefined;
  const statsPoints    = useMemo(() => localizeVisits(travelStats?.points || [], lang), [travelStats, lang]);
  const transfersTotal = travelStats?.transfers_total || 0;
  const home  = useMemo(() => homeStats(statsPoints, transfersTotal), [statsPoints, transfersTotal]);
  const world = useMemo(() => worldExplored(statsPoints), [statsPoints]);

  // Participants (owner + active members, owner первым) приходят В карточке из
  // getTrips (get_my_trip_cards поглотил профили участников, TRIP-403). Резолвим
  // каждого ЕДИНОЙ лестницей resolveAuthor в форму <Avatar> ({name/photo/deleted})
  // — метка обезличенного аккаунта и ровный градиент живут ТАМ, не инлайном здесь.
  const participantsByTrip = useMemo(() => {
    const m = {};
    for (const tr of allTrips) {
      m[tr.id] = (tr.participants || []).map((p) => resolveAuthor({
        userId: p.user_id,
        profiles: { [p.user_id]: { id: p.user_id, full_name: p.full_name, avatar_url: p.avatar_url, email: p.email, is_deleted: p.is_deleted } },
        deletedLabel: t('common.deleted_user'),
      }));
    }
    return m;
  }, [allTrips, t]);

  // Per-trip visits come IN the card from getTrips (TRIP-403). Localize each
  // trip's city names from the per-visit snapshot (TRIP-146). Downstream helpers
  // (isTripInPast / scopeLabel / computeTripRange) are unchanged.
  const visitsByTrip = useMemo(() => {
    const out = {};
    for (const tr of allTrips) out[tr.id] = localizeVisits(tr.visits || [], lang);
    return out;
  }, [allTrips, lang]);

  // ── Search haystack ──────────────────────────────────────────────────────────
  // One lowercased blob per trip: title + description + its cities + countries.
  // Cities use the same deduped transit set shown on the card, in every locale we
  // hold (name_i18n en/es/ru + the en-fallback city_name), so "париж"/"paris" both
  // match. Countries are localized from country_code via localizeCountry (current
  // UI language + English fallback + the raw ISO code). No extra fetch — all of
  // this already arrives in the card's visits from getTrips (get_my_trip_cards).
  const haystackByTrip = useMemo(() => {
    const out = {};
    for (const tr of allTrips) {
      const parts = [tr.title, tr.description];
      for (const v of uniqueTransitCities(visitsByTrip[tr.id] || [])) {
        const i18n = v.name_i18n || {};
        parts.push(v.city_name, i18n.en, i18n.es, i18n.ru);
        if (v.country_code) {
          parts.push(
            localizeCountry(v.country_code, lang),
            localizeCountry(v.country_code, 'en'),
            v.country_code,
          );
        }
      }
      out[tr.id] = parts.filter(Boolean).join(' · ').toLowerCase();
    }
    return out;
  }, [allTrips, visitsByTrip, lang]);

  // ── Partition ────────────────────────────────────────────────────────────────
  const matches = (tr) => {
    const q = search.trim().toLowerCase();
    return !q || (haystackByTrip[tr.id] || '').includes(q);
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
      return new Date(sa).getTime() - new Date(sb).getTime();
    });

  // Past → most recently finished first (end desc). Past trips always have an
  // end date (isTripInPast requires it), so no null guard is needed.
  const pastTrips = allTrips
    .filter(tr => isTripInPast(visitsByTrip[tr.id] || []) && matches(tr))
    .sort((a, b) => new Date(rangeOf(b).end).getTime() - new Date(rangeOf(a).end).getTime());

  const shown       = filterMode === 'active' ? activeTrips : pastTrips;

  const shownNorm = shown.map(tr =>
    normalizeTrip(t, tr, visitsByTrip[tr.id] || [], tr.role, isPro, participantsByTrip[tr.id] || [], tr.is_pro)
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


  // The screen shows the trip LIST and the stat HERO together, so first paint
  // waits for BOTH composites: getTrips (cards: list/visits/participants/roles/
  // badge) via `isLoading`, and getTravelStats (hero: stat-bar/map/world) via
  // `statsLoaded`. Cached list wins — a background stats refetch never re-gates.
  const isLoadingData = isLoading || (hasTrips && !statsLoaded);
  // Строка-счётчик «N trips · N countries · N cities» убрана (запрос Pavel);
  // при отсутствии трипов остаётся приветственный подзаголовок.
  const subText = hasTrips ? null : t('stats.home_sub_empty');

  // ── Load gate (TRIP-208) ──────────────────────────────────────────────────────
  // A failed PRIMARY trips load must surface an error + retry, not silently fall
  // through to the "no trips yet" empty state. Only the trips list gates the
  // screen; travel-stats/participants are enrichment and degrade silently. Cached
  // list wins (hasData) — a background refetch error never blanks a shown list.
  // Collection: empty = "no trips yet" via useQueryGate's fail-safe default; a
  // real load failure still gates via the thrown-error path below (TRIP-220).
  const tripsGate = useQueryGate(
    { isPending: tripsPending, fetchStatus: tripsFetchStatus, error: tripsError },
    allTrips.length > 0,
  );
  if (tripsGate === 'temporary' || tripsGate === 'access' || tripsGate === 'not_found') {
    const stub = gateStubProps(tripsGate);
    const isTemporary = tripsGate === 'temporary';
    return (
      <div style={{ minHeight: '100vh' }}>
        <SystemStub
          icon={stub.icon}
          tone={stub.tone}
          title={t(stub.title)}
          body={t(stub.body)}
          primary={isTemporary
            ? { label: t('sys.retry'), onClick: () => refetchTrips() }
            : { label: t('sys.to_my_trips'), onClick: () => nav('/trips') }}
        />
      </div>
    );
  }

  // ── Render ────────────────────────────────────────────────────────────────────
  return (
    <div className={`app-shell${!isLoadingData && allTrips.length === 0 ? ' stats-ghost' : ''}`}>

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
                <div className="t-label tp-caption" style={{ marginBottom: 6 }}>{t('trips.my_trips_eyebrow')}</div>
                <h2 className="t-title">{pluralize(t, allTrips.length, 'stats.sum_trips', lang, { count: allTrips.length })}</h2>
              </div>
            </div>

            {/* Filters row — adaptive (.trips-toolbar): wraps the search to its own
                full-width line on phones, segments share the first line. */}
            <div className="trips-toolbar">
              <Seg
                className="seg--filter"
                ariaLabel={t('trips.tab_active')}
                value={filterMode}
                onChange={setFilterMode}
                options={[
                  { value: 'active', label: <>{t('trips.tab_active')} · <span className="num">{activeTrips.length}</span></> },
                  { value: 'past', label: <>{t('trips.tab_past')} · <span className="num">{pastTrips.length}</span></> },
                ]}
              />
              <Input
                className="trips-toolbar__search"
                icon="search"
                placeholder={t('trips.search_placeholder')}
                aria-label={t('trips.search_placeholder')}
                value={search}
                onChange={e => setSearch(e.target.value)}
              />
              <div className="trips-toolbar__spacer" />
              <Seg
                className="seg--view"
                title={t('trips.view')}
                value={viewMode}
                onChange={setViewMode}
                options={[
                  { value: 'grid', label: <Icon name="grid" size={13} /> },
                  { value: 'list', label: <Icon name="list" size={13} /> },
                ]}
              />
            </div>

            {/* Free-limit banner — под фильтрами, над списком (TRIP-187): спокойный
                бренд-акцент, PRO-пилюля (звезда) даёт акцент, CTA — бренд-кнопка.
                Shown only when owned active trips reach/exceed the free cap (1). */}
            {filterMode === 'active' && limitReached && (
              <Card tone="brand" radius="md" className="limitcard">
                <Badge variant="pro" icon="pro">PRO</Badge>
                <div className="limitcard__body">
                  <div className="limitcard__top">
                    <b>{t('trips.free_limit_title')}</b>
                  </div>
                  <div className="limitcard__sub">{t('trips.free_limit_desc')}</div>
                </div>
                <Btn variant="primary" iconRight="arrowR" onClick={openUpgrade}>{t('trips.go_pro')}</Btn>
              </Card>
            )}

            {/* Trip list */}
            {isLoadingData ? (
              <TripSkeleton viewMode={viewMode} />
            ) : shownNorm.length === 0 ? (
              // Active tab with no upcoming/active trips (past ones exist) → invite,
              // not a generic empty. A real search miss still shows empty_search.
              (filterMode === 'active' && !search.trim()) ? (
                <Card radius="lg" className="row invite">
                  <Tile as="span" className="invite__ic"><Icon name="sparkles" size={28} /></Tile>
                  <div className="invite__tx">
                    <h3>{t('trips.invite_title')}</h3>
                    <p>{t('trips.invite_desc')}</p>
                  </div>
                  <div className="row row--wrap invite__act">
                    <Btn variant="primary" icon="plus" onClick={() => openChoice()}>{t('trips.invite_create')}</Btn>
                    <Btn variant="secondary" onClick={() => setFilterMode('past')}>{t('trips.invite_show_past')}</Btn>
                  </div>
                </Card>
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
                  <Card as="button" variant="add" radius="md" className="tc-add" onClick={() => openChoice()}>
                    <div className="tc-add__ic">
                      <Icon name="plus" size={24} />
                    </div>
                    <b>{t('trips.add_trip')}</b>
                    <small>{t('trips.add_trip_sub')}</small>
                  </Card>
                )}
              </div>
            ) : (
              <div className="col">
                {shownNorm.map(tr => (
                  <TripRow key={tr.id} trip={tr} onClick={() => nav(`/trip/${tr.id}`)} />
                ))}
                {filterMode === 'active' && (
                  <Card as="button" variant="add" radius="lg" className="tr tr--add" onClick={() => openChoice()}>
                    <span className="tr__addic"><Icon name="plus" size={20} /></span>
                    <span className="tr__main">
                      <b>{t('trips.add_trip')}</b>
                      <small>{t('trips.add_trip_sub')}</small>
                    </span>
                  </Card>
                )}
              </div>
            )}
          </>
        )}
      </main>
    </div>
  );
}
