// @ts-check
import React from 'react';
import { useI18nFormat } from '@/lib/i18n/I18nContext';
import { tripStats } from '@/lib/trip-stats';

// Числа маршрута — ТИХОЙ СТРОКОЙ в подвале кадра поездки.
//
// ★ БЫЛА ПОЛОСА ИЗ ПЯТИ ПЛИТОК с цветными квадратами-иконками, 80 px высотой,
// вторая по громкости вещь на экране после карты. При этом сообщает она самое
// незначительное: сколько городов и сколько дней. Громкость элемента обязана
// соответствовать важности того, что он говорит, — здесь было ровно наоборот.
//
// ★ Общий примитив `<StatBar>` тут больше не при чём: он остаётся полосой
// плиток там, где плитки уместны (главная, статистика). Обзору нужна не полоса,
// а подпись под кадром, и это РАЗНЫЕ объекты, а не два вида одного.
/** @param {{ visits?: any[], transfers?: any[], trip?: any, orderedVisits?: any[] }} p */
export default function TripStatRow({ visits = [], transfers = [], trip, orderedVisits }) {
  const { fmtDistance, plural } = useI18nFormat();
  const s = tripStats({ visits, transfers, trip, orderedVisits });
  const dist = fmtDistance(s.distanceKm);

  // Формы множественного числа берутся у СУЩЕСТВУЮЩИХ ключей; свои заведены
  // только там, где готовой формы не было (переезды). Ключи `trip.cities_count`,
  // `tse.day` и `overview.n_transfers` — ГОЛЫЕ существительные (число подставляет
  // вызыватель), `stats.sum_countries` число уже несёт: формы разные, поэтому
  // строки собираются явно, а не одним циклом, который бы это молча перепутал.
  const parts = [
    `${s.cities} ${plural(s.cities, 'trip.cities_count')}`,
    plural(s.countries, 'stats.sum_countries', { count: s.countries }),
    `${s.transfers} ${plural(s.transfers, 'overview.n_transfers')}`,
    dist.value ? `${dist.value} ${dist.unit}` : '',
    `${s.days} ${plural(s.days, 'tse.day')}`,
  ].filter(Boolean);

  return (
    <div className="tframe__nums t-meta muted">
      {parts.map((x, i) => (
        <React.Fragment key={x + i}>
          {i > 0 && <span aria-hidden="true">·</span>}
          <span>{x}</span>
        </React.Fragment>
      ))}
    </div>
  );
}
