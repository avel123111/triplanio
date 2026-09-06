import React, { useMemo, useState, useEffect, useRef } from 'react';
import { useParams, useNavigate, useSearchParams } from 'react-router-dom';
import { useQuery, useQueryClient } from '@tanstack/react-query';

import { useAuth } from '@/lib/AuthContext';
import { TRIP_CARD_KEY, invalidateTripData } from '@/lib/trip-data';
import { tripShellQuery, tripContentQuery } from '@/lib/invokeTripFn';
import { goPro } from '@/lib/goPro';
import { useQueryGate } from '@/lib/useQueryGate';
import TripLoadError from '@/components/trips/TripLoadError';
import PageNotFound from '@/lib/PageNotFound';
import { naiveDayKey, parseNaive, formatNaive } from '@/lib/naive-time';
import { durationMinutes, formatMinutes, transferDuration } from '@/lib/time';
import { formatTripRange } from '@/lib/trip-dates';
import { useIsPhone } from '@/hooks/use-mobile';
import { useTripProStatus } from '@/lib/subscription';
import { proRole } from '@/lib/proUpsell';
import { useProUpsell } from '@/components/common/ProUpsellProvider';
import { getAddons, isAddonEnabled, normalizeAddons } from '@/lib/tripAddons';
import { DEFAULT_SECTION, isSectionAvailable, resolveSection, sectionById } from '@/lib/tripMenu';
import TripShell from '@/components/trips/TripShell';
import TripShareFlow from '@/components/trips/TripShareFlow';
import { Icon } from '../design/icons';
import { Btn, Card, Dialog, EmptyState, MapShell, Skeleton, Tile, fmtDate, weekdayLong, StreamEventRow, BookingWarning, TimelineEmptyDay, useToast } from '../design/index';
import TripAccessError from '@/components/trips/TripAccessError';
import { TripAccessProvider } from '@/components/trips/TripAccessContext';
import { sortVisits, sameCity } from '@/lib/validation';
import { loadDismissed, serializeDismissed, storageKey as dismissedStorageKey, transferWarnKey, hotelWarnKey } from '@/lib/warningDismissals';
import { cityNeedsHotel, cityNights, hotelCoversCity } from '@/lib/trip-preparation';
import { useConfirm } from '@/components/common/ConfirmProvider';
import { DateTime } from 'luxon';
import EventEditDialog from '@/components/common/EventEditDialog';
import SourceViewLoader from '../components/budget/SourceViewLoader';
import EventDrawerHost from '@/components/common/EventDrawerHost';
import EventSourcePanel from '@/components/common/EventSourcePanel';
import AddBookingPanel from '@/components/bookings/AddBookingPanel';
import { useStay22Bundle } from '@/lib/stay22';
import ForkPartnerModal from '@/components/bookings/ForkPartnerModal';
import ErrorBoundary from '@/components/ErrorBoundary';
import { useMobileNav } from '@/components/MobileBottomNav';
import OverviewLens from './OverviewLens';
import BudgetLens, { AddExpenseDialog, AddCategoryDialog } from './BudgetLens';
import MembersLens, { InviteDialog } from './MembersLens';
import CalendarLens from './CalendarLens';
import DocsLens, { AddDocDialog } from './DocsLens';
import SettingsLens from './SettingsLens';
import EditLens from './EditLens';
import ChatLens from './ChatLens';
import { budgetCategoryOptions } from '@/lib/budget/constants';
import { uniqueCityCount, localizeVisits } from '@/lib/trip-cities';
import { tripDuration } from '@/lib/trip-stats';
import { resolveMyRole, countTripMembers } from '@/lib/members';
import { clearsStep } from '@/lib/tripStep';
import { useProfileMap } from '@/lib/useProfileMap';
import { resolveOwnerName } from '@/lib/resolveAuthor';
import { track, groupTrip } from '@/lib/analytics';
import ChatWidget from '@/components/chat/ChatWidget';
import { useI18n } from '@/lib/i18n/I18nContext';
import { pluralize } from '@/lib/i18n/format';

// Событие открытия секции (TRIP-213 Ф2c — по одному на секцию, чтобы было видно,
// что именно открыли) живёт в реестре секций рядом с самой секцией: отдельной
// картой оно было ещё одним списком, который надо не забыть.

// ─── helpers ──────────────────────────────────────────────────────────────────

function cityForVisit(visitId, visits) {
  const v = visits.find(v => v.id === visitId);
  return v ? v.city_name : null;
}

