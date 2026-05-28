import React, { useState } from 'react';
import { Plus } from 'lucide-react';
import ForkPartnerModal from '@/components/bookings/ForkPartnerModal';
import { useI18nFormat } from '@/lib/i18n/I18nContext';

/**
 * Warning-style "Add" button for missing accommodation in a city.
 * Opens ForkPartnerModal with manual entry + booking partners.
 */
export default function AddHotelButton({ visit, onManual, className = '' }) {
  const { t } = useI18nFormat();
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
      <ForkPartnerModal
        open={open}
        onOpenChange={setOpen}
        type="hotel"
        visit={visit}
        tripId={visit?.trip_id}
        onManual={() => onManual?.(visit)}
      />
    </>
  );
}
