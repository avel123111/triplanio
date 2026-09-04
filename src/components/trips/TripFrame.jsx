// @ts-check
import React, { useMemo, useState } from 'react';
import { Btn, Card, Meter, Skeleton } from '@/design/index';
import { Icon } from '@/design/icons';
import MapView from '@/components/views/MapView';
import TripStatRow from '@/components/trips/TripStatRow';
import { useI18n, useI18nFormat } from '@/lib/i18n/I18nContext';
import { useTheme } from '@/lib/ThemeContext';
import { computeTripRange, currentCityVisit, formatDateRange, tripPhase, tripProgress } from '@/lib/trip-dates';
import { buildPreparation } from '@/lib/trip-preparation';
import { naiveDayKey } from '@/lib/naive-time';
import { DateTime } from 'luxon';

// ГЕРОЙ ЭКРАНА ПОЕЗДКИ — карта во всю ширину, состояние одной панелью поверх неё.
//
// ★ ОДИН ГЕРОЙ, И ЭТО МАРШРУТ. Смелость экрана потрачена ровно здесь: карта
// занимает всю ширину и 440 px высоты, без шапки, без рамки, без соседей по
// строке. Всё остальное на экране — тихие типографические секции. Прежняя
// редакция склеивала в один ряд ТРИ разные плотности (фото · текст · карта)
// жёсткими швами: это не композиция, это три панели, свинченные вместе.
//
// ★ ОБЛОЖКИ ЗДЕСЬ НЕТ НАМЕРЕННО. У поездки без своего фото она подставляет
// стоковый фоллбек — картинку, не имеющую отношения к этому маршруту, — и
// занимает под неё треть героя. Случайная картинка хуже, чем её отсутствие.
// Обложка остаётся там, где опознаёт поездку среди других: на карточках главной.
//
// ★ ПАНЕЛЬ СОСТОЯНИЯ — КАНОН-ПОВЕРХНОСТЬ (`<Card raised>`), положенная поверх
// карты, а не сшитая с ней встык. Поэтому у неё свои углы, своя тень и свой
// фон: она читается как предмет НА карте, и никакого шва не возникает.

/** @param {{ trip?: any, visits?: any[], hotels?: any[], transfers?: any[],
 *            active?: boolean, isLoading?: boolean, onOpenMap?: any }} p */
export default function TripFrame({
  trip, visits = [], hotels = [], transfers = [], active = true, isLoading = false, onOpenMap,
}) {
  const { t } = useI18n();
  const { fmtDate, plural } = useI18nFormat();
  const { isDark } = useTheme();

  const [hoveredId, setHoveredId] = useState(/** @type {any} */ (null));
  const [selectedId, setSelectedId] = useState(/** @type {any} */ (null));
  const badgeId = hoveredId ?? selectedId;
  const cityBadge = useMemo(() => {
    if (badgeId == null) return null;
    const v = (visits || []).find((x) => String(x.id) === String(badgeId));
    if (!v || v.latitude == null || v.longitude == null) return null;
    return {
      lng: v.longitude, lat: v.latitude, countryCode: v.country_code, name: v.city_name,
      dates: formatDateRange(v.start_date, v.end_date, (iso) => fmtDate(iso)),
    };
  }, [badgeId, visits, fmtDate]);

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

  const prep = useMemo(
    () => buildPreparation({ visits, hotels, transfers }),
    [visits, hotels, transfers],
  );

  if (isLoading) return <TripFrameSkeleton />;

  const hasRoute = (visits || []).some((v) => v?.latitude && v?.longitude);
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

  const { done, total, pct } = prep;
  const complete = total > 0 && done === total;

  return (
    <>
      <div className="tframe">
        {hasRoute ? (
          <MapView
            visits={visits}
            transfers={transfers}
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

        <Card radius="lg" raised className="tframe__state">
          <div className="t-title">{headline}</div>
          {sub && <div className="t-support muted">{sub}</div>}
          {total > 0 && (
            <>
              <div className="t-meta muted">{t('overview.prep_sub', { done, total })}</div>
              <Meter
                className="meter--flush"
                ariaLabel={t('overview.prep_sub', { done, total })}
                segments={[
                  { key: 'done', value: done, color: complete ? 'var(--success)' : 'var(--brand)' },
                  { key: 'rest', value: total - done, color: 'transparent' },
                ]}
              />
            </>
          )}
        </Card>

        <Btn variant="secondary" className="tframe__open" iconRight="chev" onClick={onOpenMap}>
          {t('overview.open')}
        </Btn>
      </div>

      <TripStatRow visits={visits} transfers={transfers} trip={trip} />
    </>
  );
}

export function TripFrameSkeleton() {
  return (
    <>
      <div className="tframe"><Skeleton w="100%" h="100%" r={0} /></div>
      <div className="tframe__nums"><Skeleton w="52%" h={13} r={5} /></div>
    </>
  );
}
