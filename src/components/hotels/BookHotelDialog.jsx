import React from 'react';
import { DateTime } from 'luxon';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from '@/components/ui/dialog';
import { platformLogoUrl } from '@/lib/booking-platforms';
import { ExternalLink } from 'lucide-react';
import { useT } from '@/lib/i18n/I18nContext';
import { usePartnerLogger } from '@/lib/partnerTracking';

function buildBookingUrl(visit) {
  const tz = visit.timezone || 'UTC';
  const checkin = visit.start_datetime
    ? DateTime.fromISO(visit.start_datetime, { zone: 'utc' }).setZone(tz).toFormat('yyyy-LL-dd')
    : '';
  const checkout = visit.end_datetime
    ? DateTime.fromISO(visit.end_datetime, { zone: 'utc' }).setZone(tz).toFormat('yyyy-LL-dd')
    : '';
  let safeCheckout = checkout;
  if (checkin && checkout && checkout <= checkin) {
    const d = new Date(checkin);
    d.setDate(d.getDate() + 1);
    safeCheckout = d.toISOString().slice(0, 10);
  }
  const params = new URLSearchParams({
    ss: visit.city_name + (visit.country ? `, ${visit.country}` : ''),
    lang: 'en-us',
    group_adults: '2',
    no_rooms: '1',
    group_children: '0',
    ...(checkin && { checkin }),
    ...(safeCheckout && { checkout: safeCheckout }),
  });
  return `https://www.booking.com/searchresults.html?${params.toString()}`;
}

function buildAirbnbUrl(visit) {
  const tz = visit.timezone || 'UTC';
  const checkin = visit.start_datetime
    ? DateTime.fromISO(visit.start_datetime, { zone: 'utc' }).setZone(tz).toFormat('yyyy-LL-dd')
    : '';
  const checkout = visit.end_datetime
    ? DateTime.fromISO(visit.end_datetime, { zone: 'utc' }).setZone(tz).toFormat('yyyy-LL-dd')
    : '';
  let safeCheckout = checkout;
  if (checkin && checkout && checkout <= checkin) {
    const d = new Date(checkin);
    d.setDate(d.getDate() + 1);
    safeCheckout = d.toISOString().slice(0, 10);
  }
  const slugify = (s) => s
    .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .replace(/[^\w\s-]/g, '')
    .trim()
    .replace(/\s+/g, '-');
  const slug = [visit.city_name, visit.country].filter(Boolean).map(slugify).filter(Boolean).join('--')
    || encodeURIComponent(visit.city_name || '');
  const params = new URLSearchParams({
    adults: '2',
    ...(checkin && { checkin }),
    ...(safeCheckout && { checkout: safeCheckout }),
  });
  return `https://www.airbnb.com/s/${slug}/homes?${params.toString()}`;
}

export default function BookHotelDialog({ open, onOpenChange, visit }) {
  const t = useT();
  const logClick = usePartnerLogger(visit?.trip_id);
  if (!visit) return null;
  const bookingUrl = buildBookingUrl(visit);
  const airbnbUrl = buildAirbnbUrl(visit);
  const bookingLogo = platformLogoUrl('booking');
  const airbnbLogo = platformLogoUrl('airbnb');

  const Option = ({ href, partner, logo, label, color }) => (
    <a
      href={href}
      target="_blank"
      rel="noreferrer"
      onClick={() => {
        logClick({ partner, type: 'hotel', link: href });
        onOpenChange(false);
      }}
      className={`flex items-center gap-3 px-4 py-3 rounded-xl border ${color} transition`}
    >
      {logo ? (
        <img src={logo} alt={label} className="w-7 h-7 rounded" />
      ) : (
        <ExternalLink className="w-5 h-5" />
      )}
      <div className="flex-1 min-w-0 text-left">
        <div className="text-sm font-semibold">{label}</div>
        <div className="text-xs opacity-70 truncate">
          {visit.city_name}{visit.country ? `, ${visit.country}` : ''}
        </div>
      </div>
      <ExternalLink className="w-4 h-4 opacity-60" />
    </a>
  );

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>{t('hotel.book_title')}</DialogTitle>
          <DialogDescription>{t('hotel.book_subtitle')}</DialogDescription>
        </DialogHeader>
        <div className="space-y-2 pt-2">
          <Option
            href={bookingUrl}
            partner="booking"
            logo={bookingLogo}
            label={t('hotel.book_on', { platform: 'Booking.com' })}
            color="border-blue-200 dark:border-blue-800 bg-blue-50 dark:bg-blue-950/40 text-blue-800 dark:text-blue-200 hover:bg-blue-100 dark:hover:bg-blue-900/40"
          />
          <Option
            href={airbnbUrl}
            partner="airbnb"
            logo={airbnbLogo}
            label={t('hotel.book_on', { platform: 'Airbnb.com' })}
            color="border-rose-200 dark:border-rose-800 bg-rose-50 dark:bg-rose-950/40 text-rose-800 dark:text-rose-200 hover:bg-rose-100 dark:hover:bg-rose-900/40"
          />
        </div>
      </DialogContent>
    </Dialog>
  );
}