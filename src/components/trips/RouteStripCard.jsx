// @ts-check
import React, { useMemo } from 'react';
import { Card, Chip } from '@/design/index';
import { Icon } from '@/design/icons';
import { useI18n } from '@/lib/i18n/I18nContext';
import { sortVisits } from '@/lib/validation';
import { parseNaive } from '@/lib/naive-time';
import { formatTripRange } from '@/lib/trip-dates';
import { transferKind } from '@/lib/transport';

// Лента маршрута — сердце «командного центра» Обзора (редизайн экранов, задача
// Pavel): остановки трипа списком в ЯЗЫКЕ ПИНОВ КАРТЫ (.tmk ring-маркеры с теми
// же номерами, что на карте рядом), между ними — чипы переездов (канон <Chip>,
// иконки transport-словаря). Клик по остановке/чипу выделяет её и ПЕРЕЛЕТАЕТ
// карту-канвас (selectedId/onStopClick держит OverviewLens). Разрыв без переезда
// редактору показывается пунктирным чипом «Добавить переезд» (открывает
// Планирование); наблюдателю разрыв не мозолит глаза.
//
// Данные — те же visits/transfers, что у карты и хронологии: ночи считаются из
// дат визита (как рейл городов хронологии), переезд ищется по паре
// from_city_visit_id → to_city_visit_id (тот же ключ, что у MapView).
export default function RouteStripCard({
  visits = [],
  transfers = [],
  selectedId = null,
  onStopClick,
  onOpenEdit = null,
  canManage = false,
}) {
  const { t } = useI18n();
  const stops = useMemo(
    () => sortVisits(visits).filter((v) => v.kind !== 'start' && v.kind !== 'end' && v.kind !== 'waypoint'),
    [visits],
  );
  const legByPair = useMemo(() => {
    const m = new Map();
    for (const tr of transfers) m.set(`${tr.from_city_visit_id}__${tr.to_city_visit_id}`, tr);
    return m;
  }, [transfers]);

  if (stops.length === 0) return null;

  const nights = (v) => {
    const s = parseNaive(v.start_date), e = parseNaive(v.end_date);
    if (!s || !e) return 0;
    return Math.max(0, Math.round(e.diff(s, 'days').days));
  };

  return (
    <Card radius="lg" pad="none" className="ov-route">
      <div className="wdg-h">
        <span className="wi"><Icon name="route" size={17} /></span>
        <h4>{t('planner.step_cities')}</h4>
      </div>
      <div className="wdg-b">
        {stops.map((v, i) => {
          const leg = i > 0 ? legByPair.get(`${stops[i - 1].id}__${v.id}`) : null;
          const meta = leg ? transferKind(leg.transport_type) : null;
          const n = nights(v);
          const range = v.start_date ? formatTripRange([v], '–') : '';
          const sel = selectedId === v.id;
          // Шов между остановками: чип переезда, а на разрыве без переезда —
          // пунктирный «Добавить переезд» и только редактору (см. шапку файла).
          const showLeg = i > 0 && (meta || (canManage && onOpenEdit));
          return (
            <React.Fragment key={v.id}>
              {showLeg && (
                <div className="ov-leg">
                  {meta ? (
                    <Chip sm icon={meta.icon} onClick={() => onStopClick?.(v)} title={t(meta.labelKey)}>
                      {t(meta.labelKey)}
                    </Chip>
                  ) : (
                    <Chip sm variant="placeholder" icon="plus" onClick={onOpenEdit}>
                      {t('trip.add_transfer')}
                    </Chip>
                  )}
                </div>
              )}
              <button
                type="button"
                className={'ov-stop' + (sel ? ' is-sel' : '')}
                onClick={() => onStopClick?.(v)}
                aria-pressed={sel || undefined}
              >
                <span className={'tmk' + (sel ? ' is-sel' : '')}><span className="tmk__core">{i + 1}</span></span>
                <span className="col col--g1 grow--fit">
                  <b className="t-label">{v.city_name}</b>
                  <span className="t-meta muted">
                    {range}{n > 0 ? ` · ${n} ${t('overview.unit_nights')}` : ''}
                  </span>
                </span>
              </button>
            </React.Fragment>
          );
        })}
      </div>
    </Card>
  );
}
