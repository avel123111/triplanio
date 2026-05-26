import React from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import {
  Car, CalendarDays, MapPin, CreditCard, StickyNote, ExternalLink, Pencil,
} from 'lucide-react';
import { BOOKING_PLATFORMS, platformLogoUrl, normalizeExternalUrl } from '@/lib/booking-platforms';
import DocumentsList from '@/components/common/DocumentsList';
import TimezoneHint from '@/components/common/TimezoneHint';
import { getDetailsDocuments } from '@/lib/documents';
import { useI18nFormat } from '@/lib/i18n/I18nContext';
import { parseNaive } from '@/lib/naive-time';

// Renders the stored datetime as naive wall-clock — timezones are intentionally ignored.
function fmtLocal(local) {
  const dt = parseNaive(local);
  return dt ? dt.toFormat('d LLL yyyy, HH:mm') : (local || '');
}

function MapButton({ address }) {
  const { t } = useI18nFormat();
  if (!address) return null;
  const url = `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(address)}`;
  return (
    <a
      href={url}
      target="_blank"
      rel="noreferrer"
      onClick={(e) => e.stopPropagation()}
      className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md text-xs font-medium bg-emerald-100 dark:bg-emerald-950/40 text-emerald-700 dark:text-emerald-300 hover:bg-emerald-200/70 dark:hover:bg-emerald-950/60 transition shrink-0"
      aria-label={t('service.car_view_open_map')}
    >
      <MapPin className="w-3 h-3" />
      {t('service.car_view_on_map')}
    </a>
  );
}

function AddressRow({ label, address }) {
  return (
    <div className="grid grid-cols-[100px_1fr] sm:grid-cols-[110px_1fr] gap-3 text-sm items-start min-w-0">
      <div className="text-xs text-muted-foreground pt-0.5">{label}</div>
      <div className="min-w-0 flex flex-wrap items-start gap-x-2 gap-y-1">
        <span className="min-w-0 break-words flex-1">{address}</span>
        <MapButton address={address} />
      </div>
    </div>
  );
}

function Row({ label, value, mono = false, tz }) {
  return (
    <div className="grid grid-cols-[100px_1fr] sm:grid-cols-[110px_1fr] gap-3 text-sm items-baseline min-w-0">
      <div className="text-xs text-muted-foreground">{label}</div>
      <div className={`min-w-0 break-words ${mono ? 'font-mono text-xs break-all' : ''} flex items-baseline gap-x-2 gap-y-1 flex-wrap`}>
        <span className="min-w-0 break-words">{value}</span>
        {tz && <TimezoneHint tz={tz} variant="inline" />}
      </div>
    </div>
  );
}

