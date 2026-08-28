// @ts-check
import React, { useState, useMemo, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { invokeFn } from '@/lib/invokeFn';
import { goPro } from '@/lib/goPro';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useAuth } from '@/lib/AuthContext';
import {
  isTripInPast, formatTripRange, computeTripRange,
  todayKey, tripProgress, currentCityVisit, sortActiveTrips,
} from '@/lib/trip-dates';
import { isProActive } from '@/lib/subscription';
import { displayName } from '@/lib/displayName';
import { resolveAuthor } from '@/lib/resolveAuthor';
import { useTheme } from '@/lib/ThemeContext';
import { useI18n } from '@/lib/i18n/I18nContext';
import { pluralize, localizeCountry } from '@/lib/i18n/format';
import { Icon } from '../design/icons';
import {
  AvatarStack, Badge, Btn, Card, Col, Cover, EmptyState, Grow, Input, ListRow,
  RoleBadge, Row, Skeleton, Tile, Trunc,
} from '../design/index';
import CountryFlag from '@/components/common/CountryFlag';
import { uniqueTransitCities, uniqueCountryCodes, localizeVisits } from '@/lib/trip-cities';
import { homeStats, worldExplored, pastOnly } from '@/lib/travel-stats';
import { useQueryGate } from '@/lib/useQueryGate';
import { cacheTripCards } from '@/lib/trip-data';
import { gateStubProps } from '@/lib/loadStateClassify';
import { SystemStub } from '@/lib/PageNotFound';
import StatsMap from '@/components/views/StatsMap';
import {
  Greeting, StatBar, WorldMini, StatBarCta,
} from '@/components/stats/widgets';
import { useConfirm } from '@/components/common/ConfirmProvider';
import { track } from '@/lib/analytics';

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
 *   { user_id, name, avatar_url, is_owner, is_deleted }
 *   from get_my_trip_cards (TRIP-403; server-resolved `name`, no raw email — TRIP-431).
 *
 * "Shared" = trip has ≥2 participants (owner + at least 1 accepted member).
 */
