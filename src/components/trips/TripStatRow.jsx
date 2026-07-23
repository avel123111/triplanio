import React from 'react';
import { Icon } from '@/design/icons';
import { useI18nFormat } from '@/lib/i18n/I18nContext';
import { tripStats } from '@/lib/trip-stats';
import { StatBar } from '@/components/stats/widgets';

// Five at-a-glance trip stats rendered as the shared .statbar polosa — the same
// primitive as the /trips home bar (TRIP-278), panel-skinned per the trip-screen
// surface canon (TRIP-189). Metrics: cities, countries, transfers, route distance
// (great-circle approximation) and duration. `orderedVisits` (trip order, for the
// distance sum) is optional — falls back to `visits` inside tripStats.
export default function TripStatRow({ visits = [], transfers = [], trip, orderedVisits }) {
  const { t, fmtDistance } = useI18nFormat();
  const s = tripStats({ visits, transfers, trip, orderedVisits });
  const dist = fmtDistance(s.distanceKm);

  // Order = desktop column order (mockup v01). Distance keeps its 4th slot on
  // desktop; the stat-bar reflows it full-width at the bottom on mobile.
  const items = [
    { key: 'cities', tone: 'city', value: s.cities, label: t('overview.stat_cities'), icon: <Icon name="buildings" size={20} /> },
    { key: 'countries', value: s.countries, label: t('overview.stat_countries'), icon: <Icon name="globe" size={20} /> },
    { key: 'transfers', tone: 'transfer', value: s.transfers, label: t('overview.stat_transfers'), icon: <Icon name="arrowSwap" size={20} /> },
    { key: 'distance', tone: 'distance', value: dist.value, label: dist.unit, icon: <Icon name="route" size={20} /> },
    { key: 'duration', tone: 'duration', value: s.days, label: t('overview.unit_days'), icon: <Icon name="calendar" size={20} /> },
  ];

  return <StatBar items={items} className="surface-panel" />;
}