export function buildEventStream(t, hotels = [], activities = [], transfers = [], visits = [], services = []) {
  const events = [];

  // Car-rental services (kind='car_rental') become two point events on the
  // timeline: pickup + return (their local datetimes drive placement).
  for (const s of (services || [])) {
    if (s.kind !== 'car_rental') continue;
    const name = s.name || t('service.kind.car_rental');
    const pickup = s.pickup_at_local || s.details?.pickup_at_local;
    const dropoff = s.dropoff_at_local || s.details?.dropoff_at_local;
    if (pickup) {
      events.push({
        type: 'car-pickup', id: s.id,
        date: naiveDayKey(pickup), time: formatNaive(pickup, 'HH:mm'),
        title: name, address: s.pickup_address || s.details?.pickup_address || '',
        price: s.price ?? null, cur: s.currency,
        _ms: parseNaive(pickup)?.toMillis() ?? 0,
      });
    }
    if (dropoff) {
      events.push({
        type: 'car-return', id: s.id,
        date: naiveDayKey(dropoff), time: formatNaive(dropoff, 'HH:mm'),
        title: name, address: s.dropoff_address || s.details?.dropoff_address || '',
        price: null, cur: s.currency,
        _ms: parseNaive(dropoff)?.toMillis() ?? 0,
      });
    }
  }

  for (const h of hotels) {
    const city = h.city_name || cityForVisit(h.city_visit_id, visits) || '';
    if (h.check_in_datetime) {
      events.push({
        type: 'hotel-checkin',
        id: 'h-in-' + h.id,
        cityVisitId: h.city_visit_id,
        date: naiveDayKey(h.check_in_datetime),
        time: formatNaive(h.check_in_datetime, 'HH:mm'),
        city,
        title: t('trip.hotel_check_in') + ' · ' + h.name,
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
        cityVisitId: h.city_visit_id,
        date: naiveDayKey(h.check_out_datetime),
        time: formatNaive(h.check_out_datetime, 'HH:mm'),
        city,
        title: t('trip.hotel_check_out') + ' · ' + h.name,
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
        cityVisitId: h.city_visit_id,
        date: naiveDayKey(h.free_cancellation_until),
        time: formatNaive(h.free_cancellation_until, 'HH:mm'),
        city,
        title: t('trip.hotel_free_cancel') + ' · ' + h.name,
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
      duration: formatMinutes(durationMinutes(a.start_datetime, a.end_datetime), t),
      // Naive clock end (HH:mm) — used by the calendar week-view to size blocks
      // by real duration instead of a fixed guess. `endDate` is the DAY of that
      // end: without it an interval crossing midnight cannot be drawn (HH:mm
      // alone says "07:00" and not "07:00 of which day").
      endTime: a.end_datetime ? formatNaive(a.end_datetime, 'HH:mm') : null,
      endDate: naiveDayKey(a.end_datetime),
      _ms: parseNaive(a.start_datetime)?.toMillis() ?? 0,
    });
  }

  for (const tr of transfers) {
    const kind = tr.transport_type || tr.kind || 'car';
    const isPlane = kind === 'plane';
    // The transfer plaque renders in its DEPARTURE day. With an explicit
    // start_datetime that's its own day; without one (e.g. created via the
    // ManualPlanner transport step) anchor to the from-visit's last day - the
    // day you leave - falling back to the to-visit's arrival day only when there
    // is no dated from-city (e.g. a leg out of the dateless start anchor).
    const explicitDate = naiveDayKey(tr.start_datetime);
    const toVisit = visits.find(v => v.id === tr.to_city_visit_id);
    const fromVisit = visits.find(v => v.id === tr.from_city_visit_id);
    const fallbackDate = (fromVisit && naiveDayKey(fromVisit.end_date))
      || (toVisit && naiveDayKey(toVisit.start_date))
      || null;
    const eventDate = explicitDate || fallbackDate;
    const eventMs = parseNaive(tr.start_datetime)?.toMillis()
      ?? parseNaive(fromVisit?.end_date)?.toMillis()
      ?? parseNaive(toVisit?.start_date)?.toMillis()
      ?? 0;
    events.push({
      type: isPlane ? 'flight' : 'transfer',
      id: tr.id,
      date: eventDate,
      time: formatNaive(tr.start_datetime, 'HH:mm'),
      title: tr.carrier || (isPlane ? t('trip.tl_flight') : t('trip.tl_transfer')),
      from: fromVisit?.city_name || tr.from_address,
      to: toVisit?.city_name || tr.to_address,
      from_address: tr.from_address || null,
      to_address: tr.to_address || null,
      kind,
      carrier: tr.carrier,
      num: tr.booking_reference,
      price: tr.price,
      cur: tr.currency,
      platformUrl: tr.booking_url,
      duration: transferDuration(tr, fromVisit, toVisit, t),
      endTime: tr.end_datetime ? formatNaive(tr.end_datetime, 'HH:mm') : null,
      // Day of arrival — a night flight ends on the NEXT day, and the calendar
      // draws it in both (see `lib/calendar-spans.js`).
      endDate: naiveDayKey(tr.end_datetime),
      _ms: eventMs,
    });
  }

  // Carry the optimistic-pending flag from the source booking onto its timeline
  // event(s), so a just-created booking renders dimmed until the write reconciles
  // (the row still carries `_pending` — swap on success clears it). Hotel events
  // embed hotelId; the others use the source id directly as e.id.
  const pending = {
    hotel:    new Set(hotels.filter(h => h._pending).map(h => h.id)),
    activity: new Set(activities.filter(a => a._pending).map(a => a.id)),
    transfer: new Set(transfers.filter(tr => tr._pending).map(tr => tr.id)),
    service:  new Set((services || []).filter(s => s._pending).map(s => s.id)),
  };
  for (const e of events) {
    if (e.hotelId) e._pending = pending.hotel.has(e.hotelId);
    else if (e.type === 'activity') e._pending = pending.activity.has(e.id);
    else if (e.type === 'transfer' || e.type === 'flight') e._pending = pending.transfer.has(e.id);
    else if (e.type === 'car-pickup' || e.type === 'car-return') e._pending = pending.service.has(e.id);
  }

  return events
    .filter(e => e.date)
    .sort((a, b) => a._ms - b._ms);
}

// ─── LoadingScreen / ErrorScreen ──────────────────────────────────────────────

// Тело экрана на время загрузки shell-запроса. Оболочку (шапку со скелетонами
// названия/меты и скелетон меню) держит TripShell — она одна и та же для
// загруженного и грузящегося экрана, поэтому при резолве ничего не перекладывается.
//
// Скелетон ЗНАЕТ СЕКЦИЮ: у обзора и чата свои заглушки, иначе на их месте
// мигала бы лента (плюс правый рейл, которого у чата нет вовсе).
// ★ ЕДИНЫЙ ПУТЬ РЕНДЕРА (TRIP-337, двойная загрузка). Прежде был отдельный
// РАННИЙ return для фазы shell (`<TripShell loading><LoadingBody/></TripShell>`),
// а основной return — для фазы content. В позиции тела ТИП компонента менялся
// (LoadingBody → секция), поэтому React РАЗМОНТИРОВАЛ поддерево и МОНТИРОВАЛ
// заново — скелетон перезапускался, а меню менялось skeleton→real, отсюда прыжок
// «2 раза». `LoadingBody` УДАЛЁН: теперь секция монтируется ОДИН раз в основном
// рендере и живёт через все фазы, только `isLoading` идёт true→false НА МЕСТЕ —
// без размонтирования, без прыжка. Скелетон каждой секции — её собственный
// экспорт (`<BudgetSkeleton/>` и т.д.), тот же компонент до и после загрузки.

// ─── TripHeader ───────────────────────────────────────────────────────────────



// ─── TimelineLens ─────────────────────────────────────────────────────────────

function SkeletonTimeline() {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 18 }}>
      {[1, 2, 3].map(g => (
        <div key={g}>
          <Skeleton w={120} h={14} r={6} style={{ marginBottom: 12 }} />
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            {[1, 2].map(i => (
              /* TRIP-343 объект 2 (канал 3): скин поверхности снят с инлайна на Card. */
              <Card key={i} radius="md" pad="none" style={{ padding: '12px 14px', display: 'flex', gap: 14, alignItems: 'center' }}>
                <Skeleton w={52} h={16} r={4} />
                <Skeleton w={32} h={32} r={'var(--r-sm)'} />
                <div style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: 6 }}>
                  <Skeleton w="60%" h={13} r={4} />
                  <Skeleton w="40%" h={11} r={4} />
                </div>
              </Card>
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}

// Right-rail (Services) placeholder — budget/who's-going moved to the Overview
// screen, so the timeline rail now skeletons only the Services widget.
function RightRailSkeleton() {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
      <Skeleton w="100%" h={150} r={'var(--r-btn)'} />
    </div>
  );
}

// ── Объявление изменений для гарда 2p (визуальный дифф CSS) ──────────────────
// Скелетон перестал размечаться под снесённую раскладку редактора, и вместе с
// ним ушли последние мобильные правила той раскладки: без разметки они были бы
// осиротевшими (их бы потребовал снести гард 2n).
// visual-diff-exempt: .ts-grid {@media (max-width: 640px)} grid-template-columns — правило снесённой раскладки редактора, разметки под него не осталось
// visual-diff-exempt: .ts-col-right {@media (max-width: 640px)} display — то же, вторая половина того же мёртвого правила
//
// Скелетон структурного редактора — ОДИН на обе фазы загрузки (shell и content).
//
// ★ РИСУЕТ ТУ ЖЕ РАСКЛАДКУ, ЧТО И САМ РЕДАКТОР, — ОБЩИЙ <MapShell>. До этого он
// был СИРОТОЙ: размечен под `.ts-grid` / `.ts-leftscroll`, то есть под две
// колонки, снесённые в TRIP-422 вместе со второй рукописной копией раскладки.
// Правил у этих имён не осталось (`.ts-grid` вычислялся `display: block`), и
// кадр загрузки выходил не «редактор без данных», а другой экран: ряды во всю
// ширину и карты нет вовсе. Ни один гард этого не видел — 2n ловит осиротевшее
// ПРАВИЛО, а тут осиротела РАЗМЕТКА, обратное направление.
//
// Карту тут отдаём ПУСТЫМ слотом, а не живой поверхностью: инстанс mapbox один
// на всё приложение (MapProvider), и двух живых поверхностей одновременно быть
// не может. Слот и без канваса красит подложку (`--map-backdrop`) — ровно то,
// что видно, пока не пришли тайлы.
//
// ★ ДЕТЕНТ И СВОРАЧИВАНИЕ ОБЪЯВЛЕНЫ ЯВНО, И ЭТО НЕ УКРАШЕНИЕ. Оба состояния
// принадлежат ВИДЖЕТУ, а не данным в нём, поэтому кадр загрузки обязан открыть
// его там же, где откроет редактор. Промолчав, скелетон брал дефолт примитива
// (детент 0 = 15%) и на телефоне показывал шит полоской, которая прыгала на 68%
// в момент приезда content'а, — то есть ровно тот шов, который эта задача
// убирает на десктопе. Кнопка сворачивания на шве по той же причине: без
// `onCollapsedChange` шелл её не рисует вовсе, и она «выщёлкивалась» бы при
// смене скелетона на редактор.
function EditSkeleton() {
  const { t } = useI18n();
  const [detent, setDetent] = useState(1);
  const [collapsed, setCollapsed] = useState(false);
  return (
    <MapShell
      /* Тот же ключ, что у готовой секции (`trip.sidebar_route`): скелетон и
         экран обязаны называться одинаково, иначе подпись меняется на глазах
         в момент загрузки. */
      panelLabel={t('trip.sidebar_route')}
      map={null}
      detent={detent}
      onDetentChange={setDetent}
      collapsed={collapsed}
      onCollapsedChange={setCollapsed}
      collapseLabel={t('tse.route_hide')}
      expandLabel={t('tse.route_show')}
      panelHeader={(
        <div className="col col--g2">
          <Skeleton w={160} h={26} r={6} />
          <Skeleton w={210} h={12} r={5} />
        </div>
      )}
      panel={(
        <div className="te-panefade">
          {/* Граница реюза проведена по КОРОБКЕ и РИТМУ, и она намеренная.
              `.te-panefade` (обёртка выше) берём ОСОЗНАННО: это коробка тела
              виджета — отступы, скролл и появление, — и именно от неё отступы
              кадра загрузки совпадают с рабочими. А вот РИТМ РЯДОВ собран общими
              утилитами, а не `.te-table` / `.te-seamwrap`: те держат сетку колонок
              редактора и зазоры его списка, то есть приватное устройство того,
              чего в скелетоне нет. Дотянувшись туда, он ломался бы от каждой
              правки редактора — ровно так он и осиротел в прошлый раз. */}
          <div className="col col--g3">
            {[1, 2, 3, 4].map((i) => (
              <Card key={i} radius="md" className="row row--g6">
                <Skeleton w={36} h={36} r={'var(--r-sm)'} />
                <div className="grow col col--g2">
                  <Skeleton w="50%" h={14} r={5} />
                  <Skeleton w="30%" h={11} r={5} />
                </div>
                <Skeleton w={90} h={30} r={'var(--r-pill)'} />
              </Card>
            ))}
          </div>
        </div>
      )}
    />
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

// ─── StreamAnchor ─────────────────────────────────────────────────────────────

function StreamAnchor({ label, sub, color, icon }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 14, margin: '16px 0', paddingLeft: 8 }}>
      <Tile as="div" round style={{ '--tile': '28px', '--tile-ic': '13px', '--hl-soft': color, '--hl-ink': 'white' }}>
        <Icon name={icon} size={13} />
      </Tile>
      <div>
        <div className="t-label">{label}</div>
        {sub && <div className="muted t-meta">{sub}</div>}
      </div>
    </div>
  );
}

// Персональные скрытия варнингов этого устройства (решение Pavel 2026-08-26:
// localStorage, не БД — память браузера, consent не при чём). Чистая логика —
// в lib/warningDismissals (там же тесты); тут — только Set в состоянии и поход
// в storage под try/catch: приватный режим деградирует к «скрыто до
// перезахода», как было. Прюнинг мёртвых визитов и кэп — на КАЖДОЙ записи.
const readDismissed = (tripId) => {
  try { return loadDismissed(localStorage.getItem(dismissedStorageKey(tripId))); }
  catch { return new Set(); }
};

function useDismissedWarnings(tripId, visits) {
  const [dismissed, setDismissed] = useState(() => readDismissed(tripId));
  // tripId на первом рендере ленты может быть ещё пуст (shell грузится) —
  // перечитываем, когда он появился/сменился.
  useEffect(() => { setDismissed(readDismissed(tripId)); }, [tripId]);
  const dismiss = (key) => setDismissed((prev) => {
    const next = new Set(prev).add(key);
    try {
      localStorage.setItem(
        dismissedStorageKey(tripId),
        JSON.stringify(serializeDismissed(next, visits.map((v) => v.id))),
      );
    } catch { /* storage недоступен — скрытие живёт до перезахода */ }
    return next;
  });
  return { dismissed, dismiss };
}

// ─── TimelineLens ─────────────────────────────────────────────────────────────

function TimelineLens({ stream, visits, transfers, hotels, trip, isLoading, onAddTransfer, onAddHotel, onAddActivityForDay, onEditVisitNotes, onOpenEvent, onDeleteCity }) {
  const { t, lang } = useI18n();
  const { dismissed, dismiss } = useDismissedWarnings(trip?.id, visits);
  const confirm = useConfirm();
  // Крестик варнинга — через канон-confirm (просьба Pavel 2026-08-26): скрытие
  // персистентно для устройства, поэтому случайный тап дороже одного лишнего
  // вопроса. Копия — в стиле confirm.* («Вы уверены, что хотите…»).
  const confirmDismiss = async (key, body) => {
    if (await confirm({
      title: t('confirm.hide_warning.title'),
      description: body,
      confirmLabel: t('confirm.hide_warning.action'),
    })) dismiss(key);
  };

  // Auto-scroll to today's day when the timeline opens — but only if today falls
  // inside the rendered range (otherwise the #tlday element doesn't exist and
  // this is a no-op). Runs once per mount, after the day rows have painted.
  const didScrollTodayRef = useRef(false);
  useEffect(() => {
    if (didScrollTodayRef.current) return;
    const n = new Date();
    const todayKey = `${n.getFullYear()}-${String(n.getMonth() + 1).padStart(2, '0')}-${String(n.getDate()).padStart(2, '0')}`;
    const el = document.getElementById(`tlday-${todayKey}`);
    if (!el) return;
    didScrollTodayRef.current = true;
    requestAnimationFrame(() => el.scrollIntoView({ behavior: 'smooth', block: 'start' }));
  }, [isLoading, stream, visits]);

  if (isLoading) return <SkeletonTimeline />;

  // Show missing-transfer / missing-hotel hints only when (a) the trip-level
  // toggle is on (default on) AND (b) the current user can act on them. Viewers
  // (Зрители) never see them - they can't add bookings, so it's just noise that
  // exposes planning gaps.
  // Варнинги «нет переезда» показываем ВСЕМ, включая наблюдателя (TRIP-274 Ф2.2):
  // не прячем контент по роли, а блокируем ДЕЙСТВИЕ (кнопка добавления замьючена).
  const showBookingWarnings = trip?.details?.display?.booking_warnings !== false;

  if (!visits.length) {
    return (
      <EmptyState
        icon="list"
        title={t('trip.timeline_empty_title')}
        body={t('trip.timeline_empty_desc')}
      />
    );
  }

  // Determine timeline bounds. Start/end anchors are pure markers and have
  // no datetimes - derive the trip range from the first/last TRANSIT visit
  // (the cities the user actually stays in).
  const datedTransits = sortVisits(visits)
    .filter(v => v.kind !== 'start' && v.kind !== 'end' && v.start_date && v.end_date);
  const transitStart = datedTransits.length ? naiveDayKey(datedTransits[0].start_date) : null;
  const transitEnd = datedTransits.length ? naiveDayKey(datedTransits[datedTransits.length - 1].end_date) : null;
  const tripStart = transitStart || null;
  const tripEnd = transitEnd || null;

  if (!tripStart || !tripEnd) {
    return (
      <EmptyState
        icon="list"
        title={t('trip.no_dates_title')}
        body={t('trip.no_dates_desc')}
      />
    );
  }

  // Build event lookup by date
  const eventsByDate = {};
  for (const e of stream) {
    if (!eventsByDate[e.date]) eventsByDate[e.date] = [];
    eventsByDate[e.date].push(e);
  }

  const days = buildDayList(tripStart, tripEnd);

  // Sort visits using kind field (start anchor → transit cities → end anchor),
  // via sortVisits logic from validation.js
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
  // directly above it (a single source of order, no per-day visit lookup that
  // could diverge from it). Anchors are rendered separately as StreamAnchor.
  const transitCities = ordered.filter(v => v.kind !== 'start' && v.kind !== 'end');

  const hasTransferBetween = (prev, city) =>
    !!prev && (inboundByVisit[city.id] || []).some(tr => tr.from_city_visit_id === prev.id);

  // Transfer plaques now render inline in their own DEPARTURE day (buildEvent
  // Stream sets `date` = departure day). They are no longer pulled into the
  // arrival block, so nothing is excluded from the day stream.
  const inboundEventIds = new Set();

  // «Нет отеля»: город с ночёвкой, который не покрывает ни одна бронь. Предикаты
  // общие с виджетом «Подготовка» (`lib/trip-preparation.js`).
  const cityMissesHotel = (c) =>
    cityNeedsHotel(c) && !(hotels || []).some(h => hotelCoversCity(h, c));
  // Через `plural()`: ручной тернарник `n < 5` давал «21 ночей». Тот же тернарник
  // ещё в FlowMap, ManualPlanner ×3, EventViewBody — отдельный PR.
  const nightsWord = (n) => pluralize(t, n, 'view.nights', lang);

  // Renders one city's arrival block: the missing-transfer warning, then the
  // missing-hotel warning. `prev` = the previously-rendered city (or start
  // anchor). The transfer plaque itself renders in its own departure day (in
  // the day stream), not above the destination city.
  // Кнопка «Добавить» варнинга ОТКРЫВАЕТ форк (partner offerings,
  // initialTab='find') — viewer её видит и жмёт; блок стоит на СОЗДАНИИ внутри
  // (Save движка), не тут.
  const renderArrival = (city, prev) => {
    const out = [];
    if (!showBookingWarnings) return out;
    const tKey = prev ? transferWarnKey(prev.id, city.id) : null;
    if (prev && !sameCity(prev, city) && !hasTransferBetween(prev, city)
        && !dismissed.has(tKey)) {
      out.push(
        <BookingWarning
          key={`mt-${city.id}`} kind="transfer"
          title={t('trip.no_transfer')} sub={`${prev.city_name} → ${city.city_name}`}
          onAdd={() => onAddTransfer?.(prev, city)}
          onDismiss={() => confirmDismiss(tKey, t('confirm.hide_warning.transfer_body', { from: prev.city_name, to: city.city_name }))}
        />
      );
    }
    // Отель — ОДИН варнинг на город, в его первый день, ниже переезда
    // (порядок «сначала переезд, потом отель» — решение Pavel 2026-08-26).
    const hKey = hotelWarnKey(city.id);
    if (cityMissesHotel(city) && !dismissed.has(hKey)) {
      const nights = cityNights(city);
      out.push(
        <BookingWarning
          key={`mh-${city.id}`} kind="hotel"
          title={t('trip.no_hotel')}
          sub={`${city.city_name} · ${formatTripRange([city], '–')} · ${nights} ${nightsWord(nights)}`}
          onAdd={() => onAddHotel?.(city)}
          onDismiss={() => confirmDismiss(hKey, t('confirm.hide_warning.hotel_body', { city: city.city_name }))}
        />
      );
    }
    return out;
  };

  // Out-of-range event days. An event whose date falls before the first trip
  // day or after the last (e.g. a free-cancellation deadline that lands days
  // before the trip starts) has no bucket in `days` and would be silently
  // dropped. Render it as its own plain day block - pre-trip days above the
  // start anchor, post-trip days after the end anchor - so the event's own day
  // shows, then the start city, then the trip days.
  const tripDaySet = new Set(days);
  const outOfRangeDays = [...new Set(
    stream.map(e => e.date).filter(d => d && !tripDaySet.has(d))
  )].sort();
  const preTripDays = outOfRangeDays.filter(d => d < tripStart);
  const postTripDays = outOfRangeDays.filter(d => d > tripEnd);

  const renderEventsDay = (day) => {
    const evs = (eventsByDate[day] || []).filter(e => !inboundEventIds.has(e.id));
    if (evs.length === 0) return null;
    const dd = new Date(`${day}T00:00`);
    const dayNum = Number.isNaN(dd.getTime()) ? day.slice(8, 10) : dd.getDate();
    const monAbbr = Number.isNaN(dd.getTime()) ? '' : dd.toLocaleDateString(lang, { month: 'short' }).replace('.', '');
    return (
      <div key={`xday-${day}`} id={`tlday-${day}`} data-tlday={day} className="tl3-day">
        <div className="tl3-dh">
          <span className="datechip"><span className="d">{dayNum}</span><span className="m">{monAbbr}</span></span>
          <span className="wd">{weekdayLong(day, lang)}</span>
        </div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          {evs.map((e, idx) => (
            <StreamEventRow key={e.id} e={e} last={idx === evs.length - 1} onClick={() => onOpenEvent?.(e)} />
          ))}
        </div>
      </div>
    );
  };

  const rows = [];
  const _tnow = new Date();
  const todayKey = `${_tnow.getFullYear()}-${String(_tnow.getMonth() + 1).padStart(2, '0')}-${String(_tnow.getDate()).padStart(2, '0')}`;
  // Running predecessor across the whole itinerary walk (seed = start anchor).
  let prevCity = ordered[0]?.kind === 'start' ? ordered[0] : null;

  // Pre-trip event days (e.g. a cancellation deadline before the trip starts).
  for (const d of preTripDays) rows.push(renderEventsDay(d));

  // Start anchor
  const startCity = ordered[0]?.city_name || t('ai_plan.start_badge');
  const endCity   = ordered[ordered.length - 1]?.city_name || t('ai_plan.end_badge');
  rows.push(
    <StreamAnchor
      key="anchor-start"
      label={t('trip.start_city', { city: startCity })}
      sub={fmtDate(tripStart, lang)}
      color="var(--brand)"
      icon="flag"
    />
  );

  for (const day of days) {
    // All transit cities ARRIVING this day (by start day), in itinerary order.
    // Multiple cities can arrive the same day (e.g. a one-day pass-through that
    // shares its single day with the previous and next city).
    const arrivingToday = transitCities.filter(c => naiveDayKey(c.start_date) === day);

    // Header cities = every real (non-waypoint) transit city whose range covers
    // this day, in itinerary order. Most days have one; a pass-through/transition
    // day can list two (e.g. "Madrid · Barcelona"). Waypoints (0-night layovers)
    // are intentionally excluded from the header.
    const dayCities = transitCities.filter(c => {
      if (c.kind === 'waypoint') return false;
      const s = naiveDayKey(c.start_date), e = naiveDayKey(c.end_date);
      return s && e && day >= s && day <= e;
    });
    // data-city drives the CityRail active-state observer → point it at the
    // current (last) real city of the day so it maps to a rail station.
    const dayCity = dayCities[dayCities.length - 1] || null;

    const allDayEvents = eventsByDate[day] || [];
    const dayEvents = allDayEvents.filter(e => !inboundEventIds.has(e.id));

    const _dd = new Date(`${day}T00:00`);
    const _dayNum = Number.isNaN(_dd.getTime()) ? day.slice(8, 10) : _dd.getDate();
    const _monAbbr = Number.isNaN(_dd.getTime()) ? '' : _dd.toLocaleDateString(lang, { month: 'short' }).replace('.', '');
    const _isToday = day === todayKey;
    rows.push(
      <div key={`day-${day}`} id={`tlday-${day}`} data-tlday={day} data-city={dayCity?.id || ''} className={`tl3-day${_isToday ? ' today' : ''}`}>
        {/* Date header — datechip on the left; weekday on the first line, the
            day's real cities (waypoints excluded) tucked underneath. */}
        <div className="tl3-dh">
          <span className="datechip"><span className="d">{_dayNum}</span><span className="m">{_monAbbr}</span></span>
          <div className="tl3-dhx">
            <div className="tl3-dhrow">
              <span className="wd">{weekdayLong(day, lang)}</span>
              {_isToday && <span className="badge badge--xs badge--brand">{t('view.today')}</span>}
            </div>
            {dayCities.length > 0 && (
              <span className="daycity"><Icon name="pin" size={13} />{dayCities.map(c => c.city_name).join(' · ')}</span>
            )}
          </div>
        </div>

        {/* Intra-day order = chronological. Each arriving city's block (the
            missing-transfer / missing-hotel warnings) is anchored to the city's
            start. Day events earlier than the first arrival anchor render ABOVE
            the block(s); the rest render below. This keeps e.g. a hotel checkout
            (11:00) above a same-day onward flight (12:20) instead of being
            forced under the new city's warnings. Arrival blocks keep their
            itinerary order, which drives the prevCity transfer/warning pairing. */}
        {(() => {
          const blocks = arrivingToday.map(c => ({
            // The arrival block (warnings only) anchors at the city's start; the
            // transfer plaque no longer lives here.
            anchorMs: parseNaive(c.start_date)?.toMillis() ?? Number.NEGATIVE_INFINITY,
            city: c,
          }));
          const firstAnchorMs = blocks.length
            ? Math.min(...blocks.map(b => b.anchorMs))
            : Number.POSITIVE_INFINITY;
          const sorted = [...dayEvents].sort((a, b) => (a._ms ?? 0) - (b._ms ?? 0));
          const beforeEvents = sorted.filter(e => (e._ms ?? 0) < firstAnchorMs);
          const afterEvents = sorted.filter(e => (e._ms ?? 0) >= firstAnchorMs);
          const blockNodes = blocks.flatMap(b => {
            const n = renderArrival(b.city, prevCity);
            prevCity = b.city;
            return n;
          });
          const eventList = (list, mb) => (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8, ...(mb ? { marginBottom: 8 } : null) }}>
              {list.map((e, idx) => (
                <StreamEventRow key={e.id} e={e} last={idx === list.length - 1} onClick={() => onOpenEvent?.(e)} />
              ))}
            </div>
          );
          const hasAny = beforeEvents.length || afterEvents.length || blockNodes.length;
          return (
            <>
              {beforeEvents.length > 0 && eventList(beforeEvents, true)}
              {blockNodes}
              {afterEvents.length > 0 && eventList(afterEvents, false)}
              {/* Empty-day placeholder (B1): действие ведёт в создание
                  активности с предзаполненным днём. */}
              {!hasAny && (
                <TimelineEmptyDay
                  label={dayCity
                    ? t('view.empty_day', { city: dayCity.city_name })
                    : t('view.empty_day_nocity')}
                  actionLabel={t('activity.add')}
                  onAdd={() => onAddActivityForDay?.(day)}
                />
              )}
            </>
          );
        })()}
      </div>
    );
  }

  // Leg INTO the finish anchor (last rendered city → end). If a transfer covers
  // it, render the transfer card(s); otherwise show the missing-transfer warning.
  const endVisit = ordered[ordered.length - 1];
  if (endVisit && endVisit.kind === 'end' && prevCity && prevCity.id !== endVisit.id
      && !sameCity(prevCity, endVisit)) {
    // The transfer into the finish anchor renders in its own departure day now;
    // here we only surface the missing-transfer warning when there is none.
    const endKey = transferWarnKey(prevCity.id, endVisit.id);
    if (!hasTransferBetween(prevCity, endVisit) && showBookingWarnings && !dismissed.has(endKey)) {
      rows.push(
        <BookingWarning
          key="mt-end" kind="transfer"
          title={t('trip.no_transfer')} sub={`${prevCity.city_name} → ${endVisit.city_name}`}
          onAdd={() => onAddTransfer?.(prevCity, endVisit)}
          onDismiss={() => confirmDismiss(endKey, t('confirm.hide_warning.transfer_body', { from: prevCity.city_name, to: endVisit.city_name }))}
        />
      );
    }
  }

  // End anchor
  rows.push(
    <StreamAnchor
      key="anchor-end"
      label={t('trip.finish_city', { city: endCity })}
      sub={fmtDate(tripEnd, lang)}
      color="var(--ink-2)"
      icon="check"
    />
  );

  // Post-trip event days (e.g. a deadline that lands after the last trip day).
  for (const d of postTripDays) rows.push(renderEventsDay(d));

  return <div className="tl3">{rows}</div>;
}

