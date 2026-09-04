// @ts-check
import React from 'react';
import { Icon } from '@/design/icons';
import { useI18nFormat } from '@/lib/i18n/I18nContext';
import { tripStats } from '@/lib/trip-stats';
import { StatBar } from '@/components/stats/widgets';

// ★ ЭТО СНОВА ПОЛОСА ПЛИТОК, И ОНА ТАКОЙ ОСТАЁТСЯ. Был заход, переделавший её в
// тихую строку текста «8 городов · 3 страны · …» под кадром. Это регресс: числа
// стали мелкими и нечитаемыми, а виджет статистики перестал быть виджетом.
// Плитки — общий примитив `<StatBar>`, тот же, что на главной и в статистике.
//
// Five at-a-glance trip stats rendered as the shared .statbar polosa — the same
// primitive as the /trips home bar (TRIP-278); the surface skin comes from the
// canonical role group. Metrics: cities, countries, transfers, route distance
// (great-circle approximation) and duration. `orderedVisits` (trip order, for the
// distance sum) is optional — falls back to `visits` inside tripStats.
/**
 * ⚠️ АННОТАЦИЯ НА ЦЕЛЫЙ ОБЪЕКТ, а не построчно: без неё TS выводит тип из
 * ДЕСТРУКТУРИЗАЦИИ, и «необязательным» оказывается ровно то, у чего есть ДЕФОЛТ.
 * `orderedVisits` дефолта не имеет и молча становится обязательным, хотя внутри
 * `tripStats` он падает на `visits`.
 * @param {{ visits?: any[], transfers?: any[], trip?: any, orderedVisits?: any[] }} p
 */
export default function TripStatRow({ visits = [], transfers = [], trip, orderedVisits }) {
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

  return <StatBar items={items} />;
}
