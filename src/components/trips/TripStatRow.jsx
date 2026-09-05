import React from 'react';
import { Icon } from '@/design/icons';
import { Skeleton } from '@/design/index';
import { useI18nFormat } from '@/lib/i18n/I18nContext';
import { tripStats } from '@/lib/trip-stats';
import { StatBar } from '@/components/stats/widgets';

// Five at-a-glance trip stats rendered as the shared .statbar polosa — the same
// primitive as the /trips home bar (TRIP-278); the surface skin comes from the
// canonical role group. Metrics: cities, countries, transfers, route distance
// (great-circle approximation) and duration. `orderedVisits` (trip order, for the
// distance sum) is optional — falls back to `visits` inside tripStats.
// Фаза загрузки — те же пять ячеек той же полосы с заглушками вместо числа и
// подписи: отступ полосы от кадра и контейнерные правила остаются её.
/**
 * Тип объявлен целиком: из деструктуризации `isLoading`-вызов без `trip` и
 * `orderedVisits` краснел бы под `// @ts-check`.
 * @param {{ visits?: any[], transfers?: any[], trip?: any,
 *           orderedVisits?: any[], isLoading?: boolean }} p
 */
export default function TripStatRow({ visits = [], transfers = [], trip, orderedVisits, isLoading = false }) {
  const { t, fmtDistance } = useI18nFormat();
  const s = tripStats({ visits, transfers, trip, orderedVisits });
  const dist = fmtDistance(s.distanceKm);

  // DOM order = the wrapped (2-column) reading order, so the narrow layout needs
  // no re-ordering and the divider rules stay identical to the /trips bar. On a
  // wide bar CSS pulls `duration` behind `distance` to restore the mockup's
  // desktop order: cities · countries · transfers · km · days.
  const items = [
    { key: 'cities', tone: 'city', value: s.cities, label: t('overview.stat_cities'), icon: <Icon name="buildings" /> },
    { key: 'countries', value: s.countries, label: t('overview.stat_countries'), icon: <Icon name="globe" /> },
    { key: 'transfers', tone: 'transfer', value: s.transfers, label: t('overview.stat_transfers'), icon: <Icon name="arrowSwap" /> },
    { key: 'duration', tone: 'duration', value: s.days, label: t('overview.unit_days'), icon: <Icon name="calendar" /> },
    { key: 'distance', tone: 'distance', value: dist.value, label: dist.unit, icon: <Icon name="route" /> },
  ];

  return <StatBar items={isLoading ? items.map(blank) : items} />;
}

// Плитка пустая и без тона: цветной квадрат с иконкой читался бы как данные.
const blank = (it) => ({
  key: it.key,
  icon: null,
  value: <Skeleton w={34} h={22} r={6} />,
  label: <Skeleton w={54} h={11} r={5} />,
});
