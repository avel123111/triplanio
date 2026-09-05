// @ts-check
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Btn, Card, EmptyState, Skeleton } from '@/design/index';
import MapView from '@/components/views/MapView';
import TripStatRow from '@/components/trips/TripStatRow';
import { useI18nFormat } from '@/lib/i18n/I18nContext';
import { useTheme } from '@/lib/ThemeContext';
import { computeTripRange, currentCityVisit, formatDateRange, tripPhase, tripProgress } from '@/lib/trip-dates';
import { sortVisits } from '@/lib/validation';
import { naiveDayKey } from '@/lib/naive-time';
import { DateTime } from 'luxon';

// Кадр поездки на Обзоре: карта во всю ширину, панель состояния в левом верхнем
// углу (низ кадра занимает атрибуция mapbox), под кадром — полоса чисел маршрута.
//
// Панель объявляет карте закрытую площадь (`view`, механика `lib/map/insets.js`),
// иначе автофит вписывает маршрут во весь кадр и первые города уходят под неё.
// Величина берётся замером живой панели: её раскладка зависит от ширины кадра
// (контейнерный порог), копия числа из CSS разошлась бы с ним.

// Наличие координат, а не истинность: `0` — законная широта.
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
      // По календарным дням: «через 1 день» сменяется на «сегодня» в полночь.
      daysToStart: startKey
        ? Math.round(DateTime.fromISO(startKey).diff(DateTime.now().startOf('day'), 'days').days)
        : null,
    };
  }, [visits]);

  // Закрытая панелью площадь карты. На узком кадре панель уходит в поток под
  // карту — пересечения нет, закрытой площади тоже.
  const mapRef = useRef(/** @type {any} */ (null));
  const panelRef = useRef(/** @type {any} */ (null));
  const [closed, setClosed] = useState(/** @type {any} */ (null));
  const measure = useCallback(() => {
    const f = mapRef.current; const p = panelRef.current;
    if (!f || !p) return;
    const fr = f.getBoundingClientRect(); const pr = p.getBoundingClientRect();
    if (!fr.width || !pr.width) return;
    if (pr.bottom <= fr.top + 1 || pr.top >= fr.bottom - 1) {
      setClosed((cur) => (cur === null ? cur : null));
      return;
    }
    const box = { left: Math.round(pr.right - fr.left) };
    setClosed((cur) => (cur && cur.left === box.left ? cur : box));
  }, []);
  // `isLoading` в депах обязателен: в фазе загрузки рендерится скелетон без рефов,
  // и эффект с одним `measure` в депах не подписался бы на живую панель никогда.
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
      <Card pad="none" radius="lg" className="tframe">
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
            <EmptyState icon="map" title={t('overview.map_empty')} />
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
      </Card>

      {/* `orderedVisits` — сумма расстояния идёт по порядку маршрута, `visits`
          приходит в порядке выдачи API. */}
      <TripStatRow visits={visits} orderedVisits={ordered} transfers={transfers} trip={trip} />
    </>
  );
}

// Тот же кадр с теми же узлами: панель на своём месте, полоса чисел настоящая
// (со своим отступом от кадра), заглушки только вместо содержимого.
export function TripFrameSkeleton() {
  return (
    <>
      <Card pad="none" radius="lg" className="tframe">
        <div className="tframe__map"><Skeleton w="100%" h="100%" r={0} /></div>
        <div className="tframe__state"><Skeleton w="100%" h={132} r="var(--r-lg)" /></div>
      </Card>
      <TripStatRow isLoading />
    </>
  );
}