// ─── CityRail ─────────────────────────────────────────────────────────────────
// Right column of the timeline: the route's cities as scroll-rail "stations".
// Highlights the city whose day is currently scrolled into view (Intersection
// Observer on the .tl3-day anchors), and clicking a city scrolls the timeline to
// that city's first day.
function CityRail({ visits = [], scrollRef }) {
  const { t, lang } = useI18n();
  const cities = useMemo(
    () => sortVisits(visits).filter(v => v.kind !== 'start' && v.kind !== 'end' && v.kind !== 'waypoint'),
    [visits],
  );
  const [activeId, setActiveId] = useState(null);

  useEffect(() => {
    const root = scrollRef?.current;
    if (!root || cities.length === 0) return undefined;
    const dayEls = Array.from(root.querySelectorAll('[data-tlday]'));
    if (dayEls.length === 0) return undefined;
    const obs = new IntersectionObserver((entries) => {
      const vis = entries.filter(e => e.isIntersecting)
        .sort((a, b) => a.boundingClientRect.top - b.boundingClientRect.top);
      const cid = vis[0]?.target.getAttribute('data-city');
      if (cid) setActiveId(cid);
    }, { root, rootMargin: '-8% 0px -72% 0px', threshold: 0 });
    dayEls.forEach(el => obs.observe(el));
    return () => obs.disconnect();
  }, [cities, scrollRef]);

  if (cities.length === 0) return null;

  const go = (city) => {
    const day = naiveDayKey(city.start_date);
    const el = scrollRef?.current?.querySelector(`#tlday-${CSS.escape(String(day))}`);
    if (el) el.scrollIntoView({ behavior: 'smooth', block: 'start' });
  };
  const nights = (city) => {
    const s = parseNaive(city.start_date), e = parseNaive(city.end_date);
    if (!s || !e) return 0;
    return Math.max(0, Math.round(e.diff(s, 'days').days));
  };

  return (
    <div className="cityrail" style={{ position: 'sticky', top: 8 }}>
      <div className="cr-h">{t('overview.stat_cities')}</div>
      {cities.map((c) => {
        const n = nights(c);
        const range = c.start_date ? formatTripRange([c], '–') : '';
        return (
          <button key={c.id} className={'cr-item' + (activeId === c.id ? ' on' : '')} onClick={() => go(c)}>
            <span className="cr-rail"><span className="cr-dot" /><span className="cr-line" /></span>
            <span className="cr-bd">
              <span className="cr-nm" style={{ display: 'block', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{c.city_name}</span>
              <span className="cr-dt">{range}{n > 0 ? ` · ${n} ${t('overview.unit_nights')}` : ''}</span>
            </span>
          </button>
        );
      })}
    </div>
  );
}

// ─── Share / More dialogs ─────────────────────────────────────────────────────


// ─── ContextSide ──────────────────────────────────────────────────────────────

// Timeline right rail. Budget + "who's going" moved to the Overview screen
// (BudgetSummaryCard / MembersSummaryCard); the rail now carries only Services.
// ─── TripView (main export) ───────────────────────────────────────────────────

export default function TripView() {
  const { t, lang } = useI18n();
  const { tripId } = useParams();
  const nav = useNavigate();
  const qc = useQueryClient();
  const [searchParams, setSearchParams] = useSearchParams();
  const { user } = useAuth();
  const { toast } = useToast();
  const lens = searchParams.get('lens') || DEFAULT_SECTION;

  // Тема и аккаунт-Pro нужны только шапке, а её держит TripShell и берёт их из
  // контекстов сама.
  // Right-rail service add - opens ForkPartnerModal for the chosen kind, then
  // routes to the right edit dialog when the user picks "Manual". Services stay
  // on the modal (TRIP-195 leaves esim/insurance/car_rental on modals for now).
  const [serviceChoice, setServiceChoice] = useState({ open: false, type: null });
  const [serviceEditCar, setServiceEditCar] = useState({ open: false });
  // serviceSimple: CREATE form for a new esim/insurance (viewing existing ones
  // goes through the unified SourceViewLoader like every other event).
  const [serviceSimple, setServiceSimple] = useState({ open: false, kind: null });
  // TRIP-195: creating a hotel / transfer / activity opens the global add-booking
  // DRAWER (AddBookingPanel — the same find+manual panel the editor uses),
  // replacing the old ForkPartnerModal → EventEditDialog modal chain.
  const [bookingCreate, setBookingCreate] = useState({ open: false, kind: null, visit: null, fromVisit: null, toVisit: null, initialTab: 'find', defaultStart: null });
  const [eventView, setEventView] = useState({ open: false, kind: null, id: null });
  // Клик по городу в календаре открывает ЕДИНУЮ панель города НА МЕСТЕ — тот же
  // редактируемый CityPanel из «Маршрута», со всеми кнопками/состояниями. Это не
  // копия: в ящик монтируется EditLens в режиме `embedded` (только панель, без
  // карты/рельса) — вся машинерия (черновик/recompute/ночи/удаление/брони) та же.
  const [cityDrawerId, setCityDrawerId] = useState(null);
  const openCityDrawer = (visit) => { if (visit?.id) setCityDrawerId(visit.id); };
  const closeCityDrawer = () => setCityDrawerId(null);
  const openUpgrade = () => goPro(nav, { tripId });
  // Stripe-return success/fail modal is handled globally by <StripeReturnModals>.

  // Открытие панели добавления брони — одна точка на ленту и «Подготовку».
  const openAddHotel = (visit) =>
    setBookingCreate({ open: true, kind: 'hotel', visit, fromVisit: null, toVisit: null, initialTab: 'find', defaultStart: null });
  const openAddTransfer = (fromVisit, toVisit) =>
    setBookingCreate({ open: true, kind: 'transfer', visit: null, fromVisit, toVisit, initialTab: 'find', defaultStart: null });

  // Open the read/edit dialog for a timeline event (hotel / transfer / activity)
  const openEventView = (e) => {
    // Car-rental pickup/return → open the car service VIEW (not edit) like any
    // other event. Both points carry the SAME service id, so the event type has
    // to travel along: it is all that tells the view which of the two addresses
    // belongs behind "show on map" (TRIP-230).
    if (e.type === 'car-pickup' || e.type === 'car-return') {
      const svc = (services || []).find(s => s.id === e.id);
      if (svc) setEventView({ open: true, kind: 'service', id: svc.id, warning: null, subEvent: e.type });
      return;
    }
    let kind = null;
    if (e.type === 'hotel-checkin' || e.type === 'hotel-checkout' || e.type === 'hotel-deadline') kind = 'hotel';
    else if (e.type === 'activity') kind = 'activity';
    else if (e.type === 'transfer' || e.type === 'flight') kind = 'transfer';
    if (!kind) return;
    const id = kind === 'hotel' ? e.hotelId : e.id;
    if (!id) return;
    setEventView({ open: true, kind, id, warning: null });
  };

  // Переход между секциями. Единственный писатель `?lens=` — раньше их было
  // два: этот и глобал `window.__navigate`, который вешался на window ради
  // мобильного дока. Док теперь ходит через тот же контекст, что и «+»/«Ещё»
  // (см. TripShell), поэтому писатель остался один.
  const setLens = (id) => {
    const sp = new URLSearchParams(searchParams);
    // Дефолтная секция в адрес не пишется; всё остальное — пишется.
    if (id === DEFAULT_SECTION) sp.delete('lens'); else sp.set('lens', id);
    setSearchParams(sp, { replace: false });
    // Событие открытия секции шлёт НЕ этот обработчик, а эффект ниже — см. там.
  };

  // Opening a service from the services widget — one distinct event per type.
  // Concrete names (for grep): esim_opened, insurance_opened, car_rental_opened.
  const openServiceChoice = (type) => {
    if (type) track(`${type}_opened`, { trip_id: tripId });
    setServiceChoice({ open: true, type });
  };

  // Fetch shell (trip + cityVisits)
  // isPending + fetchStatus (not just isLoading/error) feed useQueryGate: while
  // OFFLINE, React Query PAUSES this query (fetchStatus 'paused') instead of
  // throwing, so the gate must read that state directly — see the gate below.
  const { data: shellData, error: shellError, isPending: shellPending, fetchStatus: shellFetchStatus } = useQuery({
    // Ключ, include, фетчер И политика ретраев приезжают ОДНИМ дескриптором
    // (`tripShellQuery`): экран их не называет, поэтому прогрев кэша из
    // планировщика не может разъехаться с этим запросом ни по форме payload'а
    // (TRIP-277), ни по настройкам (TRIP-56) — см. шапку дескрипторов.
    ...tripShellQuery(tripId),
    enabled: !!tripId,
  });

  // Fetch content (hotels, activities, transfers) — параллельно с shell
  const {
    data: contentData, isLoading: loadingContent,
    error: contentError, isPending: contentPending, fetchStatus: contentFetchStatus,
  } = useQuery({
    // Тот же дескриптор-шов, что у shell выше: самолечение 401 (refresh + retry
    // once) живёт в fetch-слое, и без него отказ здесь молча рисовал пустой трип.
    ...tripContentQuery(tripId),
    // Параллельно с shell, а не после него. Ожидание было искусственным: обе
    // группы идут в одну и ту же дверь с одним и тем же tripId, и на проде
    // shell (2.4 КБ) стоит 500 мс против 522 мс у content (7.8 КБ) — то есть
    // круг стоит фиксированно, а не по объёму. Последовательность покупала
    // ~20 мс на шапке и платила ~500 мс за контент.
    enabled: !!tripId,
  });

  // Карточка этого трипа, если главная её уже читала. `enabled: false` — только
  // чтение кэша, своего запроса хук не делает (тот же приём, что у EventViewBody).
  const { data: tripCard } = useQuery({ queryKey: TRIP_CARD_KEY(tripId), enabled: false });

  const trip             = shellData?.trip;
  const visits           = useMemo(() => localizeVisits(shellData?.cityVisits || [], lang), [shellData, lang]);
  const hotels           = contentData?.hotels       || [];
  const activities       = contentData?.activities   || [];
  const transfers        = contentData?.transfers    || [];
  const members          = contentData?.members      || [];
  // Names + avatars arrive WITH the members (TRIP-230), so every surface that
  // lists people paints in one go instead of after a separate profile hop.
  const memberProfiles   = useProfileMap(contentData?.profiles);
  const services         = contentData?.services     || [];
  const budget           = contentData?.budget       || null;
  const budgetCategories = contentData?.budgetCategories || [];
  const budgetExpenses   = contentData?.budgetExpenses   || [];

  // Event-open routing split (TRIP-195): services stay on the legacy modal,
  // hotel/transfer/activity open the global drawer. Declared AFTER `trip` (below)
  // is resolved — createStay22 reads trip.details, so it must not run in the TDZ.
  const serviceViewOpen = eventView.open && eventView.kind === 'service';
  const eventDrawerOpen = eventView.open && !!eventView.kind && eventView.kind !== 'service';
  // The global drawer hosts a booking-create panel, an event view/edit, OR the
  // city panel (embedded EditLens) opened from the calendar.
  const drawerOpen = eventDrawerOpen || bookingCreate.open || !!cityDrawerId;
  const closeBookingCreate = () => setBookingCreate((s) => ({ ...s, open: false }));
  // Hotel "find" list bundle for the add-booking drawer (only when creating a
  // hotel — transfer/activity "find" tabs are partner chips, no Stay22 pool).
  const creatingHotel = bookingCreate.open && bookingCreate.kind === 'hotel';
  const createStay22 = useStay22Bundle({
    visit: creatingHotel ? bookingCreate.visit : null,
    currency: trip?.details?.main_currency || 'EUR', lang,
    enabled: creatingHotel, tripId,
  }).bundle;

  // Resolve current user's role in this trip via the shared rule: created_by is
  // the SOLE source of ownership and wins over any stray trip_members row
  // (TRIP-143). Same helper as the structure editor so the two can't drift.
  const myRole = resolveMyRole(members, trip, user);
  // Ступень доступа — ЕДИНЫЙ гейт прав, и приезжает она ГОТОВОЙ из read-двери:
  // `getTripDetails` отдаёт ту самую ступень, которой сам проверил доступ. Фронт
  // её больше не выводит — раньше он считал её из `members`, то есть из ВТОРОГО
  // сетевого круга, и обвязка (меню) из-за этого собиралась в два приёма.
  // `myRole` остаётся только для показа (ярлык, аналитика); правами рулит `myStep`.
  // Отсюда она уходит в TripAccessProvider — единственный канал права в поддереве.
  // Пока дверь не ответила, берём ступень из карточки главной. Это НЕ второе
  // понятие и не клиентский вывод права: карточке ступень проставил сервер тем же
  // `stepFromFacts`, что стоит за `callerStep` двери, — то же правило, просто
  // прочитанное раньше. Дверь ответит через ~400 мс и подтвердит (или поправит,
  // если права изменились за последние секунды). Enforcement это не трогает: он
  // серверный, и любое действие всё равно проходит через дверь.
  // ★ Ветвление по НАЛИЧИЮ ОТВЕТА, а не через `??` по значению: ответившая дверь
  // — окончательное слово, даже если ступени в ответе почему-то нет. С `??`
  // пустая ступень от двери молча откатилась бы к карточке, то есть отказ
  // подменялся бы прошлым доступом — ровно то, чего fail-closed не допускает.
  const myStep = shellData ? (shellData.myStep ?? null) : (tripCard?.myStep ?? null);
  // Второй факт состава меню — включённые аддоны. Тот же порядок: дверь, а до неё
  // карточка. Оба источника проходят через ОДИН нормализатор (`normalizeAddons`),
  // поэтому «включено» считается одинаково независимо от того, кто ответил первым.
  const menuAddons = useMemo(
    () => (trip ? getAddons(trip) : normalizeAddons(tripCard?.addons)),
    [trip, tripCard],
  );

  const stream = useMemo(
    () => buildEventStream(t, hotels, activities, transfers, visits, services),
    [t, hotels, activities, transfers, visits, services],
  );

  // Владелец = ступень owner лестницы (строго `trips.created_by`, TRIP-143).
  // Питает owner-only управление (удалить трип) и РЕЖИМ апселла (владелец видит
  // «Улучшить», остальные — «подключает владелец»). Показ Pro-контента этим НЕ
  // гейтится — за него отвечает isPro/isProTrip (энтайтлмент), отдельная ось.
  const isOwner = clearsStep(myStep, 'owner');

  // Trip-level Pro (owner-aware), resolved via a shared CACHED hook so it doesn't
  // re-flash when crossing the edit↔trip route boundary. See useTripProStatus.
  // Gate the server Pro-check on confirmed access (participant step): a non-member
  // opening this route must not fire checkSubscriptionStatus into an expected 403
  // (TRIP-441). `myStep` is null until the read door answers, so the check simply
  // waits for access to resolve, then runs — never for a stranger.
  const hasTripAccess = clearsStep(myStep, 'participant');
  // Вердикт для ПОКАЗА приезжает тем же ответом (`isPro` — единый предикат
  // `is_trip_pro`), поэтому апселл решается на первом круге, а не третьим.
  // checkSubscriptionStatus остаётся авторитетом (в нём reconcile-on-read со
  // Stripe) и подтверждает фоном — вход в UI по-прежнему ОДИН, этот хук.
  // Тот же порядок, что у ступени и аддонов: ответила дверь — её вердикт, не
  // ответила — карточка главной (в ней `is_pro` считает тот же SQL-предикат
  // `is_trip_pro`). Без этого пункт «Pro» оставался единственным, кто ждал круга,
  // и меню всё равно доезжало на глазах.
  const proSeed = shellData ? shellData.isPro : tripCard?.is_pro;
  const { isPro: tripIsPro, resolved: tripProResolved } = useTripProStatus(tripId, proSeed, hasTripAccess);
  // Edit Mode (structure editor) gate: ступень editor. Past trips are no
  // longer Pro-gated (TRIP-28) — editing is open for owner/admin regardless of age.
  const canEditMode = clearsStep(myStep, 'editor');

  // trip_opened (once per trip) + associate events with the trip GROUP so the
  // North Star ("active trips with ≥2 participants") is measured per-trip. Group
  // props refresh as members / Pro resolve from the content query.
  const openedTripRef = useRef(null);
  const groupKeyRef = useRef(null);
  useEffect(() => {
    if (!tripId || !trip) return;
    // Only re-group when the group props actually change — the member count and
    // tripIsPro resolve a beat after mount, and without this guard each resolve
    // fires a redundant PostHog $groupidentify.
    // participant_count = real humans on the trip = active/offline members
    // (owner included — it's a real trip_members row since TRIP-516). Not raw
    // members.length, which would also count pending/declined invites.
    const memberCount = countTripMembers(members);
    const groupKey = `${tripId}:${memberCount}:${tripIsPro ? 1 : 0}`;
    if (groupKeyRef.current !== groupKey) {
      groupKeyRef.current = groupKey;
      groupTrip(tripId, { participant_count: memberCount || undefined, is_pro: !!tripIsPro });
    }
    if (openedTripRef.current !== tripId) {
      openedTripRef.current = tripId;
      track('trip_opened', { trip_id: tripId, role: myRole });
    }
  }, [tripId, trip, members.length, tripIsPro, myRole]);

  const { openProUpsell } = useProUpsell();
  // Апселл из МЕНЮ трипа (пункт «Pro» рейла и телефонного шита): владельцу —
  // с кнопкой апгрейда, участнику — «подключает владелец». Роль и источник едут
  // фактами, копию и кнопки выбирает таблица в `@/lib/proUpsell`.
  const openProInfo = () => openProUpsell({
    role: proRole(isOwner),
    source: 'menu',
    ownerName: resolveOwnerName({ members, profiles: memberProfiles, selfUser: user, deletedLabel: t('common.deleted_user') }),
    onUpgrade: openUpgrade,
  });
  const [shareOpen, setShareOpen] = useState(false);
  const [budgetAddonOff, setBudgetAddonOff] = useState(false);
  // Открытие бокового меню и мобильный док теперь на TripShell — она владеет
  // оболочкой целиком. Отсюда наверх уезжает только «+»: что именно добавлять,
  // знает экран (роль/аддон/линза), а не оболочка — экран регистрирует список
  // действий `addActions`, а сам «+» в доке рендерит их канон-меню.
  const { setAddActions } = useMobileNav();
  const [addModal, setAddModal] = useState(null); // null | 'expense' | 'category' | 'docs' | 'members' — trip-level create dialog opened by the bottom-nav "+"
  const isPhone = useIsPhone();

  // Что реально показать: недоступная секция (выключенный аддон, роль без права)
  // и несуществующая (`?lens=` с опечаткой) одинаково падают на дефолт. Правило
  // живёт в реестре секций — тут только его применение.
  // ★ В фазе shell (`trip` ещё не загружен) resolveSection не знает аддонов/роли и
  // свалил бы `?lens=chat/budget` на дефолт-обзор — тогда в загрузке мигал бы НЕ
  // тот скелетон. Пока trip нет — берём СЫРОЙ `lens` из адреса (как делал прежний
  // LoadingBody), а как приедет shell — резолвим по-настоящему (TRIP-337).
  const shownLens = (trip || tripCard) ? resolveSection(lens, menuAddons, myStep) : lens;

  // «+»-меню трипа: дескрипторы действий, которые собирает экран. Гейт единый —
  // ступень editor (+ аддон бюджета для траты/категории); «Категория» — только на
  // линзе Бюджет. Обработчики открывают трип-level диалоги IN PLACE (см. overlays),
  // диалоги рендерит экран, сам «+» их не импортирует.
  const addActions = useMemo(() => {
    const budgetOn = isAddonEnabled(trip, 'budget');
    const canEdit = clearsStep(myStep, 'editor');
    return [
      budgetOn && canEdit && { id: 'expense', icon: 'wallet', tone: 'brand', labelKey: 'budget.manual_expense', onSelect: () => setAddModal('expense') },
      shownLens === 'budget' && budgetOn && canEdit && { id: 'category', icon: 'grid', tone: 'info', labelKey: 'budget.add_category', onSelect: () => setAddModal('category') },
      canEdit && { id: 'docs', icon: 'file', tone: 'hotel', labelKey: 'doc.add_doc', onSelect: () => setAddModal('docs') },
      canEdit && { id: 'members', icon: 'users', tone: 'activity', labelKey: 'members.invite', onSelect: () => setAddModal('members') },
    ].filter(Boolean);
  }, [trip, myStep, shownLens]);
  useEffect(() => {
    setAddActions(addActions);
    return () => setAddActions(null);
  }, [setAddActions, addActions]);

  // Событие открытия секции — на СМЕНУ ПОКАЗАННОЙ секции, а не на клик по меню.
  //
  // Клик был неполным источником: заход по прямой ссылке `?lens=budget`, по
  // закладке и по редиректу со старого адреса редактора события не давал вовсе.
  // На редакторе это вылезло сразу: `trip_editor_opened` раньше слался из
  // `screenOpenEvent` по РОУТУ, роут стал редиректом — и событие пропало бы
  // совсем. Ключ на `shownLens` (разрешённой, а не сырой из адреса): недоступная
  // секция подменяется дефолтной, и считать надо то, что человек УВИДЕЛ.
  //
  // ⚠ Объёмы секционных событий вырастут: теперь считаются и прямые заходы.
  //
  // Ждём ОБЕ половины данных: аддоны приезжают shell'ом, роль — content'ом,
  // одного shell мало. Пока их нет, `trip` пуст, а `resolveMyRole` по умолчанию
  // отдаёт 'viewer' — то есть `resolveSection` честно не знает ни про аддон, ни
  // про право и подменяет гейтованную секцию дефолтной. Эффект стоит ВЫШЕ
  // раннего возврата по shellGate, поэтому без этой проверки он отрабатывал уже
  // на первом кадре и слал `overview_opened` на КАЖДОМ холодном заходе в
  // Бюджет/Чат/Участников/Структуру (прямая ссылка, закладка, F5, редирект со
  // старого адреса редактора), а верное событие уезжало вторым — врал ровно про
  // те заходы, ради которых событие сюда и переехало. Цена: событие уходит на
  // долю секунды позже, а если content не доедет вовсе (офлайн, 500), секция
  // останется БЕЗ события — недосчёт вместо вранья.
  //
  // Гейт — БУЛЕВ флаг, а не сами `trip`/`contentData` в зависимостях: рефетч
  // отдаёт новые объекты, и событие ушло бы повторно на той же секции.
  const sectionKnown = !!trip && !!contentData;
  useEffect(() => {
    if (!sectionKnown) return;
    const sectionEvent = sectionById(shownLens)?.event;
    if (sectionEvent) track(sectionEvent, { trip_id: tripId });
  }, [sectionKnown, shownLens, tripId]);

  // Тело — постоянный скролл-контейнер; сброс наверх при смене секции держит
  // TripShell (ref прокидываем, он же нужен рейлу городов в ленте).
  const screenBodyRef = useRef(null);

  // TRIP-56: map the shell-load state to the right screen instead of one
  // catch-all "no access". useQueryGate reads isPending + fetchStatus + error
  // together (shared with the editor + auto /login redirect), so OFFLINE — where
  // React Query PAUSES the query and never throws — resolves to 'temporary'
  // (retry screen) instead of the old false "no access" that flashed the instant
  // you opened a trip with no network. 'auth' = session gone → /login (mirrors
  // AuthContext's SIGNED_OUT redirect; harmless if both fire). 'access' (403/404)
  // → the "no access" stub. Cached trip stays visible. Render stays per-screen.
  // emptyIsOk:false — single-resource fetch: a settled-empty shell means "you
  // can't see this trip", a defensive belt over the thrown-403/404 path (TRIP-220).
  const shellGate = useQueryGate({ isPending: shellPending, fetchStatus: shellFetchStatus, error: shellError }, !!shellData?.trip, false);

  // Гейт CONTENT'а. Экрану в целом он не нужен — секции переживают пустой
  // content и дозаполняются, — но секция «Структура» СТРОИТ ИЗ НЕГО ДРАФТ:
  // без content'а ей нечего показать, а если запрос упадёт уже после успешного
  // shell (офлайн, 500), пустота останется навсегда. Раньше эту роль выполнял
  // собственный contentGate снесённого роута (TRIP-220: «gate to retry rather
  // than render an empty editor»). emptyIsOk:false по той же причине, что и у
  // shell: осевший пустым content для редактора неотличим от несостоявшегося.
  const contentGate = useQueryGate({ isPending: contentPending, fetchStatus: contentFetchStatus, error: contentError }, !!contentData, false);
  const editGate = contentGate === 'ok' ? 'ok' : (contentGate === 'loading' || contentGate === 'auth') ? 'loading' : 'error';

  // 'auth' shows the same loading placeholder while useQueryGate's effect redirects to /login.
  // Секция берётся СЫРОЙ из адреса, а не через resolveSection: аддоны приезжают
  // тем же shell-запросом, которого мы ждём, поэтому `?lens=chat` до ответа
  // выглядел бы недоступным и мигнул бы скелетоном обзора вместо чата.
  // ★ Никакого раннего return для загрузки: единый путь рендера (см. коммент у
  // удалённого LoadingBody). shell-загрузка/auth → `shellLoading`: TripShell
  // покажет скелетон меню, а секция — свой скелетон, ВСЁ в том же дереве, что и
  // после загрузки, поэтому ничего не размонтируется и не прыгает (TRIP-337).
  const shellLoading = shellGate === 'loading' || shellGate === 'auth';
  if (shellGate === 'temporary') return <TripLoadError onRetry={() => invalidateTripData(qc, tripId)} onBack={() => nav('/trips')} />;
  // not_found = no such trip / broken-or-typo'd id (404). Show the neutral "doesn't
  // exist" page, NOT the accusatory "no access". Split from 'access' in TRIP-208.
  if (shellGate === 'not_found') return <PageNotFound />;
  if (shellGate === 'access') return <TripAccessError onBack={() => nav('/trips')} />;

  // ── Global trip header: cover, subtitle and the right-hand hero actions ──
  // (Share / Edit / "…"). Cover priority mirrors the old cover strip: uploaded
  // photo → preset gradient → default waves. All dialogs open via the global
  // modal mount, so they work from any lens.
  const dateRange = formatTripRange(visits, '-');
  const cityCount = uniqueCityCount(visits);
  // Trip length — ONE source for every surface: tripDuration().days (= nights+1,
  // calendar days inclusive), the same helper the Overview stat row and the
  // public trip use. Previously this header computed nights inline and rendered
  // them with the day-word ("12 days" for a 12-night trip), so it disagreed with
  // Overview/public ("13 days") for the identical trip.
  const tripDays = tripDuration(trip, visits).days;
  const dayWord = (n) => (n === 1 ? t('tse.day_one') : n >= 2 && n <= 4 ? t('tse.day_few') : t('tse.day_many'));
  const heroSub = (
    <>
      {dateRange && dateRange !== '-' && <span>{dateRange}</span>}
      {tripDays > 0 && (
        <><span>·</span><span>{tripDays} {dayWord(tripDays)}</span></>
      )}
      {cityCount > 0 && (
        <><span>·</span><span>{cityCount} {cityCount === 1 ? t('trip.cities_count_one') : cityCount < 5 ? t('trip.cities_count_few') : t('trip.cities_count_many')}</span></>
      )}
    </>
  );
  // Действия трипа (Поделиться / Редактор / Настройки / Участники) живут в левом
  // меню, копия трипа — в настройках; в шапке дублей нет. Раскладку тела
  // (обычное / в край) и «назад» держит TripShell по реестру секций.

  // Слот `drawer` оболочки: глобальный ящик брони/события. Позиция в DOM тут
  // несущая — он позиционируется абсолютом относительно `.trip-content` (уже
  // ниже шапки и правее меню) и НЕ должен скроллиться вместе с содержимым,
  // поэтому он сосед <main>, а не его потомок.
  // TRIP-195: глобальный ящик для отеля/переезда/активности — привязан к
  // .trip-content (ниже шапки, правее меню), левые 50% со скримом. Хостит ЛИБО
  // создание брони (AddBookingPanel — поиск + вручную, та же панель, что у
  // редактора), ЛИБО просмотр/правку события (EventSourcePanel). Сервисы
  // остаются на модалке (выше). Создание открывается из ленты (onAddTransfer/
  // Hotel/Activity); просмотр/правка — из ленты/календаря (openEventView) и из
  // бюджета (onOpenSource, поднят сюда).
  const eventDrawer = (
    <EventDrawerHost
      open={drawerOpen}
      onClose={cityDrawerId ? closeCityDrawer : bookingCreate.open ? closeBookingCreate : () => setEventView(s => ({ ...s, open: false }))}
      scrim
    >
      {cityDrawerId ? (
        // Панель города из календаря — тот же редактируемый CityPanel, что и в
        // «Маршруте», НА МЕСТЕ: монтируем EditLens в режиме `embedded` (только
        // панель, без карты/рельса), все кнопки/состояния (ночи, удаление,
        // добавление броней, переезды) — живые и те же самые.
        <EditLens
          embedded
          tripId={tripId}
          shell={shellData}
          content={contentData}
          openCityId={cityDrawerId}
          onClose={closeCityDrawer}
        />
      ) : bookingCreate.open ? (
        <AddBookingPanel
          kind={bookingCreate.kind}
          tripId={tripId}
          trip={trip}
          visit={bookingCreate.visit}
          fromVisit={bookingCreate.fromVisit}
          toVisit={bookingCreate.toVisit}
          stay22={createStay22}
          defaultCurrency={trip?.details?.main_currency || 'EUR'}
          defaultStart={bookingCreate.defaultStart}
          initialTab={bookingCreate.initialTab}
          onClose={closeBookingCreate}
        />
      ) : eventDrawerOpen ? (
        <EventSourcePanel
          tripId={tripId}
          kind={eventView.kind}
          id={eventView.id}
          warning={eventView.warning}
          canEdit={canEditMode}
          onClose={() => setEventView(s => ({ ...s, open: false }))}
        />
      ) : null}
    </EventDrawerHost>
  );

  // Слот `overlays`: диалоги, шиты и плавающий виджет — внутри оболочки, но вне
  // колонок, ровно как было.
  const overlays = (
    <>
    <TripShareFlow open={shareOpen} onOpenChange={setShareOpen} trip={trip} visits={visits} transfers={transfers} />
  
    {/* Trip-level create dialogs opened by the bottom-nav "+" (addActions above) —
        render over ANY lens without navigating (same pattern as the event dialogs
        above). The "+" menu itself lives in the dock (ActionMenu), fed by addActions. */}
    {addModal === 'expense' && (
      <AddExpenseDialog
        open
        onOpenChange={(o) => { if (!o) setAddModal(null); }}
        tripId={tripId}
        categories={budgetCategoryOptions(budgetCategories, t)}
        mainCurrency={trip?.details?.main_currency || budget?.currency || 'EUR'}
        cities={visits.filter((v) => v.city_name)}
        onProRefusal={() => openProUpsell({
          role: proRole(isOwner),
          source: 'feature',
          feature: t('budget.title'),
          ownerName: resolveOwnerName({ members, profiles: memberProfiles, selfUser: user, deletedLabel: t('common.deleted_user') }),
          onUpgrade: openUpgrade,
        })}
      />
    )}
    {addModal === 'category' && (
      <AddCategoryDialog
        open
        onOpenChange={(o) => { if (!o) setAddModal(null); }}
        tripId={tripId}
        existing={null}
        onProRefusal={() => openProUpsell({
          role: proRole(isOwner),
          source: 'feature',
          feature: t('budget.title'),
          ownerName: resolveOwnerName({ members, profiles: memberProfiles, selfUser: user, deletedLabel: t('common.deleted_user') }),
          onUpgrade: openUpgrade,
        })}
      />
    )}
    {addModal === 'docs' && (
      <AddDocDialog open onOpenChange={(o) => { if (!o) setAddModal(null); }} tripId={tripId} />
    )}
    {addModal === 'members' && (
      <InviteDialog
        open
        onOpenChange={(o) => { if (!o) setAddModal(null); }}
        tripId={tripId}
      />
    )}
  
    {/* Ф6а: budgetAddonOff on Radix (focus-trap, Esc) */}
    <Dialog
      title={t('trip.budget_breakdown_off')}
      icon="wallet"
      open={budgetAddonOff}
      onOpenChange={(o) => { if (!o) setBudgetAddonOff(false); }}
      foot={<>
        <Btn variant="secondary" onClick={() => setBudgetAddonOff(false)}>{t('common.close')}</Btn>
        <Btn variant="primary" icon="settings" onClick={() => { setBudgetAddonOff(false); setLens('settings'); }}>{t('trip.open_settings')}</Btn>
      </>}
    >
      <div className="muted">
        {t('trip.budget_addon_off_desc')}
      </div>
    </Dialog>
  
    {/* Floating chat widget: requires the chat addon AND the trip-level
        "chat widget" display toggle (default ON). The full Chat lens stays
        reachable from the sidebar regardless of this toggle. */}
    {!isPhone && isSectionAvailable('chat', menuAddons, myStep) && trip?.details?.display?.chat_widget !== false && shownLens !== 'chat' && (
      <ChatWidget tripId={tripId} members={members} profiles={memberProfiles} tripTitle={trip?.title} />
    )}
    </>
  );

  return (
    // Единый доступ к праву для всего поддерева трипа: линзы, шит, диалоги
    // читают `useTripAccess()` вместо пропов права (TRIP-274 Ф2.2). Ступень
    // считается один раз в самом провайдере.
    <TripAccessProvider step={myStep}>
    <TripShell
      tripId={tripId}
      addons={menuAddons}
      section={shownLens}
      isPro={tripIsPro}
      proResolved={tripProResolved}
      title={trip?.title}
      meta={heroSub}
      onNavigate={setLens}
      onShare={() => setShareOpen(true)}
      onProUpsell={openProInfo}
      bodyRef={screenBodyRef}
      drawer={eventDrawer}
      overlays={overlays}
      loading={shellLoading}
    >
          {/* TRIP-195: hotel / activity / transfer create moved to the global
              add-booking DRAWER (see EventDrawerHost below). Only services keep
              the ForkPartnerModal. */}
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
                // Open in edit/create mode (no existing service yet)
                setServiceSimple({ open: true, kind: type });
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
              entity={serviceEditCar.service || null}
              defaultCurrency={trip?.details?.main_currency || 'EUR'}
            />
          )}
          {/* eSIM / Insurance — CREATE only (viewing goes through the unified
              SourceViewLoader below, like every other service/event). */}
          {serviceSimple.open && (serviceSimple.kind === 'esim' || serviceSimple.kind === 'insurance') && (
            <EventEditDialog
              open={serviceSimple.open}
              onOpenChange={(o) => setServiceSimple(s => ({ ...s, open: o }))}
              kind="service"
              tripId={tripId}
              entity={null}
              initialServiceKind={serviceSimple.kind}
              defaultCurrency={trip?.details?.main_currency || 'EUR'}
            />
          )}
          {/* Services (esim / insurance / car_rental) still open in the legacy
              modal (TRIP-195 keeps them on modals for now). hotel/transfer/
              activity moved to the global drawer, mounted at .trip-content below. */}
          <SourceViewLoader
            tripId={tripId}
            kind={eventView.kind}
            id={eventView.id}
            open={serviceViewOpen}
            onOpenChange={(o) => setEventView(s => ({ ...s, open: o }))}
            canEdit={canEditMode}
            warning={eventView.warning}
            subEvent={eventView.subEvent}
          />

          {/* Lens-level crash isolation (TRIP-219 F2): a crash in one lens shows
              the retry fallback in the content area while the trip header, sidebar
              and nav stay alive. Keyed by lens so switching tabs clears a crash. */}
          <ErrorBoundary key={shownLens} region={`lens:${shownLens}`}>
          {shownLens === 'overview' && (
            <OverviewLens
              trip={trip}
              visits={visits ?? []}
              transfers={transfers ?? []}
              hotels={hotels ?? []}
              budget={budget}
              budgetExpenses={budgetExpenses}
              budgetCategories={budgetCategories}
              members={members}
              memberProfiles={memberProfiles}
              services={services}
              user={user}
              contentLoading={shellLoading || loadingContent}
              active={shownLens === 'overview'}
              budgetEnabled={isAddonEnabled(trip, 'budget')}
              onOpenMap={() => setLens('route')}
              onOpenBudget={() => setLens('budget')}
              onOpenMembers={() => setLens('members')}
              onAddService={openServiceChoice}
              onOpenService={(s) => setEventView({ open: true, kind: 'service', id: s.id })}
              onBudgetLocked={() => setBudgetAddonOff(true)}
              onAddHotel={openAddHotel}
              onAddTransfer={openAddTransfer}
            />
          )}
          {shownLens === 'timeline' && (
            <>
              <div className="ov-anim tl-twocol" style={{ display: 'grid', gridTemplateColumns: '1fr 260px', gap: 24, alignItems: 'start' }}>
                <TimelineLens
                  stream={stream}
                  visits={visits}
                  transfers={transfers}
                  hotels={hotels}
                  trip={trip}
                  isLoading={shellLoading || loadingContent}
                  onAddTransfer={openAddTransfer}
                  onAddHotel={openAddHotel}
                  onOpenEvent={openEventView}
                  onAddActivityForDay={(dayKey) => {
                    const dayVisit = visits.find(v =>
                      v.kind === 'transit' && v.start_date && v.end_date &&
                      naiveDayKey(v.start_date) <= dayKey && dayKey <= naiveDayKey(v.end_date)
                    ) || visits.find(v => v.kind === 'transit' && v.start_date);
                    if (dayVisit) {
                      const tz = dayVisit.timezone || 'UTC';
                      const defaultStart = dayKey
                        ? DateTime.fromISO(`${dayKey}T10:00`, { zone: tz }).toUTC().toISO()
                        : null;
                      setBookingCreate({ open: true, kind: 'activity', visit: dayVisit, fromVisit: null, toVisit: null, initialTab: 'find', defaultStart });
                    }
                  }}
                />
                {/* пока города не приехали (фаза shell) — скелетон рейла, потом
                    живой CityRail НА МЕСТЕ (тело таймлайна не размонтируется) */}
                {visits.length ? <CityRail visits={visits} scrollRef={screenBodyRef} /> : <RightRailSkeleton />}
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
              isLoading={shellLoading || loadingContent}
              isPro={tripIsPro}
              onOpenSource={(kind, id) => setEventView({ open: true, kind, id, warning: null })}
            />
          )}
          {shownLens === 'members' && (
            <MembersLens
              tripId={tripId}
              members={members}
              profiles={memberProfiles}
              user={user}
              isLoading={shellLoading || loadingContent}
            />
          )}
          {shownLens === 'calendar' && (
            <CalendarLens
              stream={stream}
              visits={visits}
              isLoading={shellLoading || loadingContent}
              onOpenEvent={openEventView}
              onOpenCity={openCityDrawer}
            />
          )}
          {shownLens === 'docs' && (
            <DocsLens
              tripId={tripId}
              isLoading={shellLoading || loadingContent}
              members={members}
              profiles={memberProfiles}
            />
          )}
          {/* МАРШРУТ — карта трипа и его структура одним экраном (TRIP-459;
              до этого «Карта» и «Планирование» были двумя, и карта была
              подмножеством редактора). Получает те же shell/content, что уже
              загружены здесь.

              Роль не передаём — и теперь по ДРУГОЙ причине, чем раньше: до
              TRIP-459 право стояло гейтом в реестре секций, а сейчас секция
              открыта всем и право читает сама линза из `TripAccessProvider`
              (им обёрнут весь экран ниже). Проп сюда вернуть нельзя: он не
              достанет до диалогов внутри, ради чего провайдер и заводился.

              Рендерится ТОЛЬКО когда активна. Инстанс Mapbox — общий синглтон
              (MapProvider) и переживает этот mount/unmount, но одновременно
              смонтированным может быть лишь один <MapView>: держать секцию
              скрытой вместо условия значило бы стравить две поверхности за одну
              карту. */}
          {/* Гейт CONTENT'а нужен ТОЛЬКО здесь. Остальные секции переживают
              отсутствие content: рисуют пусто и дозаполняются. Редактор из него
              СТРОИТ ДРАФТ — без content'а показывать нечего, а если запрос
              упадёт после успешного shell (офлайн, 500), пустота останется
              навсегда. Формулировка из TRIP-220: «gate to retry rather than
              render an empty editor».
              ★ Гейт стал строже по ОХВАТУ, а не по правилу: с TRIP-459 маршрут
              смотрят все, поэтому падение content'а теперь разворачивает в
              retry и наблюдателя — у него это единственный экран с картой. */}
          {shownLens === 'route' && (
            (shellLoading || editGate === 'loading')
              // ОДИН скелетон редактора (обе колонки: маршрут + карта), тот же в
              // фазе shell и в фазе content — не размонтируется, не прыгает (TRIP-337).
              ? <EditSkeleton />
              : editGate === 'ok'
                ? <EditLens tripId={tripId} shell={shellData} content={contentData} />
                : <TripLoadError onRetry={() => invalidateTripData(qc, tripId)} onBack={() => nav(`/trip/${tripId}`)} />
          )}
          {shownLens === 'settings' && (
            <SettingsLens
              tripId={tripId}
              trip={trip}
              members={members}
              profiles={memberProfiles}
              isPro={tripIsPro}
              isProTrip={!!trip?.is_pro_trip}
              proResolved={tripProResolved}
              queryClient={qc}
              isLoading={shellLoading || loadingContent}
            />
          )}
          {shownLens === 'chat' && (
            <ChatLens
              tripId={tripId}
              members={members}
              profiles={memberProfiles}
              myRole={myRole}
            />
          )}
          </ErrorBoundary>
    </TripShell>
    </TripAccessProvider>
  );
}
