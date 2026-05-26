import React, { useState } from 'react';
import { Plus } from 'lucide-react';
import BookingChoiceDialog from '@/components/bookings/BookingChoiceDialog';
import { transferPlatforms } from '@/components/bookings/buildBookingPlatforms';
import { useI18nFormat } from '@/lib/i18n/I18nContext';
import { usePartnerLogger } from '@/lib/partnerTracking';

/**
 * Warning-style "Add" button for a missing transfer between two visits.
 * Opens BookingChoiceDialog with manual entry + transit booking platforms.
 */
export default function AddTransferButton({ fromVisit, toVisit, onManual, className = '' }) {
  const { t } = useI18nFormat();
  const logClick = usePartnerLogger(fromVisit?.trip_id || toVisit?.trip_id);
  const [open, setOpen] = useState(false);
  if (!fromVisit || !toVisit) return null;

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
        title={t('transfer.add_dialog_title')}
        description={t('transfer.add_dialog_desc')}
        manualLabel={t('transfer.manual_short')}
        manualHint={t('transfer.manual_hint_have_tickets')}
        onManual={() => onManual?.(fromVisit, toVisit)}
        onPlatformClick={(p) => logClick({ partner: p.key, type: 'transfer', link: p.url })}
        platforms={transferPlatforms(fromVisit, toVisit, t)}
      />
    </>
  );
}