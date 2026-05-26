import React from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Camera, CalendarDays, MapPin, StickyNote, ExternalLink, Pencil, CreditCard } from 'lucide-react';
import DocumentsList from '@/components/common/DocumentsList';
import TimezoneHint from '@/components/common/TimezoneHint';
import { getEntityDocuments } from '@/lib/documents';
import { useI18nFormat } from '@/lib/i18n/I18nContext';
import { parseNaive } from '@/lib/naive-time';

export default function ActivityViewDialog({ open, onOpenChange, activity, visit, onEdit, readOnly = false }) {
  const { t, locale } = useI18nFormat();
  if (!activity || !visit) return null;
  // Times are rendered as naive wall-clock — visit.timezone is intentionally ignored.
  const start = parseNaive(activity.start_datetime)?.setLocale(locale) || null;
  const end = parseNaive(activity.end_datetime)?.setLocale(locale) || null;
  const fmt = 'd LLL, HH:mm';
  const documents = getEntityDocuments(activity);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg p-0 max-h-[92vh] overflow-y-auto gap-0">
        <DialogHeader className="px-6 pt-6 pb-4 border-b">
          <div className="flex items-start gap-3 pr-8 min-w-0">
            <div className="w-11 h-11 rounded-full bg-violet-100 dark:bg-violet-950/40 flex items-center justify-center shrink-0">
              <Camera className="w-5 h-5 text-violet-700 dark:text-violet-300" />
            </div>
            <div className="flex-1 min-w-0">
              <DialogTitle className="font-display text-2xl break-words">{activity.title}</DialogTitle>
              <div className="text-sm text-muted-foreground mt-0.5 break-words">
                {visit.city_name}{visit.country ? `, ${visit.country}` : ''}
              </div>
            </div>
          </div>
        </DialogHeader>

        <div className="px-6 py-4 space-y-3 min-w-0">
          {(() => {
            const mapQuery = activity.location_address || activity.location_name;
            if (!mapQuery) return null;
            const mapUrl = `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(mapQuery)}`;
            return (
              <a
                href={mapUrl}
                target="_blank"
                rel="noreferrer"
                className="flex items-center gap-2.5 p-3 rounded-xl hover:bg-primary/15 transition text-violet-600 bg-violet-600/10"
              >
                <MapPin className="w-4 h-4 shrink-0" />
                <div className="flex-1 text-sm font-medium min-w-0 break-words">{t('activity.view_open_map')}</div>
                <ExternalLink className="w-3.5 h-3.5 opacity-70 shrink-0" />
              </a>
            );
          })()}

          {(start || end) && (
            <section className="rounded-xl border bg-card p-4 space-y-2">
              <div className="flex items-center gap-2 text-sm font-semibold mb-1">
                <CalendarDays className="w-4 h-4 text-violet-600 dark:text-violet-300" />{t('activity.view_schedule')}
              </div>
              {start && <Row label={t('activity.view_start')} value={start.toFormat(fmt)} tz={visit?.timezone} />}
              {end && <Row label={t('activity.view_end')} value={end.toFormat(fmt)} tz={visit?.timezone} />}
            </section>
          )}

          {(activity.location_name || activity.location_address) && (
            <section className="rounded-xl border bg-card p-4 space-y-2">
              <div className="flex items-center gap-2 text-sm font-semibold mb-1">
                <MapPin className="w-4 h-4 text-violet-600 dark:text-violet-300" />{t('activity.view_place')}
              </div>
              {activity.location_name && <Row label={t('activity.view_name')} value={activity.location_name} />}
              {activity.location_address && <Row label={t('activity.view_address')} value={activity.location_address} />}
            </section>
          )}

          {activity.price !== undefined && activity.price !== null && activity.price !== '' && (
            <section className="rounded-xl border bg-card p-4 space-y-2">
              <div className="flex items-center gap-2 text-sm font-semibold mb-1">
                <CreditCard className="w-4 h-4 text-violet-600 dark:text-violet-300" />{t('activity.price')}
              </div>
              <Row label={t('activity.price')} value={`${activity.price} ${activity.currency || ''}`.trim()} />
            </section>
          )}

          <DocumentsList documents={documents} iconColor="text-violet-600 dark:text-violet-300" title={t('activity.documents_label')} />

          {activity.notes && (
            <section className="rounded-xl border bg-card p-4">
              <div className="flex items-center gap-2 text-sm font-semibold mb-2">
                <StickyNote className="w-4 h-4 text-violet-600 dark:text-violet-300" />{t('activity.view_notes')}
              </div>
              <div className="text-sm whitespace-pre-wrap break-words">{activity.notes}</div>
            </section>
          )}
        </div>

        <DialogFooter className="px-6 py-4 border-t bg-secondary/30 flex sm:justify-end gap-2">
          <Button variant="outline" onClick={() => onOpenChange(false)}>{t('common.close')}</Button>
          {!readOnly && onEdit && (
            <Button onClick={onEdit}>
              <Pencil className="w-3.5 h-3.5 mr-1.5" />{t('common.edit')}
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function Row({ label, value, tz }) {
  return (
    <div className="grid grid-cols-[110px_1fr] gap-3 text-sm items-baseline min-w-0">
      <div className="text-xs text-muted-foreground">{label}</div>
      <div className="min-w-0 break-words flex items-baseline gap-x-2 gap-y-1 flex-wrap">
        <span className="min-w-0 break-words">{value}</span>
        {tz && <TimezoneHint tz={tz} variant="inline" />}
      </div>
    </div>
  );
}