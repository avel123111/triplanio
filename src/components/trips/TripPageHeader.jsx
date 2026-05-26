import React, { useMemo, useState } from 'react';
import { Crown, Share2, FileDown, MoreVertical, Loader2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { DropdownMenu, DropdownMenuTrigger, DropdownMenuContent, DropdownMenuItem } from '@/components/ui/dropdown-menu';
import { useI18nFormat } from '@/lib/i18n/I18nContext';
import { computeTripRange } from '@/lib/trip-dates';
import { uniqueCityCount } from '@/lib/trip-cities';
import { DateTime } from 'luxon';
import ShareTripDialog from './ShareTripDialog';
import { base44 } from '@/api/base44Client';

/**
 * Compact trip page header — used on Budget, Settings, and other sub-pages.
 * Shows: title + Pro badge | subtitle (date range · days · cities) | Share / Export / More buttons
 */
export default function TripPageHeader({ trip, visits = [], tripId, onExportPdf, pdfLoading }) {
  const { t, plural, locale } = useI18nFormat();
  const [shareOpen, setShareOpen] = useState(false);

  const range = useMemo(() => computeTripRange(visits), [visits]);

  const subtitle = useMemo(() => {
    if (!range?.start || !range?.end) return null;
    const startDt = DateTime.fromJSDate(new Date(range.start)).setLocale(locale);
    const endDt = DateTime.fromJSDate(new Date(range.end)).setLocale(locale);
    const start = startDt.toFormat('LLL d');
    const end = endDt.toFormat('LLL d');
    const msPerDay = 1000 * 60 * 60 * 24;
    const days = Math.max(1, Math.round((new Date(range.end) - new Date(range.start)) / msPerDay) + 1);
    const cityCount = uniqueCityCount(visits);
    const cityStr = cityCount > 0 ? ` • ${cityCount} ${plural(cityCount, 'trip.cities_count')}` : '';
    return `${start} – ${end} • ${days} ${plural(days, 'trip.days')}${cityStr}`;
  }, [range, visits, locale, plural]);

  if (!trip) return null;

  return (
    <>
      <div className="mb-6 flex items-start justify-between gap-4 flex-wrap">
        <div className="min-w-0">
          <h1 className="font-display font-bold text-3xl sm:text-4xl tracking-tight flex items-center gap-2 flex-wrap">
            <span>{trip.title}</span>
            {trip.is_pro_trip && (
              <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-md text-xs font-semibold bg-amber-100 text-amber-800 dark:bg-amber-950/50 dark:text-amber-200 align-middle">
                <Crown className="w-3 h-3" />{t('trip.pro_badge')}
              </span>
            )}
          </h1>
          {trip.description && (
            <p className="mt-1.5 text-sm text-foreground/80 leading-snug">{trip.description}</p>
          )}
          {subtitle && (
            <div className="mt-1.5 text-sm text-muted-foreground">{subtitle}</div>
          )}
        </div>

        <div className="flex items-center gap-2 shrink-0">
          <Button
            variant="outline"
            size="icon"
            className="border-foreground/20"
            aria-label={t('trip.share')}
            onClick={() => setShareOpen(true)}
          >
            <Share2 className="w-4 h-4" />
          </Button>

          {onExportPdf && (
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button variant="outline" size="icon" className="border-foreground/20" aria-label={t('trip.export_pdf')}>
                  <FileDown className="w-4 h-4" />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end">
                <DropdownMenuItem onClick={onExportPdf} disabled={pdfLoading} onSelect={(e) => e.preventDefault()}>
                  {pdfLoading
                    ? <Loader2 className="w-3.5 h-3.5 mr-2 animate-spin" />
                    : <FileDown className="w-3.5 h-3.5 mr-2" />}
                  {t('trip.export_pdf')}
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          )}
        </div>
      </div>

      <ShareTripDialog open={shareOpen} onOpenChange={setShareOpen} tripId={tripId} />
    </>
  );
}