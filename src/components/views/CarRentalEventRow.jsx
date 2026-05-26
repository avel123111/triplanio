import React from 'react';
import { Car, ArrowRight } from 'lucide-react';
import { BOOKING_PLATFORMS } from '@/lib/booking-platforms';
import { useI18nFormat } from '@/lib/i18n/I18nContext';

/**
 * Car-rental pickup/drop-off row. Matches the rest of the timeline:
 * green square icon on the rail (absolute, over the parent's w-10 column),
 * white card with title + time chip on the right.
 */
export default function CarRentalEventRow({ kind, time, service, onClick }) {
  const { t } = useI18nFormat();
  const isPickup = kind === 'car-pickup';
  const details = service?.details || {};
  const provider = details.booking_platform ? BOOKING_PLATFORMS[details.booking_platform] : null;
  const providerLabel = (provider && details.booking_platform !== 'other' ? provider.label : null) || service?.name || t('car.fallback_name');
  const label = isPickup ? t('car.pickup_event') : t('car.dropoff_event');

  return (
    <button
      type="button"
      onClick={onClick}
      className="block w-full text-left hover:opacity-90 transition"
    >
      <div className="relative">
        {/* Rail icon — absolute over the parent's w-10 spacer column */}
        <div
          data-rail-anchor="true"
          className="absolute -left-[3.5rem] top-1/2 -translate-y-1/2 z-10 w-10 h-10 rounded-xl flex items-center justify-center bg-emerald-100 text-emerald-700 dark:bg-emerald-950/40 dark:text-emerald-300"
        >
          <Car className="w-4 h-4" />
        </div>
        {/* Card body — time chip on the LEFT, matching other timeline events */}
        <div className="flex items-center gap-3 px-4 py-3 rounded-2xl border border-border bg-card">
          <div className="shrink-0 px-2.5 py-1 rounded-md text-xs font-semibold tabular-nums bg-emerald-50 text-emerald-700 dark:bg-emerald-950/30 dark:text-emerald-300">
            {time.toFormat('HH:mm')}
          </div>
          <div className="flex-1 min-w-0">
            <div className="text-sm font-medium flex items-center gap-1.5 flex-wrap">
              <span>{label}</span>
              <ArrowRight className="w-3 h-3 text-muted-foreground" />
              <span className="text-muted-foreground font-normal">{providerLabel}</span>
            </div>
          </div>
        </div>
      </div>
    </button>
  );
}