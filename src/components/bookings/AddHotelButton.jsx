import React, { useState } from 'react';
import { Plus } from 'lucide-react';
import BookingChoiceDialog from '@/components/bookings/BookingChoiceDialog';
import { hotelPlatforms } from '@/components/bookings/buildBookingPlatforms';
import { useI18nFormat } from '@/lib/i18n/I18nContext';
import { usePartnerLogger } from '@/lib/partnerTracking';

/**
 * Warning-style "Add" button for missing accommodation in a city.
 * Opens BookingChoiceDialog with manual entry + booking platforms.
 */
export default function AddHotelButton({ visit, onManual, className = '' }) {
  const { t } = useI18nFormat();
  const logClick = usePartnerLogger(visit?.trip_id);
  const [open, setOpen] = useState(false);
  if (!visit) return null;

  return (
    <>
      <button
        type="button"
        onClick={(e) => { e.stopPropagation(); setOpen(true); }}
        className={`inline-flex items-center h-9 px-3.5 gap-1.5 rounded-lg bg-primary text-primary-foreground text-sm font-semibold hover:bg-primary/90 transition ${className}`}
      >
        <Plus className="w-4 h-4" />
        <span>{t('common.add')}</span>
      </button>
      <BookingChoiceDialog
        open={open}
        onOpenChange={setOpen}
        title={t('hotel.choice_title')}
        description={t('hotel.choice_description')}
        manualLabel={t('hotel.choice_manual')}
        manualHint={t('hotel.choice_manual_hint')}
        onManual={() => onManual?.(visit)}
        onPlatformClick={(p) => logClick({ partner: p.key, type: 'hotel', link: p.url })}
        platforms={hotelPlatforms(visit, t)}
      />
    </>
  );
}