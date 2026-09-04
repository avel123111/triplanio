// @ts-check
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Btn, Card, Skeleton } from '@/design/index';
import { Icon } from '@/design/icons';
import MapView from '@/components/views/MapView';
import TripStatRow from '@/components/trips/TripStatRow';
import { useI18nFormat } from '@/lib/i18n/I18nContext';
import { useTheme } from '@/lib/ThemeContext';
import { computeTripRange, currentCityVisit, formatDateRange, tripPhase, tripProgress } from '@/lib/trip-dates';
import { sortVisits } from '@/lib/validation';
import { naiveDayKey } from '@/lib/naive-time';
import { DateTime } from 'luxon';

// ГЕРОЙ ЭКРАНА ПОЕЗДКИ — карта во всю ширину, состояние панелью над ней.
//
// ★ НИЗ КАДРА ПРИНАДЛЕЖИТ АТРИБУЦИИ mapbox (логотип слева, копирайт справа):
// показывать её обязывает лицензия, поэтому панель стоит НАВЕРХУ, а вход в
// линзу — её кнопка, а не второй плавающий предмет в свободном углу.
//
// ★ ПАНЕЛЬ ОБЪЯВЛЯЕТ СЕБЯ ЗАКРЫТОЙ ПЛОЩАДЬЮ (`view`), иначе `fitToPoints`
// вписывает маршрут в ВЕСЬ кадр и первые города уезжают под неё. Величина —
// ИЗМЕРЕНИЕМ живой панели: у её отступов контейнерный порог, копия числа из CSS
// разъехалась бы с ним молча. Механика общая с `<MapShell>` (`lib/map/insets.js`).
//
// ★ Обложки здесь нет намеренно: у поездки без своего фото подставляется сток,
// не имеющий отношения к маршруту. Полосы готовности тоже нет — она про
// подготовку и живёт в её виджете, рядом со списком, который её объясняет.

// «У узла есть координаты» — читаем НАЛИЧИЕ, а не истинность: `v.latitude`
// расходится с `!= null` ровно на нулевой широте.
const hasCoords = (v) => v?.latitude != null && v?.longitude != null;

/** @param {{ trip?: any, visits?: any[], transfers?: any[],
 *            active?: boolean, isLoading?: boolean, onOpenMap?: any }} p */
