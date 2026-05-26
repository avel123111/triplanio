import React, { useState } from 'react';
import { BedDouble } from 'lucide-react';
import BookHotelDialog from './BookHotelDialog';
import { useT } from '@/lib/i18n/I18nContext';

/**
 * "Book a stay" button — opens a dialog with platform choices (Booking.com / Airbnb).
 */
export default function BookHotelButton({ visit, className = '' }) {
  const t = useT();
  const [open, setOpen] = useState(false);
  if (!visit) return null;

  return (
    <>
      <button
        type="button"
        onClick={(e) => { e.stopPropagation(); setOpen(true); }}
        className={`inline-flex items-center h-9 px-3 gap-2 rounded-lg border border-blue-200 dark:border-blue-800 bg-blue-50 dark:bg-blue-950/40 text-blue-700 dark:text-blue-300 text-xs font-medium hover:bg-blue-100 dark:hover:bg-blue-900/40 transition ${className}`}
      >
        <BedDouble className="w-4 h-4" />
        <span>{t('hotel.book_button')}</span>
      </button>
      <BookHotelDialog open={open} onOpenChange={setOpen} visit={visit} />
    </>
  );
}