function normalizeTrip(t, trip, visits = [], role = 'member', isPro = false, participants = [], serverPro = undefined) {
  // До 3 флагов стран — из ТОГО ЖЕ дедуплицированного transit-набора, что и
  // список городов рядом и все счётчики (uniqueCountryCodes: старт/финиш/
  // waypoint не считаются), поэтому ряд флагов не может разойтись с текстом.
  const flags = uniqueCountryCodes(visits).slice(0, 3);
  return {
    ...trip,
    days:      formatTripRange(visits, '-'),
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

// ─── Виджет рейла: ТРИ состояния ──────────────────────────────────────────────
// Один слот, один трип, три взаимоисключающих состояния: идёт → <LiveTripCard>,
// впереди → <NextTripCard>, ничего → <NoNextCard>. Своего отбора у виджета нет:
// он получает ГОЛОВУ той же очереди активных, что рисует грид ниже
// (`sortActiveTrips`: идущие по концу → будущие по старту → без дат). Прежде
// отбор был свой (`startMs <= now`) и расходился со списком — в день старта трип
// пропадал из виджета, оставаясь активным в ленте.

function NextTripCard({ trip, onClick, t }) {
  const cd = trip.countdown;
  return (
    <Card as="button" radius="lg" interactive className="nextcard" onClick={onClick}>
      <span className="nextcard__cover">
        <Cover fill image={trip.cover_image_url} />
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

// Состояние «идёт»: НЕ новый объект, а тот же постер трипа `.tc` (см. TripCard
// ниже) в габаритах рейла. Обложка, скрим, стеклянный чип, заголовок и строка
// городов — общие с карточкой грида; своё только то, чего у карточки нет:
// счётчик дня, полоса дней и мета-подвал.
function LiveTripCard({ trip, onClick, t, lang }) {
  const { day, total, left } = trip.progress;
  return (
    <Card as="button" pad="none" radius="lg" className="tc tc--live" onClick={onClick}>
      <div className="tc__bg">
        <Cover fill image={trip.cover_image_url} />
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
          <Badge variant="success-solid" size="tiny">{t('stats.live_now')}</Badge>
          <span className="tc__day">
            <b>{day}</b>
            <span>{t('stats.live_day_of', { total })}</span>
          </span>
        </div>

        <div className="tc__spacer" />

        <div className="tc__title">{trip.title}</div>
        {/* «Сейчас {город}» — визит, накрывающий сегодняшний день. Флаг — канон
            CountryFlag, тот же источник флагов, что у карточки грида. */}
        {/* В день переезда сегодняшний день не накрыт ни одним городом — тогда
            строка показывает маршрут целиком, как карточка в гриде, а не
            «сейчас » с пустым местом. */}
        <div className="tc__scope">
          {trip.nowCountry
            ? <CountryFlag code={trip.nowCountry} />
            : <Icon name="pin" />}
          <span className="trunc">
            {trip.nowCity ? t('stats.live_in_city', { city: trip.nowCity }) : trip.scope}
          </span>
        </div>

        {/* Полоса дней: по сегменту на календарный день трипа. */}
        <div className="tc__prog">
          {Array.from({ length: total }, (_, i) => (
            <i
              key={i}
              className={`tc__prog-d${i + 1 < day ? ' is-past' : i + 1 === day ? ' is-now' : ''}`}
            />
          ))}
        </div>

        <div className="tc__foot tc__foot--meta">
          <span className="t-micro tab">{trip.days}</span>
          <span className="t-micro">{left > 0
            ? pluralize(t, left, 'stats.live_left', lang, { count: left })
            : t('stats.live_last_day')}</span>
        </div>
      </div>
    </Card>
  );
}

// Нет ни идущего, ни будущего (неважно, есть прошлые или нет) → карточка с
// приглашением запланировать. Никакого «пустого» варианта без кнопки — оба
// бестрипных случая ведут в один и тот же CTA.
function NoNextCard({ onPlan, t }) {
  return (
    <Card radius="lg" className="nonext">
      <Tile as="span"><Icon name="calendar" /></Tile>
      <div>
        <b>{t('stats.next_trip')}</b>
        <p>{t('stats.no_planned_sub')}</p>
      </div>
      <Btn variant="primary" icon="plus" onClick={onPlan}>{t('stats.plan_trip')}</Btn>
    </Card>
  );
}

// ─── Map hero + rail (shared by filled + empty screens) ────────────────────────
function StatHero({ points, home, world, showMap, scheme, hero, onAllStats, onYearReview, onPlan, onOpenHero, t, lang }) {
  const items = [
    { key: 'countries', value: home.countries, label: t('stats.sb_countries'), icon: <Icon name="globe" /> },
    { key: 'cities',    value: home.cities,    label: t('stats.sb_cities'),     tone: 'city',     icon: <Icon name="buildings" /> },
    { key: 'trips',     value: home.trips,     label: t('stats.sb_trips'),      tone: 'trip',     icon: <Icon name="suitcase" /> },
    { key: 'transfers', value: home.transfers, label: t('stats.sb_transfers'),  tone: 'transfer', icon: <Icon name="arrowSwap" /> },
  ];
  return (
    <>
      <div className="t-label tp-caption" style={{ margin: '36px 0 12px' }}>{t('stats.trips_summary')}</div>
      <StatBar
        items={items}
        cta={<>
          <StatBarCta label={t('stats.year_review')} onClick={onYearReview} variant="secondary" leadingIcon="calendar" />
          <StatBarCta label={t('stats.all_stats')} onClick={onAllStats} variant="soft" icon="arrowR" />
        </>}
      />
      <div className="dash-hero">
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
          {/* Три состояния одного слота — см. шапку виджета выше. */}
          {hero?.progress
            ? <LiveTripCard trip={hero} onClick={onOpenHero} t={t} lang={lang} />
            : hero
              ? <NextTripCard trip={hero} onClick={onOpenHero} t={t} />
              : <NoNextCard onPlan={onPlan} t={t} />}
        </div>
      </div>
    </>
  );
}

// ─── Trip card (grid / poster view) ─────────────────────────────────────────
const TripCard = ({ trip, onClick }) => {
  const { t } = useI18n();

  return (
    <Card as="button" pad="none" radius="lg" className={`tc${trip.status === 'past' ? ' tc--past' : ''}`} onClick={onClick}>
      {/* Слой обложки — примитив ДС `<Cover fill>` + декоративные орбы. Раньше
          здесь стоял сырой `<img class="tc__img">` со своей копией фоллбека и БЕЗ
          onError: битый или удалённый URL рисовал СЛОМАННУЮ картинку вместо
          плейсхолдера. У примитива фоллбек нижним слоем, фото поверх, onError
          гасит фото — один объект закрывает и «обложки нет», и «src сломан». */}
      <div className="tc__bg">
        <Cover fill image={trip.cover_image_url} />
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

        {/* trip info: города с SVG-флагами стран (канон CountryFlag/.cflag —
            единственный источник флагов, TRIP-177); стран нет → прежний пин */}
        <div className="tc__title">{trip.title}</div>
        <div className="tc__dates tab">{trip.days}</div>
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

// ─── Строка прошедшего трипа ─────────────────────────────────────────────────
// Канон `<ListRow>` вместо прежней семьи `.tr*` — та была ЧЕТВЁРТОЙ рукописной
// копией строки списка в приложении. Приглушение и «спрятать второстепенное на
// телефоне» тоже канонные оси (`muted`, `trailSub`), а не приватные `.tr--past`
// и `.tr-hideS` с `!important`.
const PastTripRow = ({ trip, onClick }) => (
  <ListRow
    variant="raised"
    muted
    onClick={onClick}
    lead={<Cover image={trip.cover_image_url} />}
    title={<Trunc>{trip.title}</Trunc>}
    sub={
      <Row gap="g4">
        {trip.flags.length > 0
          ? trip.flags.map(cc => <CountryFlag key={cc} code={cc} />)
          : <Icon name="pin" size={12} />}
        <Trunc>{trip.scope}</Trunc>
      </Row>
    }
    trailSub={
      <>
        <span className="t-meta tab">{trip.days}</span>
        {trip.isShared && <TripAvatars members={trip.members} maxShow={2} />}
        {trip.isShared && <RoleBadge role={trip.role} />}
        {trip.pro && <Badge variant="pro" icon="pro">PRO</Badge>}
      </>
    }
    trail={<Icon name="chev" className="muted" />}
  />
);

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
function HomeSkeleton() {
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
      {/* 4. dash-hero: карта | рейл (World Explored ≈150 + Next Trip ≈200) */}
      <div className="dash-hero" style={{ marginTop: 18 }}>
        <Skeleton w="100%" h={380} r={'var(--r-xl)'} />
        <div className="rail">
          <Skeleton w="100%" h={150} r={'var(--r-xl)'} />
          <Skeleton w="100%" h={200} r={'var(--r-xl)'} />
        </div>
      </div>
      {/* 5. Шапка раздела «МОИ ПУТЕШЕСТВИЯ / N путешествий» + поиск справа —
          тот же `.sec-head`/`.sec-actions`, что и в реальном, чтобы колонки
          совпали и содержимое не съехало при подмене скелетона. */}
      <div className="sec-head">
        <div className="grow">
          <Skeleton w={120} h={13} r={5} style={{ marginBottom: 6 }} />
          <Skeleton w={160} h={28} r={'var(--r-sm)'} />
        </div>
        <div className="sec-actions">
          <Skeleton w={300} h={44} r={'var(--r-xl)'} />
        </div>
      </div>
      {/* 6. Заголовок группы «Активные · N» с хвост-линейкой */}
      <div className="sec-head sec-head--group">
        <Skeleton w={150} h={14} r={5} />
        <i className="sec-head__rule" />
      </div>
      {/* 7. Карточки */}
      <TripSkeleton />
    </>
  );
}

function TripSkeleton() {
  return (
    <div className="tc-grid">
      {Array.from({ length: 6 }).map((_, i) => (
        <Skeleton key={i} w="100%" h={256} r={'var(--r-lg)'} />
      ))}
    </div>
  );
}

// ─── Main page ────────────────────────────────────────────────────────────────
export default function Trips() {
  const { t, lang } = useI18n();
  const { user }  = useAuth();
  const nav       = useNavigate();
  const qc        = useQueryClient();
  const confirm   = useConfirm();

  const { isDark, toggle: toggleTheme } = useTheme();

  // Ни `viewMode`, ни `filterMode` больше нет: обе группы живут на одной странице
  // (активные постерами, прошедшие строками), поэтому переключать нечего — а с
  // ними ушли и `localStorage['trips:viewMode']`, и сегмент-контролы.
  const [search, setSearch] = useState('');
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
      const cards = data || [];
      // Раскладываем карточки по их собственным ключам (`['trip-card', id]`).
      // Экран трипа читает СВОЙ ключ и берёт оттуда два факта — ступень и
      // аддоны, — чтобы нарисовать меню сразу, не дожидаясь двери трипа. Это не
      // копия трипа в кэше: карточка — отдельная сущность со своей формой, и в
      // ключ трипа она не пишется (см. `cacheTripCards`).
      cacheTripCards(qc, cards);
      return cards;
    },
    enabled: !!user?.id,
  });

  const hasTrips = allTrips.length > 0;

  // ── Travel-stats reader — верхние виджеты только: stat-bar, map fill/pins,
  // "world explored". Главная берёт ОТСЮДА points и transfers (счётчики режем по
  // pastOnly); карточные слайсы (trips/trip_visits) ушли в getTrips (TRIP-403).
  // Year filtering / aggregates happen client-side (here it's unfiltered).
  const { data: travelStats } = useQuery({
    queryKey: ['travel-stats', user?.id],
    // Общий ридер яруса A (TRIP-402): тот же edge getTravelStats и кэш-ключ, что у
    // «Моей статистики» (Statistics.jsx) — читаем из общего кэша.
    queryFn: async () => {
      const { data, error, code, message } = await invokeFn('getTravelStats');
      // Бросаем исходный error (помечен __seamHandled) — без повторного отчёта.
      if (error || code) throw error || new Error(message || code);
      return data || { points: [], transfers: [] };
    },
    enabled: !!user?.id,
    staleTime: 30_000,
  });
  const statsLoaded    = travelStats !== undefined;
  const statsPoints    = useMemo(() => localizeVisits(travelStats?.points || [], lang), [travelStats, lang]);
  // Полоса статистики и «Мир исследован» отражают ПРОЙДЕННОЕ: считаем только уже
  // начавшиеся визиты/переезды (TRIP-264, `pastOnly`). Карта ниже по-прежнему
  // рисует ВСЕ точки (`statsPoints`), включая запланированные.
  const pastPoints     = useMemo(() => pastOnly(statsPoints), [statsPoints]);
  const transfersTotal = useMemo(() => pastOnly(travelStats?.transfers || []).length, [travelStats]);
  const home  = useMemo(() => homeStats(pastPoints, transfersTotal), [pastPoints, transfersTotal]);
  const world = useMemo(() => worldExplored(pastPoints), [pastPoints]);

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
  // «Идёт поиск» — ОДИН предикат на весь экран: от него зависит и фильтрация, и
  // то, рисуется ли секция вообще (см. рендер ниже).
  const searching = search.trim().length > 0;
  const matches = (tr) => {
    const q = search.trim().toLowerCase();
    return !q || (haystackByTrip[tr.id] || '').includes(q);
  };

  // Trip date range comes from the same computeTripRange used everywhere else:
  // .start = earliest city start_date, .end = latest city end_date.
  const rangeOf = (tr) => computeTripRange(visitsByTrip[tr.id] || []);

  // ОДНО «сегодня» на весь рендер: иначе трип на границе полуночи мог бы попасть
  // в одну группу по списку и в другую по виджету.
  const today = useMemo(() => todayKey(), []);
  const visitsOf = (tr) => visitsByTrip[tr.id] || [];

  // ── Активные ────────────────────────────────────────────────────────────────
  // Порядок задаёт `sortActiveTrips` (идущие по концу → будущие по старту → без
  // дат): он же решает, какой трип попадёт в виджет — тот берёт ГОЛОВУ этого
  // массива и своего отбора не имеет.
  const activeTrips = sortActiveTrips(
    allTrips.filter(tr => !isTripInPast(visitsOf(tr), today) && matches(tr)),
    visitsOf,
    today,
  );

  // ── Прошедшие ───────────────────────────────────────────────────────────────
  // Позже закончившиеся первыми; конец у прошедшего есть всегда (иначе он не
  // прошедший), поэтому проверки на null нет.
  const pastTrips = allTrips
    .filter(tr => isTripInPast(visitsOf(tr), today) && matches(tr))
    .sort((a, b) => new Date(rangeOf(b).end).getTime() - new Date(rangeOf(a).end).getTime());

  const norm = (tr) =>
    normalizeTrip(t, tr, visitsOf(tr), tr.role, isPro, participantsByTrip[tr.id] || [], tr.is_pro);
  const activeNorm = activeTrips.map(norm);

  // Прошедшие сгруппированы по ГОДУ окончания, годы по убыванию. Группировка
  // идёт по уже отсортированному массиву, поэтому внутри года порядок тот же.
  // Без useMemo намеренно: `pastTrips` пересобирается каждый рендер (он зависит
  // от строки поиска), так что мемо не удержало бы ничего и только врало бы.
  const pastByYear = [];
  for (const tr of pastTrips) {
    const year = String(new Date(rangeOf(tr).end).getFullYear());
    const last = pastByYear[pastByYear.length - 1];
    if (last && last.year === year) last.trips.push(norm(tr));
    else pastByYear.push({ year, trips: [norm(tr)] });
  }

  // ── Трип виджета ────────────────────────────────────────────────────────────
  // Голова активной очереди. Идёт → к карточке добавляется `progress` (день/
  // всего/остаток) и город «сейчас»; впереди → обратный отсчёт. Оба факта
  // считают чистые функции из `trip-dates.js`, у виджета своей арифметики нет.
  const heroTrip = useMemo(() => {
    const tr = sortActiveTrips(
      allTrips.filter(x => !isTripInPast(visitsOf(x), today)),
      visitsOf,
      today,
    )[0];
    if (!tr) return null;
    const visits = visitsOf(tr);
    const progress = tripProgress(visits, today);
    const base = { ...tr, scope: scopeLabel(t, visits), days: formatTripRange(visits, '-') };
    if (progress) {
      const now = currentCityVisit(visits, today);
      return { ...base, progress, nowCity: now?.city_name || '', nowCountry: now?.country_code || '' };
    }
    const { start } = computeTripRange(visits);
    // Трип без дат активен, но обратный отсчёт для него не определён — виджет
    // показывает CTA, а не карточку с пустым таймером.
    if (!start) return null;
    // Фаза уже сказала «впереди» (в ДНЯХ), поэтому карточку показываем всегда, а
    // отсчёт в миллисекундах только зажимаем снизу: `start` — это UTC-полночь
    // даты, и в западных таймзонах вечером кануна разница уже отрицательна, хотя
    // по календарю пользователя старт ещё завтра. Минус на этом месте раньше
    // ронял виджет в CTA при живом ближайшем трипе.
    const diff = Math.max(0, new Date(start).getTime() - Date.now());
    return {
      ...base,
      countdown: {
        d: Math.floor(diff / 864e5),
        h: Math.floor((diff % 864e5) / 36e5),
        m: Math.floor((diff % 36e5) / 6e4),
      },
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [allTrips, visitsByTrip, today, t]);

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
    <div className="app-shell">

      {/* APP HEADER */}
      <AppHeader user={user} isPro={isPro} isDark={isDark} onToggleTheme={toggleTheme} />

      {/* PAGE CONTENT */}
      <main style={{ flex: 1, padding: '32px 28px', maxWidth: 1240, margin: '0 auto', width: '100%', boxSizing: 'border-box' }}>

        {/* Loading skeleton */}
        {isLoadingData && allTrips.length === 0 && (
          <HomeSkeleton />
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
              hero={heroTrip}
              onAllStats={() => nav('/stats')}
              onYearReview={() => {
                // Клик по кнопке и есть измеряемое действие — событие шлём до
                // модалки (ждать её закрытия смысла нет). Реюз шва track()
                // (src/lib/analytics.js), имя по конвенции object_action.
                track('year_result');
                // Раздел ещё не готов: показываем канон «в разработке» —
                // EmptyState (плитка-молоток + заголовок + текст) в штатной
                // модалке подтверждения с одной кнопкой «OK».
                confirm({
                  title: t('stats.year_review'),
                  content: (
                    <EmptyState
                      icon="hammer"
                      kind="warning"
                      title={t('stats.year_review')}
                      body={t('stats.year_review_soon')}
                    />
                  ),
                  singleButton: true,
                });
              }}
              onPlan={() => openChoice()}
              onOpenHero={() => heroTrip && nav(`/trip/${heroTrip.id}`)}
              t={t}
              lang={lang}
            />
          </>
        )}

        {/* Empty collection — "Маршрут" itinerary-rail hero below the ghost stats */}
        {!isLoadingData && allTrips.length === 0 && (
          <EmptyRoute onManual={() => startCreate('manual')} onAi={() => startCreate('ai')} />
        )}

        {/* Обе группы на ОДНОЙ странице: активные постерами, прошедшие
            приглушёнными строками по годам. Вкладок и переключателя вида нет. */}
        {allTrips.length > 0 && (
          <>
            {/* Шапка раздела: «МОИ ПУТЕШЕСТВИЯ / N путешествий» + поиск справа.
                На ≤640px `.sec-actions` уже занимает всю ширину (канон), поэтому
                поиск сам уезжает на свою строку — своей раскладки ему не нужно. */}
            <div className="sec-head">
              <Grow>
                <div className="t-label tp-caption" style={{ marginBottom: 6 }}>{t('trips.my_trips_eyebrow')}</div>
                <h2 className="t-title">{pluralize(t, allTrips.length, 'stats.sum_trips', lang, { count: allTrips.length })}</h2>
              </Grow>
              <div className="sec-actions sec-actions--search">
                {/* `.grow` — канон-утилита растяжения: на ≤640px `.sec-actions`
                    занимает всю ширину, и поиск обязан её занять целиком, иначе
                    поле остаётся своей интринсик-ширины (проверено снимком). */}
                <Input
                  className="grow"
                  icon="search"
                  placeholder={t('trips.search_placeholder')}
                  aria-label={t('trips.search_placeholder')}
                  value={search}
                  onChange={e => setSearch(e.target.value)}
                />
              </div>
            </div>

            {/* Поиск ничего не нашёл НИ В ОДНОЙ группе → один общий пустой
                экран вместо пустого состояния внутри секции. Правило секции при
                поиске одно на обе: есть попадания — секция рисуется, нет —
                секции нет вовсе (раньше активные при нуле попаданий рисовали
                свой empty-state, а прошедшие молча исчезали). */}
            {searching && activeNorm.length === 0 && pastByYear.length === 0 ? (
              <EmptyState icon="search" title={t('trips.empty_search_title')} body={t('trips.empty_search_body')} />
            ) : (
              <>
                {/* ── Активные ──────────────────────────────────────────────
                    При поиске секция живёт только с попаданиями; без поиска она
                    есть всегда — там у неё своё приглашение (прошлые есть,
                    активных нет), и это НЕ результат поиска. */}
                {(!searching || activeNorm.length > 0) && (
                  <>
                    <div className="sec-head sec-head--group">
                      <Icon name="suitcase" />
                      <span className="t-micro">{t('trips.tab_active')}</span>
                      <span className="t-micro num">{activeNorm.length}</span>
                      <i className="sec-head__rule" />
                    </div>

                    {/* Плашка Free-лимита — над активными, как и была. */}
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
                      <TripSkeleton />
                    ) : activeNorm.length > 0 ? (
                      <div className="tc-grid">
                        {activeNorm.map(tr => (
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
                      // Активных нет, а прошлые есть → приглашение, а не пустой экран.
                      // Кнопки «Показать прошедшие» больше нет: группа прямо под этой.
                      <Card radius="lg" className="row invite">
                        <Tile as="span" className="invite__ic"><Icon name="sparkles" size={28} /></Tile>
                        <div className="invite__tx">
                          <h3>{t('trips.invite_title')}</h3>
                          <p>{t('trips.invite_desc')}</p>
                        </div>
                        <div className="row row--wrap invite__act">
                          <Btn variant="primary" icon="plus" onClick={() => openChoice()}>{t('trips.invite_create')}</Btn>
                        </div>
                      </Card>
                    )}
                  </>
                )}

                {/* ── Прошедшие ────────────────────────────────────────────────
                    Своего пустого состояния у группы НЕТ — ни при поиске, ни без
                    него: прошедших нет (или поиск в них ничего не нашёл) — нет и
                    самой группы. */}
                {!isLoadingData && pastByYear.length > 0 && (
                  <>
                    <div className="sec-head sec-head--group">
                      <Icon name="calendar" />
                      <span className="t-micro">{t('trips.tab_past')}</span>
                      <span className="t-micro num">{pastTrips.length}</span>
                      <i className="sec-head__rule" />
                    </div>
                    {pastByYear.map(({ year, trips }) => (
                      <Col key={year} gap="g1">
                        <div className="sec-head sec-head--group sec-head--sub">
                          <span className="t-micro">{year}</span>
                          <i className="sec-head__rule" />
                        </div>
                        <Col gap="g3">
                          {trips.map(tr => (
                            <PastTripRow key={tr.id} trip={tr} onClick={() => nav(`/trip/${tr.id}`)} />
                          ))}
                        </Col>
                      </Col>
                    ))}
                  </>
                )}
              </>
            )}
          </>
        )}
      </main>
    </div>
  );
}
