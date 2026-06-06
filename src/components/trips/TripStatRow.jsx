import React from 'react';
import { Icon } from '@/design/icons';
import { useI18n } from '@/lib/i18n/I18nContext';
import { tripStats } from '@/lib/trip-stats';

// Five at-a-glance trip stats (Lumo .statrow / .statcard): cities, countries,
// transfers, route distance (great-circle approximation), and duration.
// `orderedVisits` (trip order, for the distance sum) is optional — falls back to
// `visits` inside tripStats.
export default function TripStatRow({ visits = [], transfers = [], trip, orderedVisits }) {
  const { t } = useI18n();
  const s = tripStats({ visits, transfers, trip, orderedVisits });

  const cards = [
    { key: 'cities', icon: 'pin', value: s.cities, label: t('overview.stat_cities') },
    { key: 'countries', icon: 'globe', value: s.countries, label: t('overview.stat_countries') },
    { key: 'transfers', icon: 'plane', value: s.transfers, label: t('overview.stat_transfers') },
    {
      key: 'distance',
      icon: 'ruler',
      value: (
        <>
          {s.distanceKm.toLocaleString('ru-RU')}
          <span className="statcard-unit"> {t('overview.unit_km')}</span>
        </>
      ),
      label: t('overview.stat_distance'),
    },
    {
      key: 'duration',
      icon: 'calendar',
      value: (
        <>
          {s.days}
          <span className="statcard-unit"> {t('overview.unit_days')} · </span>
          {s.nights}
          <span className="statcard-unit"> {t('overview.unit_nights')}</span>
        </>
      ),
      label: t('overview.stat_duration'),
    },
  ];

  return (
    <div className="statrow">
      {cards.map((c, i) => (
        <div className="statcard" key={c.key} style={{ '--i': i }}>
          <div className="v num">{c.value}</div>
          <div className="k">
            <Icon name={c.icon} size={12} />
            {c.label}
          </div>
        </div>
      ))}
    </div>
  );
}
