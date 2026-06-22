import React from 'react';
import { Icon } from '@/design/icons';
import { useI18nFormat } from '@/lib/i18n/I18nContext';
import { tripStats } from '@/lib/trip-stats';

// Five at-a-glance trip stats (Lumo .statrow / .statcard): cities, countries,
// transfers, route distance (great-circle approximation), and duration.
// `orderedVisits` (trip order, for the distance sum) is optional — falls back to
// `visits` inside tripStats.
export default function TripStatRow({ visits = [], transfers = [], trip, orderedVisits }) {
  const { t, fmtNumber } = useI18nFormat();
  const s = tripStats({ visits, transfers, trip, orderedVisits });

  const cards = [
    { key: 'cities', icon: 'buildings', tone: 'city', value: s.cities, label: t('overview.stat_cities') },
    { key: 'countries', icon: 'globe', tone: null, value: s.countries, label: t('overview.stat_countries') },
    { key: 'transfers', icon: 'arrowSwap', tone: 'transfer', value: s.transfers, label: t('overview.stat_transfers') },
    { key: 'distance', icon: 'route', tone: 'distance', value: fmtNumber(s.distanceKm), label: t('overview.unit_km') },
    { key: 'duration', icon: 'calendar', tone: 'duration', value: s.days, label: t('overview.unit_days') },
  ];

  return (
    <div className="statrow">
      {cards.map((c, i) => (
        <div className={`statcard${c.tone ? ` c-${c.tone}` : ''}`} key={c.key} style={{ '--i': i }}>
          <span className="ic"><Icon name={c.icon} size={20} /></span>
          <div className="meta">
            <div className="v num">{c.value}</div>
            <div className="k">{c.label}</div>
          </div>
        </div>
      ))}
    </div>
  );
}
