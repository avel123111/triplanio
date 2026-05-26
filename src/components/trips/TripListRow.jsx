import React from 'react';
import { Link } from 'react-router-dom';
import { MapPin, ChevronRight, Users } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { useCityImageForVisits } from '@/lib/city-image';
import ProBadge from '@/components/subscriptions/ProBadge';
import { useI18nFormat } from '@/lib/i18n/I18nContext';
import { getTripCountryNames } from './tripPreviewMeta';

export default function TripListRow({ trip, cities, members, isInvited, role }) {
  const { t, plural, fmtCountry, locale } = useI18nFormat();
  const startDate = trip.start_date ? new Date(trip.start_date).toLocaleDateString(locale, { day: 'numeric', month: 'short' }) : null;
  const endDate = trip.end_date ? new Date(trip.end_date).toLocaleDateString(locale, { day: 'numeric', month: 'short', year: 'numeric' }) : null;
  const fallbackImg = useCityImageForVisits(trip.cover_image_url ? null : cities);
  const coverImg = trip.cover_image_url || fallbackImg;
  const cityCount = cities?.filter(c => c.kind === 'transit' || (!c.kind)).length || 0;
  const countryDisplay = getTripCountryNames(cities, fmtCountry, t);

  return (
    <Link to={`/trip/${trip.id}`}>
      <div className="flex items-center justify-between gap-4 p-4 rounded-xl border border-border bg-card hover:bg-secondary transition cursor-pointer">
        <div className="flex items-center gap-3 flex-1 min-w-0">
          {/* Image */}
          <div className="w-20 h-20 rounded-lg shrink-0 overflow-hidden bg-muted">
            {coverImg ? (
              <img src={coverImg} alt={trip.title} className="w-full h-full object-cover" />
            ) : (
              <div className="w-full h-full bg-gradient-to-br from-blue-300 via-indigo-400 to-orange-300" />
            )}
          </div>

          {/* Title & Details */}
          <div className="min-w-0 flex-1">
            <h3 className="font-semibold text-foreground truncate">{trip.title}</h3>
            {startDate && endDate && (
              <div className="text-sm text-muted-foreground mt-0.5">{startDate} → {endDate}</div>
            )}
            <div className="h-5 flex items-center gap-1.5 text-sm text-muted-foreground mt-0.5">
              {cityCount > 0 && (
                <>
                  <MapPin className="w-4 h-4 shrink-0" />
                  <span>{cityCount} {plural(cityCount, 'trip.cities_count')} · {countryDisplay}</span>
                </>
              )}
            </div>
          </div>
        </div>

        {/* Status badges */}
        <div className="flex items-center gap-2 whitespace-nowrap shrink-0">
          {trip.is_pro_trip && <ProBadge size="md" />}
          {isInvited && (
            <Badge variant="outline" className="text-xs gap-1.5 bg-slate-800/75 text-white border-transparent hover:bg-slate-800/75">
              <Users className="w-3 h-3" />{t('trips.shared_badge')}
            </Badge>
          )}
        </div>

        <ChevronRight className="w-5 h-5 text-muted-foreground shrink-0" />
      </div>
    </Link>
  );
}