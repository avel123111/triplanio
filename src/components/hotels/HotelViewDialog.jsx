import React, { useMemo } from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import {
  Building2, CalendarDays, CreditCard, ShieldCheck, MapPin, Phone, Mail, StickyNote, BedDouble, ExternalLink, Pencil,
} from 'lucide-react';
import { BOOKING_PLATFORMS, platformLogoUrl, normalizeExternalUrl } from '@/lib/booking-platforms';
import DocumentsList from '@/components/common/DocumentsList';
import TimezoneHint from '@/components/common/TimezoneHint';
import { getEntityDocuments } from '@/lib/documents';
import { useI18nFormat } from '@/lib/i18n/I18nContext';
import { parseNaive } from '@/lib/naive-time';

export default function HotelViewDialog({ open, onOpenChange, hotel, visit, onEdit, readOnly = false }) {
  const { t, locale, plural } = useI18nFormat();
  const tz = visit?.timezone || '';

  const PAY_LABEL = useMemo(() => ({
    paid: t('hotel.pay_paid'),
    partial: t('hotel.pay_partial'),
    pay_on_arrival: t('hotel.pay_on_arrival'),
  }), [t]);

  // All datetimes are rendered as naive wall-clock — timezone is intentionally ignored.
  const range = useMemo(() => {
    if (!hotel) return '';
    const ci = parseNaive(hotel.check_in_datetime)?.setLocale(locale) || null;
    const co = parseNaive(hotel.check_out_datetime)?.setLocale(locale) || null;
    if (!ci) return '';
    const nights = co ? Math.max(1, Math.round(co.diff(ci, 'days').days)) : null;
    const fmt = 'd LLL, HH:mm';
    const nightsStr = nights ? ` · ${nights} ${t('hotel.nights')}` : '';
    return `${ci.toFormat(fmt)} → ${co ? co.toFormat(fmt) : '—'}${nightsStr}`;
  }, [hotel, locale, t]);

  if (!hotel) return null;

  const platformInfo = hotel.booking_platform ? BOOKING_PLATFORMS[hotel.booking_platform] : null;
  const platformLogo = platformLogoUrl(hotel.booking_platform, hotel.booking_url);
  const documents = getEntityDocuments(hotel);

  const mapUrl = hotel.address
    ? `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(hotel.address)}`
    : null;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg p-0 max-h-[92vh] overflow-y-auto gap-0">
        <DialogHeader className="px-6 pt-6 pb-4 border-b">
          <div className="flex items-start gap-3 pr-8">
            <div className="w-11 h-11 rounded-full bg-blue-100 dark:bg-blue-950/40 flex items-center justify-center shrink-0">
              <BedDouble className="w-5 h-5 text-blue-600 dark:text-blue-300" />
            </div>
            <div className="flex-1 min-w-0">
              <DialogTitle className="font-display text-2xl break-words">{hotel.name}</DialogTitle>
              {hotel.address && <div className="text-sm text-muted-foreground mt-0.5 break-words">{hotel.address}</div>}
            </div>
          </div>
        </DialogHeader>

        <div className="px-6 py-4 space-y-3">
          {normalizeExternalUrl(hotel.booking_url) && (
            <a
              href={normalizeExternalUrl(hotel.booking_url)}
              target="_blank"
              rel="noreferrer"
              className="flex items-center gap-2.5 p-3 rounded-xl bg-blue-100 dark:bg-blue-950/40 text-blue-700 dark:text-blue-300 hover:bg-blue-200/70 dark:hover:bg-blue-950/60 transition"
            >
              {platformLogo ? (
                <img src={platformLogo} alt="" className="w-5 h-5 rounded-sm" />
              ) : (
                <ExternalLink className="w-4 h-4" />
              )}
              <div className="flex-1 text-sm font-medium min-w-0">
                {t('hotel.view_open_booking')}
                {platformInfo && hotel.booking_platform !== 'other' && (
                  <span className="text-xs text-muted-foreground ml-1.5">· {platformInfo.label}</span>
                )}
              </div>
              <ExternalLink className="w-3.5 h-3.5 opacity-70 shrink-0" />
            </a>
          )}

          {mapUrl && (
            <a
              href={mapUrl}
              target="_blank"
              rel="noreferrer"
              className="flex items-center gap-2.5 p-3 rounded-xl bg-blue-100 dark:bg-blue-950/40 text-blue-700 dark:text-blue-300 hover:bg-blue-200/70 dark:hover:bg-blue-950/60 transition"
            >
              <MapPin className="w-4 h-4" />
              <div className="flex-1 text-sm font-medium min-w-0">{t('hotel.view_open_map')}</div>
              <ExternalLink className="w-3.5 h-3.5 opacity-70 shrink-0" />
            </a>
          )}

          <section className="rounded-xl border bg-card p-4 space-y-2">
            <div className="flex items-center gap-2 text-sm font-semibold mb-1">
              <CalendarDays className="w-4 h-4 text-blue-600 dark:text-blue-300" />{t('hotel.section_stay_dates')}
            </div>
            <Row label={t('hotel.view_checkin_checkout')} value={range} tz={tz} />
          </section>

          {(hotel.booking_reference || hotel.payment_status || hotel.price) && (
            <section className="rounded-xl border bg-card p-4 space-y-2">
              <div className="flex items-center gap-2 text-sm font-semibold mb-1">
                <CreditCard className="w-4 h-4 text-blue-600 dark:text-blue-300" />{t('hotel.section_booking_payment')}
              </div>
              {hotel.booking_reference && <Row label={t('hotel.view_booking_ref')} value={hotel.booking_reference} mono />}
              {hotel.payment_status && <Row label={t('hotel.view_payment_status')} value={PAY_LABEL[hotel.payment_status] || hotel.payment_status} />}
              {hotel.price !== undefined && hotel.price !== null && hotel.price !== '' && (
                <Row label={t('hotel.view_price')} value={`${hotel.price} ${hotel.currency || ''}`.trim()} />
              )}
            </section>
          )}

          {hotel.free_cancellation && (
            <section className="rounded-xl border bg-card p-4 space-y-2">
              <div className="flex items-center gap-2 text-sm font-semibold mb-1">
                <ShieldCheck className="w-4 h-4 text-blue-600 dark:text-blue-300" />{t('hotel.section_cancellation')}
              </div>
              <Row
                label={t('hotel.view_free_cancellation')}
                value={hotel.free_cancellation_until
                  ? t('hotel.view_cancellation_until', { date: parseNaive(hotel.free_cancellation_until)?.setLocale(locale).toFormat('d LLL, HH:mm') || '' })
                  : t('hotel.view_cancellation_yes')}
                tz={hotel.free_cancellation_until ? tz : ''}
              />
            </section>
          )}

          {(hotel.phone || hotel.email) && (
            <section className="rounded-xl border bg-card p-4 space-y-2">
              <div className="flex items-center gap-2 text-sm font-semibold mb-1">
                <Building2 className="w-4 h-4 text-blue-600 dark:text-blue-300" />{t('hotel.section_contacts')}
              </div>
              {hotel.phone && (
                <Row label={t('hotel.view_phone')} value={
                  <a href={`tel:${hotel.phone}`} className="text-primary hover:underline inline-flex items-center gap-1 break-all">
                    <Phone className="w-3.5 h-3.5 shrink-0" />{hotel.phone}
                  </a>
                } />
              )}
              {hotel.email && (
                <Row label={t('hotel.view_email')} value={
                  <a href={`mailto:${hotel.email}`} className="text-primary hover:underline inline-flex items-center gap-1 break-all">
                    <Mail className="w-3.5 h-3.5 shrink-0" />{hotel.email}
                  </a>
                } />
              )}
            </section>
          )}

          <DocumentsList documents={documents} iconColor="text-blue-600 dark:text-blue-300" title={t('hotel.documents_label')} />

          {hotel.notes && (
            <section className="rounded-xl border bg-card p-4">
              <div className="flex items-center gap-2 text-sm font-semibold mb-2">
                <StickyNote className="w-4 h-4 text-blue-600 dark:text-blue-300" />{t('hotel.view_notes')}
              </div>
              <div className="text-sm whitespace-pre-wrap break-words">{hotel.notes}</div>
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

function Row({ label, value, mono, tz }) {
  return (
    <div className="grid grid-cols-[110px_1fr] gap-3 text-sm items-baseline min-w-0">
      <div className="text-xs text-muted-foreground">{label}</div>
      <div className={`min-w-0 break-words ${mono ? 'font-mono text-xs break-all' : ''} flex items-baseline gap-x-2 gap-y-1 flex-wrap`}>
        <span className="min-w-0 break-words">{value}</span>
        {tz && <TimezoneHint tz={tz} variant="inline" />}
      </div>
    </div>
  );
}