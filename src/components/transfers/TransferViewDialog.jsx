import React from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { StickyNote, CalendarDays, MapPin, CreditCard, ExternalLink, Building, Pencil } from 'lucide-react';
import { transportInfo, SIMPLE_TRANSPORT_TYPES } from '@/lib/transport';
import { BOOKING_PLATFORMS, platformLogoUrl, normalizeExternalUrl } from '@/lib/booking-platforms';
import DocumentsList from '@/components/common/DocumentsList';
import TimezoneHint from '@/components/common/TimezoneHint';
import { getEntityDocuments } from '@/lib/documents';
import { useI18nFormat } from '@/lib/i18n/I18nContext';
import { parseNaive } from '@/lib/naive-time';

export default function TransferViewDialog({ open, onOpenChange, transfer, fromVisit, toVisit, onEdit, readOnly = false }) {
  const { t, locale } = useI18nFormat();
  if (!transfer || !fromVisit || !toVisit) return null;
  const info = transportInfo(transfer.transport_type);
  const Icon = info.Icon;
  const isSimple = SIMPLE_TRANSPORT_TYPES.has(transfer.transport_type);

  // Times are rendered as naive wall-clock — timezones are intentionally ignored.
  const start = parseNaive(transfer.start_datetime)?.setLocale(locale) || null;
  const end = parseNaive(transfer.end_datetime)?.setLocale(locale) || null;
  const fmt = 'd LLL, HH:mm';

  // Localized transport-type label (fall back to legacy label in transportInfo)
  const transportLabel = t(`transfer.${transfer.transport_type}`, {}) || info.label;

  const platformInfo = transfer.booking_platform ? BOOKING_PLATFORMS[transfer.booking_platform] : null;
  const platformLogo = platformLogoUrl(transfer.booking_platform, transfer.booking_url);
  const documents = getEntityDocuments(transfer);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg p-0 max-h-[92vh] overflow-y-auto gap-0">
        <DialogHeader className="px-6 pt-6 pb-4 border-b">
          <div className="flex items-start gap-3 pr-8">
            <div className="w-11 h-11 rounded-full bg-primary/10 flex items-center justify-center shrink-0">
              <Icon className="w-5 h-5 text-primary" />
            </div>
            <div className="flex-1 min-w-0">
              <DialogTitle className="font-display text-2xl break-words">{transportLabel}</DialogTitle>
              <div className="text-sm text-muted-foreground mt-0.5 break-words">
                {fromVisit.city_name} → {toVisit.city_name}
              </div>
            </div>
          </div>
        </DialogHeader>

        <div className="px-6 py-4 space-y-3">
          {normalizeExternalUrl(transfer.booking_url) && (
            <a
              href={normalizeExternalUrl(transfer.booking_url)}
              target="_blank"
              rel="noreferrer"
              className="flex items-center gap-2.5 p-3 rounded-xl bg-primary/10 text-primary hover:bg-primary/15 transition"
            >
              {platformLogo ? (
                <img src={platformLogo} alt="" className="w-5 h-5 rounded-sm" />
              ) : (
                <ExternalLink className="w-4 h-4" />
              )}
              <div className="flex-1 text-sm font-medium min-w-0 break-words">
                {t('transfer.view_open_booking')}
                {platformInfo && transfer.booking_platform !== 'other' && (
                  <span className="text-xs text-muted-foreground ml-1.5 break-words">· {platformInfo.label}</span>
                )}
              </div>
              <ExternalLink className="w-3.5 h-3.5 opacity-70 shrink-0" />
            </a>
          )}

          <section className="rounded-xl border bg-card p-4 space-y-2">
            <div className="flex items-center gap-2 text-sm font-semibold mb-1">
              <CalendarDays className="w-4 h-4 text-primary" />{t('transfer.view_schedule')}
            </div>
            <Row label={t('transfer.view_departure')} value={start ? start.toFormat(fmt) : '—'} tz={fromVisit?.timezone} />
            <Row label={t('transfer.view_arrival')} value={end ? end.toFormat(fmt) : '—'} tz={toVisit?.timezone} />
          </section>

          <section className="rounded-xl border bg-card p-4 space-y-3">
            <div className="flex items-center gap-2 text-sm font-semibold mb-1">
              <MapPin className="w-4 h-4 text-primary" />{t('transfer.view_route')}
            </div>
            <RouteEndpoint
              label={t('transfer.view_from')}
              city={`${fromVisit.city_name}${fromVisit.country ? ', ' + fromVisit.country : ''}`}
              address={transfer.from_address}
            />
            <RouteEndpoint
              label={t('transfer.view_to')}
              city={`${toVisit.city_name}${toVisit.country ? ', ' + toVisit.country : ''}`}
              address={transfer.to_address}
            />
          </section>

          {!isSimple && (transfer.carrier || transfer.booking_reference || transfer.price != null) && (
            <section className="rounded-xl border bg-card p-4 space-y-2">
              <div className="flex items-center gap-2 text-sm font-semibold mb-1">
                <CreditCard className="w-4 h-4 text-primary" />{t('transfer.view_booking')}
              </div>
              {transfer.carrier && (
                <Row label={t('transfer.view_carrier')} value={transfer.carrier} icon={Building} />
              )}
              {transfer.booking_reference && (
                <Row label={t('transfer.view_pnr')} value={transfer.booking_reference} mono />
              )}
              {transfer.price != null && (
                <Row label={t('transfer.view_price')} value={`${transfer.price} ${transfer.currency || ''}`.trim()} />
              )}
            </section>
          )}

          <DocumentsList documents={documents} iconColor="text-primary" title={t('transfer.documents_label')} />

          {transfer.notes && (
            <section className="rounded-xl border bg-card p-4">
              <div className="flex items-center gap-2 text-sm font-semibold mb-2">
                <StickyNote className="w-4 h-4 text-primary" />{t('transfer.view_notes')}
              </div>
              <div className="text-sm whitespace-pre-wrap break-words">{transfer.notes}</div>
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

function Row({ label, value, mono = false, icon: Icon, tz }) {
  return (
    <div className="grid grid-cols-[110px_1fr] gap-3 text-sm items-baseline min-w-0">
      <div className="text-xs text-muted-foreground">{label}</div>
      <div className={`min-w-0 break-words ${mono ? 'font-mono break-all' : ''} flex items-baseline gap-x-2 gap-y-1 flex-wrap`}>
        <span className="min-w-0 break-words">
          {Icon && <Icon className="w-3.5 h-3.5 inline mr-1.5 text-muted-foreground -mt-0.5" />}
          {value}
        </span>
        {tz && <TimezoneHint tz={tz} variant="inline" />}
      </div>
    </div>
  );
}

function RouteEndpoint({ label, city, address }) {
  return (
    <div className="grid grid-cols-[110px_1fr] gap-3 text-sm items-baseline min-w-0">
      <div className="text-xs text-muted-foreground">{label}</div>
      <div className="min-w-0">
        <div className="break-words">{city}</div>
        {address && <div className="text-xs text-muted-foreground break-words mt-0.5">{address}</div>}
      </div>
    </div>
  );
}