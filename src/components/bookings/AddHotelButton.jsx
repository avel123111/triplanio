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
        className={`btn btn--primary btn--sm ${className}`}
      >
        <Plus size={16} />
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
