import React from 'react';
import { Link } from 'react-router-dom';
import { MapPin, Users } from 'lucide-react';
import { useCityImageForVisits } from '@/lib/city-image';
import ProBadge from '@/components/subscriptions/ProBadge';
import { useI18nFormat } from '@/lib/i18n/I18nContext';
import { getTripCountryNames } from './tripPreviewMeta';

export default function TripCardGrid({ trip, cities, members, isInvited, role }) {
  const { t, plural, fmtCountry, locale } = useI18nFormat();
  const startDate = trip.start_date ? new Date(trip.start_date).toLocaleDateString(locale, { day: 'numeric', month: 'short' }) : null;
  const endDate = trip.end_date ? new Date(trip.end_date).toLocaleDateString(locale, { day: 'numeric', month: 'short', year: 'numeric' }) : null;
  const fallbackImg = useCityImageForVisits(trip.cover_image_url ? null : cities);
  const coverImg = trip.cover_image_url || fallbackImg;
  const cityCount = cities?.filter(c => c.kind === 'transit' || (!c.kind)).length || 0;
  const countryDisplay = getTripCountryNames(cities, fmtCountry, t);

  return (
    <Link to={`/trip/${trip.id}`} className="group">
      <div className="rounded-2xl border border-border overflow-hidden bg-card hover:shadow-lg transition cursor-pointer flex flex-col h-full">
        {/* Image with badges */}
        <div className="relative aspect-video bg-muted overflow-hidden m-4 mb-0 rounded-2xl">
          {coverImg ? (
            <img src={coverImg} alt={trip.title} className="w-full h-full object-cover group-hover:scale-105 transition" />
          ) : (
            <div className="w-full h-full bg-gradient-to-br from-blue-300 via-indigo-400 to-orange-300" />
          )}
          {/* Badges on image top-right */}
          <div className="absolute top-3 right-3 flex items-center gap-2">
            {trip.is_pro_trip && <ProBadge size="lg" />}
            {isInvited && (
              <div className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-slate-800/75 text-white text-xs font-semibold shadow-sm backdrop-blur-sm">
                <Users className="w-3.5 h-3.5" />{t('trips.shared_badge')}
              </div>
            )}
          </div>
        </div>

        {/* Content */}
        <div className="p-4 flex-1 flex flex-col">
          {/* Title row with role badge */}
          <div className="flex items-center gap-2 mb-1">
            <h3 className="font-display font-bold text-lg text-foreground truncate flex-1">{trip.title}</h3>
            {isInvited && role && (
              <span className="shrink-0 px-3 py-0.5 rounded-full bg-primary/10 text-primary text-xs font-semibold">
                {role === 'admin' ? t('trips.role_admin') : t('trips.role_viewer')}
              </span>
            )}
          </div>
          
          <div className="space-y-1.5 text-sm">
            {/* Dates */}
            {startDate && endDate && (
              <div className="text-muted-foreground">
                {startDate} → {endDate}
              </div>
            )}
            
            {/* Cities & Countries — hidden when no cities */}
            <div className="h-5 flex items-center gap-1.5 text-muted-foreground">
              {cityCount > 0 && (
                <>
                  <MapPin className="w-4 h-4 shrink-0" />
                  <span>{cityCount} {plural(cityCount, 'trip.cities_count')} · {countryDisplay}</span>
                </>
              )}
            </div>
          </div>
        </div>
      </div>
    </Link>
  );
}