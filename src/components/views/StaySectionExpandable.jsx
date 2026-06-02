import React from 'react';
import { BedDouble, ArrowRight, ArrowLeft, ExternalLink } from 'lucide-react';
import { BOOKING_PLATFORMS, platformLogoUrl, normalizeExternalUrl } from '@/lib/booking-platforms';
import AddHotelButton from '@/components/bookings/AddHotelButton';
import { useI18nFormat } from '@/lib/i18n/I18nContext';
import { parseNaive, naiveDayKey, naiveMillis } from '@/lib/naive-time';

/**
 * Compact Stay block embedded inside the city hero card.
 * - No hotel & not same-day: rose "no accommodation" CTA.
 * - With hotels: one-row summary per hotel: icon · name · check-in · check-out · platform link.
 */
export default function StaySectionExpandable({ visit, hotels, onClickHotel, canEdit, onAddHotel }) {
  const { t } = useI18nFormat();

  // For same-day visits (start_date === end_date) we don't show the
  // "no hotel booked" prompt - the traveler isn't staying overnight.
  // Naive day comparison: timezones are intentionally ignored.
  const isSameDayVisit = (() => {
    if (!visit.start_datetime || !visit.end_datetime) return false;
    return naiveDayKey(visit.start_datetime) === naiveDayKey(visit.end_datetime);
  })();

  if (hotels.length === 0) {
    if (isSameDayVisit) return null;
    return (
      <div className="mx-4 mt-3 mb-4 rounded-xl border border-dashed border-orange-200 dark:border-orange-900/50 bg-orange-50/60 dark:bg-orange-950/15 px-3 py-2.5 flex items-center gap-3 opacity-100">
        <div className="w-10 h-10 rounded-lg bg-orange-100 dark:bg-orange-950/40 flex items-center justify-center shrink-0">
          <BedDouble className="w-4 h-4 text-orange-500 dark:text-orange-300" />
        </div>
        <div className="min-w-0 flex-1">
          <div className="text-sm font-semibold text-orange-700 dark:text-orange-200">{t('visit.stay_in_city', { city: visit.city_name })}</div>
          <div className="text-xs text-orange-600/80 dark:text-orange-300/80 break-words">{t('visit.stay_not_added')}</div>
        </div>
        {canEdit && <AddHotelButton visit={visit} onManual={onAddHotel} />}
      </div>);

  }

  const sorted = [...hotels].sort((a, b) =>
    naiveMillis(a.check_in_datetime) - naiveMillis(b.check_in_datetime)
  );

  return (
    <div className="px-4 pb-4 pt-3 border-t flex flex-col gap-2">
      {sorted.map((h) =>
      <HotelRow key={h.id} hotel={h} onClick={() => onClickHotel?.(h)} />
      )}
    </div>);

}

function HotelRow({ hotel, onClick }) {
  const { t } = useI18nFormat();
  // Naive wall-clock - timezone is intentionally ignored.
  const ci = parseNaive(hotel.check_in_datetime);
  const co = parseNaive(hotel.check_out_datetime);
  const info = hotel.booking_platform ? BOOKING_PLATFORMS[hotel.booking_platform] : null;
  const logo = platformLogoUrl(hotel.booking_platform, hotel.booking_url);
  const bookingUrl = normalizeExternalUrl(hotel.booking_url);

  const nights = ci && co ? Math.max(0, Math.round(co.diff(ci, 'days').days)) : 0;

  return (
    <div
      onClick={onClick}
      className="rounded-xl border border-border bg-background px-3 py-2.5 hover:bg-secondary/40 cursor-pointer transition flex items-center gap-3 min-w-0">
      
      <div className="w-9 h-9 rounded-lg bg-primary/10 text-primary flex items-center justify-center shrink-0">
        <BedDouble className="w-4 h-4" />
      </div>
      <div className="flex-1 min-w-0">
        <div className="text-sm font-semibold truncate flex items-center gap-2 flex-wrap">
          <span>{hotel.name}</span>
          {logo && info && hotel.booking_platform !== 'other' && (
            <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] font-semibold border border-border bg-card">
              <img src={logo} alt="" className="w-3 h-3 rounded-sm" />
              {info.label}
            </span>
          )}
        </div>
        <div className="text-[11px] text-muted-foreground mt-0.5 flex flex-wrap items-center gap-x-1.5 gap-y-0.5 min-w-0">
          {ci && <span>{t('view.checkin')} {ci.toFormat('d LLL HH:mm')}</span>}
          {ci && co && <span>·</span>}
          {co && <span>{t('view.checkout')} {co.toFormat('d LLL HH:mm')}</span>}
          {nights > 0 && <span>· {nights} {t('view.nights_few')}</span>}
        </div>
      </div>
      {bookingUrl &&
      <a
        href={bookingUrl}
        target="_blank"
        rel="noreferrer"
        onClick={(e) => e.stopPropagation()}
        className="shrink-0 inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-[11px] font-semibold bg-background hover:bg-secondary border border-border transition">
          <ExternalLink className="w-3 h-3" />
          {t('view.view_booking')}
        </a>
      }
    </div>);

}