export default function TripFrame({
  trip, visits = [], transfers = [], active = true, isLoading = false, onOpenMap,
}) {
  const { t, fmtDate, plural } = useI18nFormat();
  const { isDark } = useTheme();

  const [hoveredId, setHoveredId] = useState(/** @type {any} */ (null));
  const [selectedId, setSelectedId] = useState(/** @type {any} */ (null));
  const badgeId = hoveredId ?? selectedId;
  const cityBadge = useMemo(() => {
    if (badgeId == null) return null;
    const v = (visits || []).find((x) => String(x.id) === String(badgeId));
    if (!v || !hasCoords(v)) return null;
    return {
      lng: v.longitude, lat: v.latitude, countryCode: v.country_code, name: v.city_name,
      dates: formatDateRange(v.start_date, v.end_date, (iso) => fmtDate(iso)),
    };
  }, [badgeId, visits, fmtDate]);

  const ordered = useMemo(() => sortVisits(visits), [visits]);

  const when = useMemo(() => {
    const startKey = naiveDayKey(computeTripRange(visits).start);
    return {
      phase: tripPhase(visits),
      progress: tripProgress(visits),
      nowCity: currentCityVisit(visits),
      startKey,
      // Дней до старта — по КАЛЕНДАРНЫМ дням: «через 1 день» обязано смениться
      // на «стартует сегодня» в полночь, а не через 24 часа.
      daysToStart: startKey
        ? Math.round(DateTime.fromISO(startKey).diff(DateTime.now().startOf('day'), 'days').days)
        : null,
    };
  }, [visits]);

  // Закрытая панелью площадь кадра. Панель либо стоит колонкой слева (широкий
  // кадр), либо растянута полосой по верху (узкий) — какой из двух случаев
  // сейчас, решает ЗАМЕР, а не копия порога: панель шире двух третей кадра =
  // полоса, значит закрыт ВЕРХ; иначе закрыт ЛЕВЫЙ край.
  const mapRef = useRef(/** @type {any} */ (null));
  const panelRef = useRef(/** @type {any} */ (null));
  const [closed, setClosed] = useState(/** @type {any} */ (null));
  const measure = useCallback(() => {
    const f = mapRef.current; const p = panelRef.current;
    if (!f || !p) return;
    const fr = f.getBoundingClientRect(); const pr = p.getBoundingClientRect();
    if (!fr.width || !pr.width) return;
    // Мерим против КАРТЫ, а не кадра: на телефоне панель стоит под картой в
    // потоке, пересечения нет — значит нет и закрытой площади.
    if (pr.bottom <= fr.top + 1 || pr.top >= fr.bottom - 1) {
      setClosed((cur) => (cur === null ? cur : null));
      return;
    }
    // Панель всегда стоит в ЛЕВОМ верхнем углу и режет карту по ширине: ветка
    // «полосой сверху» недостижима — на узком кадре панель уходит в поток и
    // выход выше по отсутствию пересечения случается раньше.
    const box = { left: Math.round(pr.right - fr.left) };
    setClosed((cur) => (cur && cur.left === box.left ? cur : box));
  }, []);
  // ★★ `isLoading` В ДЕПАХ ОБЯЗАТЕЛЕН. `measure` стабилен, поэтому с депами
  // `[measure]` эффект отработал бы РАЗ — на монтировании, а монтируется кадр в
  // фазе загрузки и отдаёт скелетон без ссылок: рефы пусты, `observe` не зовётся,
  // закрытая площадь остаётся `null` навсегда.
  useEffect(() => {
    measure();
    if (typeof ResizeObserver === 'undefined') return undefined;
    const ro = new ResizeObserver(measure);
    if (mapRef.current) ro.observe(mapRef.current);
    if (panelRef.current) ro.observe(panelRef.current);
    return () => ro.disconnect();
  }, [measure, isLoading]);
  const view = useMemo(() => (closed ? { camera: closed, fit: closed } : null), [closed]);

  if (isLoading) return <TripFrameSkeleton />;

  const hasRoute = (visits || []).some(hasCoords);
  const { phase, progress, nowCity, startKey, daysToStart } = when;
  let headline = t('overview.state_undated');
  let sub = '';
  if (phase === 'ongoing' && progress) {
    headline = t('overview.state_ongoing', { day: progress.day, total: progress.total });
    sub = nowCity ? t('overview.state_now_city', { city: nowCity.city_name }) : '';
  } else if (phase === 'upcoming') {
    headline = daysToStart != null && daysToStart <= 0
      ? t('overview.state_today')
      : plural(daysToStart ?? 0, 'overview.state_upcoming', { count: daysToStart });
    sub = startKey ? fmtDate(startKey) : '';
  } else if (phase === 'past') {
    headline = t('overview.state_past');
    sub = startKey ? fmtDate(startKey) : '';
  }

  return (
    <>
      <div className="tframe">
        <div className="tframe__map" ref={mapRef}>
          {hasRoute ? (
            <MapView
              visits={visits}
              transfers={transfers}
              view={view}
                colorScheme={isDark ? 'DARK' : 'LIGHT'}
              active={active}
              hoveredVisitId={hoveredId}
              selectedVisitId={selectedId}
              cityBadge={cityBadge}
              onCityHover={(pts) => setHoveredId(pts ? (pts[0]?.id ?? null) : null)}
              onCityClick={(pts) => { const v = pts?.[0]; if (v) setSelectedId((cur) => (cur === v.id ? null : v.id)); }}
              onMapClick={() => setSelectedId(null)}
            />
          ) : (
            <div className="tframe__mapempty muted">
              <Icon name="map" size={22} />
              <span>{t('overview.map_empty')}</span>
            </div>
          )}
        </div>

        <div className="tframe__state" ref={panelRef}>
          <Card radius="lg" raised className="col col--g3">
            <div className="t-title">{headline}</div>
            {sub && <div className="t-support muted">{sub}</div>}
            <Btn variant="secondary" block iconRight="chev" onClick={onOpenMap}>
              {t('overview.open')}
            </Btn>
          </Card>
        </div>
      </div>

      {/* `orderedVisits` — ОБЯЗАТЕЛЕН: сумма расстояния идёт по ПОРЯДКУ узлов, а
          `visits` приходит сырым из ответа API. Без него «Расстояние» считается
          по порядку выдачи, а не по маршруту. */}
      <TripStatRow visits={visits} orderedVisits={ordered} transfers={transfers} trip={trip} />
    </>
  );
}

export function TripFrameSkeleton() {
  return (
    <>
      {/* Тот же `.tframe` с той же панелью на том же месте: иначе скелетон обещает
          пустой прямоугольник и содержимое прыгает, когда данные приехали. */}
      <div className="tframe">
        <div className="tframe__map"><Skeleton w="100%" h="100%" r={0} /></div>
        <div className="tframe__state"><Skeleton w="100%" h={132} r="var(--r-lg)" /></div>
      </div>
      {/* ★ ПОЛОСА ПЛИТОК — НАСТОЯЩАЯ, в фазе загрузки. Прямоугольник на её месте
          не несёт СВОЙ `margin-top` полосы и прилипал к кадру карты. */}
      <TripStatRow isLoading />
    </>
  );
}
