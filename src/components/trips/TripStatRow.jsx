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
// ★ ФАЗУ ЗАГРУЗКИ РИСУЕТ САМА ПОЛОСА, а не прямоугольник рядом с ней. У `.statbar`
// СВОЙ `margin-top: 18px` — placeholder, собранный из `<Skeleton>`, его не несёт и
// прилипает к кадру карты. Здесь загрузка = ТЕ ЖЕ пять ячеек той же полосы, у
// которых вместо числа и подписи стоят заглушки: отступ, высота, размеры плиток и
// все контейнерные правила приходят из одного и того же кода.
/**
 * ⚠️ ТИП ОБЪЯВЛЕН ЦЕЛЫМ ОБЪЕКТОМ, а не выведен из деструктуризации: иначе
 * «необязательным» оказывается ровно то, у чего есть ДЕФОЛТ, и `<TripStatRow
 * isLoading />` из файла под `// @ts-check` краснеет требованием `trip` и
 * `orderedVisits`, хотя в фазе загрузки данных нет по определению.
 *
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

// Ячейка в фазе загрузки: место числа и подписи занимают заглушки, плитка стоит
// пустой и без тона (цветной квадрат с иконкой читался бы как готовые данные).
const blank = (it) => ({
  key: it.key,
  icon: null,
  value: <Skeleton w={34} h={22} r={6} />,
  label: <Skeleton w={54} h={11} r={5} />,
});
