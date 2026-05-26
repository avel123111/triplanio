import React from 'react';
import { Link } from 'react-router-dom';
import { Calendar, MapPin, ShieldCheck, Eye } from 'lucide-react';
import { countryFlag } from '@/lib/geo';
import { formatTripRange } from '@/lib/trip-dates';
import { uniqueCityCount } from '@/lib/trip-cities';
import { useCityImageForVisits } from '@/lib/city-image';
import ProBadge from '@/components/subscriptions/ProBadge';
import { useI18nFormat } from '@/lib/i18n/I18nContext';

// Role badges are shown ONLY for shared trips (admin / viewer).
// The owner role is implicit and doesn't need a badge on their own trip cards.
const ROLE_META = {
  admin: { Icon: ShieldCheck, tKey: 'trips.role_admin', cls: 'bg-primary/15 text-primary' },
  viewer: { Icon: Eye, tKey: 'trips.role_viewer', cls: 'bg-secondary text-secondary-foreground' },
};

export default function TripCard({ trip, visits = [], currentUserRole }) {
  const { t, plural } = useI18nFormat();
  const uniqueCountries = [...new Set(visits.map(c => c.country_code).filter(Boolean))].slice(0, 6);
  const dateRange = formatTripRange(visits, t('trip.no_dates'));
  const cityCount = uniqueCityCount(visits);
  const roleMeta = currentUserRole ? ROLE_META[currentUserRole] : null;
  // Live-fetched image from Wikipedia for the first transit city (same source
  // as CityHero). Not persisted on the trip — purely rendered on the fly.
  const fallbackImg = useCityImageForVisits(trip.cover_image_url ? null : visits);
  const coverImg = trip.cover_image_url || fallbackImg;

  return (
    <Link to={`/trip/${trip.id}`} className="group block rounded-2xl overflow-hidden border border-border bg-card hover:shadow-xl hover:border-primary/30 transition-all duration-300">
      <div className="relative aspect-[16/10] overflow-hidden bg-gradient-to-br from-primary/20 via-accent/10 to-primary/5">
        {coverImg ? (
          <img src={coverImg} alt={trip.title} className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-500" />
        ) : (
          <div className="w-full h-full flex items-center justify-center text-6xl opacity-30">
            ✈️
          </div>
        )}
        <div className="absolute inset-0 bg-gradient-to-t from-black/60 via-black/0 to-black/0" />
        <div className="absolute top-3 left-3 flex gap-1.5">
          {roleMeta && (
            <div className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[11px] font-semibold shadow-md ${roleMeta.cls}`}>
              <roleMeta.Icon className="w-3 h-3" />{t(roleMeta.tKey)}
            </div>
          )}
          {trip.is_pro_trip && <ProBadge size="sm" />}
        </div>
        {uniqueCountries.length > 0 && (
          <div className="absolute top-3 right-3 flex gap-1 text-2xl drop-shadow-lg">
            {uniqueCountries.map(cc => <span key={cc}>{countryFlag(cc)}</span>)}
          </div>
        )}
        <div className="absolute bottom-0 left-0 right-0 p-4 text-white">
          <h3 className="font-display font-bold text-xl leading-tight drop-shadow line-clamp-2">{trip.title}</h3>
        </div>
      </div>
      <div className="p-4 flex items-center justify-between text-sm">
        <div className="flex items-center gap-1.5 text-muted-foreground">
          <Calendar className="w-3.5 h-3.5" />
          <span>{dateRange}</span>
        </div>
        <div className="flex items-center gap-1.5 text-muted-foreground">
          <MapPin className="w-3.5 h-3.5" />
          <span>{cityCount} {plural(cityCount, 'trip.cities_count')}</span>
        </div>
      </div>
    </Link>
  );
}