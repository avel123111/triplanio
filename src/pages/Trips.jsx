// @ts-check
import React, { useState, useMemo, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { invokeFn } from '@/lib/invokeFn';
import { goPro } from '@/lib/goPro';
import { useQuery } from '@tanstack/react-query';
import { useAuth } from '@/lib/AuthContext';
import { isTripInPast, formatTripRange, computeTripRange, countdownParts } from '@/lib/trip-dates';
import { isProActive } from '@/lib/subscription';
import { displayName } from '@/lib/displayName';
import { resolveAuthor } from '@/lib/resolveAuthor';
import { useTheme } from '@/lib/ThemeContext';
import { useI18n } from '@/lib/i18n/I18nContext';
import { pluralize, localizeCountry } from '@/lib/i18n/format';
import { Icon } from '../design/icons';
import { AvatarStack, Badge, Btn, Card, COVER_FALLBACK, EmptyState, Input, PageHead, RoleBadge, Seg, Skeleton, Tile } from '../design/index';
import CountryFlag from '@/components/common/CountryFlag';
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
import AppShell from '@/components/AppShell';

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
 *   { user_id, name, avatar_url, is_owner, is_deleted }
 *   from get_my_trip_cards (TRIP-403; server-resolved `name`, no raw email — TRIP-431).
 *
 * "Shared" = trip has ≥2 participants (owner + at least 1 accepted member).
 */
function normalizeTrip(t, trip, visits = [], role = 'member', isPro = false, participants = [], serverPro = undefined) {
  // Duration in days (inclusive) — only when both ends are known; 0 = don't show.
  const range = computeTripRange(visits);
  const nDays = range.start && range.end
    ? Math.round((new Date(range.end).getTime() - new Date(range.start).getTime()) / 864e5) + 1
    : 0;
  // Up to 3 unique country flags — the SAME deduped transit set as scope/counters,
  // so the flag row can never disagree with the city list next to it.
  const flags = [...new Set(uniqueTransitCities(visits).map(v => v.country_code).filter(Boolean))].slice(0, 3);
  return {
    ...trip,
    days:      formatTripRange(visits, '-'),
    nDays,
    flags,
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
    pro:       typeof serverPro === 'boolean' ? serverPro : (!!trip.is_pro_trip || (role === 'owner' && isPro)), // role-gate-exempt: pro-бейдж карточки (показ)
    userIsPro: isPro,
    status:    isTripInPast(visits) ? 'past' : 'active',
    isShared:  participants.length >= 2,
    members:   participants,
  };
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

// ─── Trip hero / empty states ─────────────────────────────────────────────────
// Обложечный ГЕРОЙ идущего/ближайшего трипа — главный объект экрана (редизайн,
// задача Pavel). Постер-канон .tc в новой роли .tc--hero: display-заголовок
// поверх фото, даты + длительность, города с флагами, стек участников. У
// предстоящего — живой отсчёт утоплёнными плитками .cdu (тикает раз в минуту);
// у идущего — glass-чип «Сегодня» + плитка прогресса «N/M дн».
function TripHero({ trip, onClick, t, lang }) {
  const cd = trip.countdown;
  return (
    <Card as="button" pad="none" radius="lg" className="tc tc--hero" onClick={onClick}>
      <div className="tc__bg">
        <img className="tc__img" src={trip.cover_image_url || COVER_FALLBACK} alt="" />
        {!trip.cover_image_url && (
          <>
            <div className="tc__blob tc__b1" />
            <div className="tc__blob tc__b2" />
          </>
        )}
      </div>
      <div className="tc__scrim" />
      <div className="tc__in">
        <div className="tc__tags">
          {trip.isCurrent
            ? <span className="tc__glass"><Icon name="calendar" /> {t('common.today')}</span>
            : <span className="badge badge--sm nextcard__tag"><Icon name="calendar" />{t('stats.next_start_in')}</span>}
          {trip.pro && <Badge variant="pro" icon="pro">PRO</Badge>}
        </div>
        <div className="tc__spacer" />
        {!trip.isCurrent && <div className="t-label tp-caption">{t('stats.next_trip_title')}</div>}
        <div className="tc__title t-display">{trip.title}</div>
        <div className="tc__dates tab">
          {trip.days}
          {trip.nDays > 0 && <> · {trip.nDays} {pluralize(t, trip.nDays, 'trip.days', lang)}</>}
        </div>
        <div className="tc__scope">
          {trip.flags.length > 0
            ? trip.flags.map(cc => <CountryFlag key={cc} code={cc} />)
            : <Icon name="pin" />}
          <span className="trunc">{trip.scope}</span>
        </div>
        <div className="tc__foot">
          <span className="nextcard__cd">
            {trip.isCurrent
              ? trip.nDays > 0 && (
                <Card as="div" recessed radius="md" pad="none" className="cdu">
                  <b className="tab">{trip.dayIdx}/{trip.nDays}</b>
                  <span>{t('overview.unit_days')}</span>
                </Card>
              )
              : cd && (
                <>
                  {/* Утоплённые плитки отсчёта — скин на канон `<Card recessed>`,
                      раскладку/типографику держит `.cdu` (TRIP-343 объект 2). */}
                  <Card as="div" recessed radius="md" pad="none" className="cdu"><b>{cd.d}</b><span>{t('stats.cd_days')}</span></Card>
                  <Card as="div" recessed radius="md" pad="none" className="cdu"><b>{cd.h}</b><span>{t('stats.cd_hours')}</span></Card>
                  <Card as="div" recessed radius="md" pad="none" className="cdu"><b>{cd.m}</b><span>{t('stats.cd_min')}</span></Card>
                </>
              )}
          </span>
          {trip.isShared && <TripAvatars members={trip.members} maxShow={3} white />}
        </div>
      </div>
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

// ─── Stat hero: trip-hero + map + rail (shared by filled + empty screens) ──────
// При наличии героя (идущий/ближайший трип) он занимает левую 1.5fr-ячейку
// (место карты), карта уезжает в рейл под WorldMini; без героя — прежняя
// раскладка (карта слева, рейл = WorldMini + NoNextCard). Mapbox-синглтон не
// пересоздаётся: меняется только контейнер, lazy-mount через rAF как был.
function StatHero({ points, home, world, showMap, scheme, hero, onAllStats, onPlan, onOpenHero, t, lang, ghost = false }) {
  const items = [
    { key: 'countries', value: home.countries, label: t('stats.sb_countries'), icon: <Icon name="globe" /> },
    { key: 'cities',    value: home.cities,    label: t('stats.sb_cities'),     tone: 'city',     icon: <Icon name="buildings" /> },
    { key: 'trips',     value: home.trips,     label: t('stats.sb_trips'),      tone: 'trip',     icon: <Icon name="suitcase" /> },
    { key: 'transfers', value: home.transfers, label: t('stats.sb_transfers'),  tone: 'transfer', icon: <Icon name="arrowSwap" /> },
  ];
  const map = (
    <div className="mapwrap">
      {showMap
        ? <StatsMap points={points} colorScheme={scheme} pins={false} />
        : <Skeleton style={{ position: 'absolute', inset: 0 }} h="100%" r={0} />}
    </div>
  );
  return (
    <>
      <div className="t-label tp-caption" style={{ margin: '36px 0 12px' }}>{t('stats.trips_summary')}</div>
      <StatBar items={items} cta={<AllStatsCta label={t('stats.all_stats')} onClick={onAllStats} />} className={ghost ? 'is-ghost' : ''} />
      <div className={`dash-hero${ghost ? ' is-ghost' : ''}`}>
        {hero ? <TripHero trip={hero} onClick={onOpenHero} t={t} lang={lang} /> : map}
        <div className="rail">
          <WorldMini
            world={world}
            title={t('stats.world_explored')}
            subCaption={t('stats.world_countries_visited')}
          />
          {hero
            ? map
            : <NoNextCard variant={home.trips > 0 ? 'no-planned' : 'empty'} onPlan={onPlan} t={t} />}
        </div>
      </div>
    </>
  );
}

// ─── Trip card (grid / poster view) ─────────────────────────────────────────
const TripCard = ({ trip, onClick }) => {
  const { t, lang } = useI18n();

  return (
    <Card as="button" pad="none" radius="lg" className={`tc${trip.status === 'past' ? ' tc--past' : ''}`} onClick={onClick}>
      {/* cover layer — фото ИЛИ фоллбек-обложка + декоративные блобы. Всё внутри
          .tc__bg, который зумится на ховере (зум дают листья: фото .tc__img и орбы).
          Обложки нет → фоллбек-картинка из бандла (COVER_FALLBACK), градиентов нет. */}
      <div className="tc__bg">
        <img className="tc__img" src={trip.cover_image_url || COVER_FALLBACK} alt="" />
        {!trip.cover_image_url && (
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

        {/* trip info: даты + длительность в днях; города с SVG-флагами стран
            (канон CountryFlag/.cflag — единственный источник флагов, TRIP-177) */}
        <div className="tc__title">{trip.title}</div>
        <div className="tc__dates tab">
          {trip.days}
          {trip.nDays > 0 && <> · {trip.nDays} {pluralize(t, trip.nDays, 'trip.days', lang)}</>}
        </div>
        <div className="tc__scope">
          {trip.flags.length > 0
            ? trip.flags.map(cc => <CountryFlag key={cc} code={cc} />)
            : <Icon name="pin" />}
          <span className="trunc">{trip.scope}</span>
        </div>

        {/* shared footer: совместный chip + role + avatars */}
        {trip.isShared && (
          <div className="tc__foot">
            <span className="tc__glass">
              <Icon name="users" /> {t('trips.shared_badge')}
            </span>
            <RoleBadge role={trip.role} glass />
            <TripAvatars members={trip.members} maxShow={3} white />
          </div>
        )}
      </div>
    </Card>
  );
};

// ─── Trip row (list view) ────────────────────────────────────────────────────
const TripRow = ({ trip, onClick }) => {
  return (
    <Card
      as="button"
      radius="lg"
      interactive
      onClick={onClick}
      className={`tr${trip.status === 'past' ? ' tr--past' : ''}`}
    >
      {/* thumbnail — фото ИЛИ фоллбек-обложка через канон-класс .tc__img (ховер-зум
          как в гриде); обложки нет → фоллбек-картинка из бандла, градиентов нет */}
      <div className="tr__thumb">
        <img className="tc__img" src={trip.cover_image_url || COVER_FALLBACK} alt="" />
        <div className="tc__blob" />
        {trip.isShared && (
          <span className="tr__shared"><Icon name="users" /></span>
        )}
      </div>

      {/* main */}
      <div className="tr__main">
        <div className="tr__title">{trip.title}</div>
        <div className="tr__sub">
          {trip.flags.length > 0
            ? trip.flags.map(cc => <CountryFlag key={cc} code={cc} />)
            : <Icon name="pin" />}
          <span className="trunc">{trip.scope}</span>
        </div>
      </div>

      {/* meta — дата видна и на телефоне (класс tr-hideS снят с этого узла:
          мобильный список терял ВСЮ мету; аватары/роль/PRO остаются скрытыми) */}
      <div className="tr__meta">
        <span className="tr__date tab">{trip.days}</span>
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
      {/* 1. Greeting: аватар-круг (.head__av 60×60 50%) + eyebrow + заголовок (h1).
          Реальный Greeting здесь БЕЗ третьей строки — sub не рисуем. */}
      <div className="head">
        <div className="head__row">
          <Skeleton w={60} h={60} r="50%" />
          <div className="grow">
            <Skeleton w={120} h={12} r={5} style={{ marginBottom: 8 }} />
            <Skeleton w={240} h={38} r={'var(--r-sm)'} />
          </div>
        </div>
      </div>
      {/* 2. «TRAVEL SUMMARY» — label с теми же отступами, что реальный (36/12) */}
      <Skeleton w={140} h={13} r={5} style={{ margin: '36px 0 12px' }} />
      {/* 3. Стат-бар (.statbar-карточка ≈76px) */}
      <Skeleton w="100%" h={76} r={'var(--r-lg)'} />
      {/* 4. dash-hero: hero-постер трипа (340) | рейл (World Explored ≈150 + карта) */}
      <div className="dash-hero" style={{ marginTop: 18 }}>
        <Skeleton w="100%" h={340} r={'var(--r-xl)'} />
        <div className="rail">
          <Skeleton w="100%" h={150} r={'var(--r-xl)'} />
          <Skeleton w="100%" h={174} r={'var(--r-xl)'} />
        </div>
      </div>
      {/* 5. Шапка коллекции (PageHead): заголовок + eyebrow слева, вид справа;
          отступ сверху даёт правило `.dash-hero + .pagehead` (как в реальном рендере) */}
      <div className="pagehead">
        <div className="grow">
          <Skeleton w={160} h={28} r={'var(--r-sm)'} style={{ marginBottom: 6 }} />
          <Skeleton w={120} h={13} r={5} />
        </div>
        <Skeleton w={78} h={40} r={'var(--r-sm)'} />
      </div>
      {/* 6. Поиск `.trips-toolbar` (сегмент-фильтров больше нет — секции) */}
      <div className="trips-toolbar">
        <Skeleton w={300} h={44} r={'var(--r-xl)'} />
      </div>
      {/* 7. Карточки */}
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

  const { isDark } = useTheme();

  const [viewMode,    setViewMode]    = useState(() => {
    try { return localStorage.getItem('trips:viewMode') === 'list' ? 'list' : 'grid'; } catch { return 'grid'; }
  });
  const [search,      setSearch]      = useState('');
  // «Сейчас» для героя/отсчёта: тикает раз в минуту, deps ТОЛЬКО у hero-мемо —
  // поиск/списки от него не пересобираются (отсчёт раньше застывал на моменте
  // загрузки страницы).
  const [nowTs, setNowTs] = useState(() => Date.now());
  useEffect(() => {
    const id = setInterval(() => setNowTs(Date.now()), 60_000);
    return () => clearInterval(id);
  }, []);
  // Якорь секции «Прошедшие» — кнопка invite_show_past скроллит к архиву.
  const pastRef = React.useRef(/** @type {HTMLDivElement|null} */ (null));
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
  const openUpgrade = () => goPro(nav, { hidePerTrip: true });

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
        profiles: { [p.user_id]: { id: p.user_id, full_name: p.name, avatar_url: p.avatar_url, is_deleted: p.is_deleted } },
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

  // ── Hero: идущий трип (стартовал, не прошёл) с приоритетом над ближайшим ─────
  // Из двух идущих берём стартовавший ПОЗЖЕ (актуальнее); из будущих — ближайший.
  // У предстоящего — тикающий отсчёт (nowTs), у идущего — прогресс «N/M дн».
  const hero = useMemo(() => {
    let cur = null, next = null;
    for (const tr of allTrips) {
      const visits = visitsByTrip[tr.id] || [];
      const { start } = computeTripRange(visits);
      if (!start) continue;
      const startMs = new Date(start).getTime();
      if (startMs <= nowTs) {
        if (!isTripInPast(visits) && (!cur || startMs > cur.startMs)) cur = { tr, visits, startMs };
      } else if (!next || startMs < next.startMs) {
        next = { tr, visits, startMs };
      }
    }
    const pick = cur || next;
    if (!pick) return null;
    const base = normalizeTrip(t, pick.tr, pick.visits, pick.tr.role, isPro, participantsByTrip[pick.tr.id] || [], pick.tr.is_pro);
    if (cur) {
      const dayIdx = Math.min(base.nDays || 1, Math.floor((nowTs - pick.startMs) / 864e5) + 1);
      return { ...base, isCurrent: true, dayIdx };
    }
    return { ...base, isCurrent: false, countdown: countdownParts(pick.startMs - nowTs) };
  }, [allTrips, visitsByTrip, participantsByTrip, isPro, nowTs, t]);

  // ── Секции ────────────────────────────────────────────────────────────────────
  // «Активные» без hero-трипа (герой и есть его карточка — дубль устранён);
  // «Прошедшие» — всегда компактные строки, сгруппированные по годам окончания
  // (pastTrips уже отсортированы end desc — группировка сохраняет порядок).
  const activeShown = activeTrips
    .filter(tr => tr.id !== hero?.id)
    .map(tr => normalizeTrip(t, tr, visitsByTrip[tr.id] || [], tr.role, isPro, participantsByTrip[tr.id] || [], tr.is_pro));
  const pastShown = pastTrips.map(tr =>
    normalizeTrip(t, tr, visitsByTrip[tr.id] || [], tr.role, isPro, participantsByTrip[tr.id] || [], tr.is_pro));
  const pastByYear = /** @type {[number, (typeof pastShown)[number][]][]} */ ([]);
  for (let i = 0; i < pastTrips.length; i++) {
    const year = new Date(rangeOf(pastTrips[i]).end).getFullYear();
    const last = pastByYear[pastByYear.length - 1];
    if (last && last[0] === year) last[1].push(pastShown[i]);
    else pastByYear.push([year, [pastShown[i]]]);
  }


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
    <AppShell active="trips" ghost={!isLoadingData && allTrips.length === 0}>

      {/* PAGE CONTENT */}
      <main className="page-main page-main--wide">

        {/* Loading skeleton */}
        {isLoadingData && allTrips.length === 0 && (
          <HomeSkeleton viewMode={viewMode} />
        )}

        {/* Greeting + stats hero — shown for both empty and filled (not while the
            first-load skeleton is up). */}
        {!(isLoadingData && allTrips.length === 0) && (
          <>
            <Greeting greeting={t('stats.greeting', { name: greetName })} name={greetName} avatarName={greetName} photo={user?.avatar_url} seed={user?.id} sub={subText} eyebrow={t('trips.brand_eyebrow')} />
            <StatHero
              points={statsPoints}
              home={home}
              world={world}
              showMap={showMap}
              scheme={scheme}
              hero={hero}
              onAllStats={() => nav('/stats')}
              onPlan={() => openChoice()}
              onOpenHero={() => hero && nav(`/trip/${hero.id}`)}
              t={t}
              lang={lang}
              ghost={!isLoadingData && allTrips.length === 0}
            />
          </>
        )}

        {/* Empty collection — "Маршрут" itinerary-rail hero below the ghost stats */}
        {!isLoadingData && allTrips.length === 0 && (
          <EmptyRoute onManual={() => startCreate('manual')} onAi={() => startCreate('ai')} />
        )}

        {/* Normal view — редакционные секции вместо Seg-табов: «Активные» (hero
            исключён — герой и есть его карточка) и «Прошедшие» годовыми
            разворотами компактных строк. Поиск фильтрует обе секции. */}
        {allTrips.length > 0 && (
          <>
            {/* Шапка коллекции — канон PageHead; переключатель вида в actions */}
            <PageHead
              title={pluralize(t, allTrips.length, 'stats.sum_trips', lang, { count: allTrips.length })}
              subtitle={t('trips.my_trips_eyebrow')}
              actions={(
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
              )}
            />

            {/* Поиск по обеим секциям (.trips-toolbar сохраняет мобильный перенос) */}
            <div className="trips-toolbar">
              <Input
                className="trips-toolbar__search"
                icon="search"
                placeholder={t('trips.search_placeholder')}
                aria-label={t('trips.search_placeholder')}
                value={search}
                onChange={e => setSearch(e.target.value)}
              />
            </div>

            {/* Free-limit banner — над списком (TRIP-187): спокойный бренд-акцент.
                Shown when owned active trips reach/exceed the free cap (1). */}
            {limitReached && (
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

            {isLoadingData ? (
              <TripSkeleton viewMode={viewMode} />
            ) : (search.trim() && activeShown.length === 0 && pastShown.length === 0) ? (
            /* Поиск не нашёл ничего ни в одной секции */
              <EmptyState
                icon="search"
                title={t('trips.empty_search_title')}
                body={t('trips.empty_search_body')}
              />
            ) : (
              <>
                {/* ── Активные ── */}
                {!(search.trim() && activeShown.length === 0) && (
                  <>
                    <PageHead
                      title={t('trips.tab_active')}
                      actions={<Badge variant="count">{activeShown.length}</Badge>}
                    />
                    {activeShown.length === 0 && !hero && !search.trim() && pastTrips.length > 0 ? (
                      /* Активной жизни нет вовсе (и героя нет) → приглашение */
                      <Card radius="lg" className="row invite">
                        <Tile as="span" className="invite__ic"><Icon name="sparkles" size={28} /></Tile>
                        <div className="invite__tx">
                          <h3>{t('trips.invite_title')}</h3>
                          <p>{t('trips.invite_desc')}</p>
                        </div>
                        <div className="row row--wrap invite__act">
                          <Btn variant="primary" icon="plus" onClick={() => openChoice()}>{t('trips.invite_create')}</Btn>
                          <Btn variant="secondary" onClick={() => pastRef.current?.scrollIntoView({ behavior: 'smooth' })}>{t('trips.invite_show_past')}</Btn>
                        </div>
                      </Card>
                    ) : viewMode === 'grid' ? (
                      <div className="tc-grid">
                        {activeShown.map(tr => (
                          <TripCard key={tr.id} trip={tr} onClick={() => nav(`/trip/${tr.id}`)} />
                        ))}
                        <Card as="button" variant="add" radius="md" className="tc-add" onClick={() => openChoice()}>
                          <div className="tc-add__ic">
                            <Icon name="plus" size={24} />
                          </div>
                          <b>{t('trips.add_trip')}</b>
                          <small>{t('trips.add_trip_sub')}</small>
                        </Card>
                      </div>
                    ) : (
                      <div className="col">
                        {activeShown.map(tr => (
                          <TripRow key={tr.id} trip={tr} onClick={() => nav(`/trip/${tr.id}`)} />
                        ))}
                        <Card as="button" variant="add" radius="lg" className="tr tr--add" onClick={() => openChoice()}>
                          <span className="tr__addic"><Icon name="plus" size={20} /></span>
                          <span className="tr__main">
                            <b>{t('trips.add_trip')}</b>
                            <small>{t('trips.add_trip_sub')}</small>
                          </span>
                        </Card>
                      </div>
                    )}
                  </>
                )}

                {/* ── Прошедшие: годовые развороты компактных строк. Рефом служит
                    сама шапка (PageHead форвардит ref) — секция без лишней обёртки,
                    отбивку сверху даёт правило соседства `… + .pagehead`. ── */}
                {pastShown.length > 0 && (
                  <>
                    <PageHead
                      ref={pastRef}
                      title={t('trips.tab_past')}
                      actions={<Badge variant="count">{pastShown.length}</Badge>}
                    />
                    {pastByYear.map(([year, list]) => (
                      <React.Fragment key={year}>
                        {pastByYear.length > 1 && (
                          <PageHead
                            title={String(year)}
                            subtitle={pluralize(t, list.length, 'stats.sum_trips', lang, { count: list.length })}
                          />
                        )}
                        <div className="col">
                          {list.map(tr => (
                            <TripRow key={tr.id} trip={tr} onClick={() => nav(`/trip/${tr.id}`)} />
                          ))}
                        </div>
                      </React.Fragment>
                    ))}
                  </>
                )}
              </>
            )}
          </>
        )}
      </main>
    </AppShell>
  );
}