export default function CarRentalViewDialog({ open, onOpenChange, service, onEdit, readOnly = false }) {
  const { t } = useI18nFormat();
  if (!service) return null;
  const d = service.details || {};
  const platformInfo = d.booking_platform ? BOOKING_PLATFORMS[d.booking_platform] : null;
  const platformLogo = platformLogoUrl(d.booking_platform, d.booking_url);
  const documents = getDetailsDocuments(d);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="w-[calc(100vw-2rem)] sm:max-w-lg p-0 max-h-[92vh] overflow-y-auto gap-0">
        <DialogHeader className="px-4 sm:px-6 pt-6 pb-4 border-b">
          <div className="flex items-start gap-3 pr-8 min-w-0">
            <div className="w-11 h-11 rounded-full bg-emerald-100 dark:bg-emerald-950/40 flex items-center justify-center shrink-0">
              <Car className="w-5 h-5 text-emerald-700 dark:text-emerald-300" />
            </div>
            <div className="flex-1 min-w-0">
              <DialogTitle className="font-display text-2xl break-words">{service.name}</DialogTitle>
              <div className="text-sm text-muted-foreground mt-0.5">{t('service.car_kind_label')}</div>
            </div>
          </div>
        </DialogHeader>

        <div className="px-4 sm:px-6 py-4 space-y-3 min-w-0">
          {/* Primary booking link */}
          {normalizeExternalUrl(d.booking_url) && (
            <a
              href={normalizeExternalUrl(d.booking_url)}
              target="_blank"
              rel="noreferrer"
              className="flex items-start gap-2.5 p-3 rounded-xl bg-emerald-100 dark:bg-emerald-950/40 text-emerald-700 dark:text-emerald-300 hover:bg-emerald-200/70 dark:hover:bg-emerald-950/60 transition min-w-0"
            >
              {platformLogo ? (
                <img src={platformLogo} alt="" className="w-5 h-5 rounded-sm shrink-0 mt-0.5" />
              ) : (
                <ExternalLink className="w-4 h-4 shrink-0 mt-0.5" />
              )}
              <div className="flex-1 text-sm font-medium min-w-0 break-words">
                {t('service.car_view_open_booking')}
                {platformInfo && d.booking_platform !== 'other' && (
                  <span className="text-xs text-muted-foreground ml-1.5">· {platformInfo.label}</span>
                )}
              </div>
              <ExternalLink className="w-3.5 h-3.5 opacity-70 shrink-0 mt-0.5" />
            </a>
          )}

          {/* Schedule */}
          {(d.pickup_at_local || d.dropoff_at_local) && (
            <section className="rounded-xl border bg-card p-4 space-y-2">
              <div className="flex items-center gap-2 text-sm font-semibold mb-1">
                <CalendarDays className="w-4 h-4 text-emerald-700 dark:text-emerald-300" />{t('service.car_view_schedule')}
              </div>
              {d.pickup_at_local && (
                <Row
                  label={t('service.car_pickup')}
                  value={fmtLocal(d.pickup_at_local)}
                  tz={d.pickup_timezone}
                />
              )}
              {d.dropoff_at_local && (
                <Row
                  label={t('service.car_dropoff')}
                  value={fmtLocal(d.dropoff_at_local)}
                  tz={d.dropoff_timezone || d.pickup_timezone}
                />
              )}
            </section>
          )}

          {/* Addresses with inline map buttons */}
          {(d.pickup_address || d.dropoff_address) && (
            <section className="rounded-xl border bg-card p-4 space-y-2">
              <div className="flex items-center gap-2 text-sm font-semibold mb-1">
                <MapPin className="w-4 h-4 text-emerald-700 dark:text-emerald-300" />{t('service.car_view_addresses')}
              </div>
              {d.pickup_address && <AddressRow label={t('service.car_pickup')} address={d.pickup_address} />}
              {d.dropoff_address && <AddressRow label={t('service.car_dropoff')} address={d.dropoff_address} />}
            </section>
          )}

          {/* Booking & payment — price now lives on top-level (service.price / service.currency).
              Fall back to legacy details.price for not-yet-migrated rows. */}
          {(d.booking_reference || service.price != null || d.price != null) && (
            <section className="rounded-xl border bg-card p-4 space-y-2">
              <div className="flex items-center gap-2 text-sm font-semibold mb-1">
                <CreditCard className="w-4 h-4 text-emerald-700 dark:text-emerald-300" />{t('service.car_view_booking_pay')}
              </div>
              {d.booking_reference && <Row label={t('service.car_booking_ref')} value={d.booking_reference} mono />}
              {(() => {
                const p = service.price ?? d.price;
                const c = service.currency || d.currency || '';
                if (p === undefined || p === null || p === '') return null;
                return <Row label={t('service.car_price')} value={`${p} ${c}`.trim()} />;
              })()}
            </section>
          )}

          {/* Documents */}
          <DocumentsList documents={documents} iconColor="text-emerald-700 dark:text-emerald-300" title={t('hotel.documents_label')} />

          {d.notes && (
            <section className="rounded-xl border bg-card p-4">
              <div className="flex items-center gap-2 text-sm font-semibold mb-2">
                <StickyNote className="w-4 h-4 text-emerald-700 dark:text-emerald-300" />{t('common.notes')}
              </div>
              <div className="text-sm whitespace-pre-wrap break-words">{d.notes}</div>
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