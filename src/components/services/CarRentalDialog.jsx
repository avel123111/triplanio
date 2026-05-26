import React, { useEffect, useMemo, useState } from 'react';
import { base44 } from '@/api/base44Client';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Label } from '@/components/ui/label';
import CurrencyCombobox from '@/components/ui/CurrencyCombobox';
import { Checkbox } from '@/components/ui/checkbox';
import {
  Loader2, Trash2, Car, CalendarDays, CreditCard, ExternalLink,
} from 'lucide-react';
import { detectPlatformFromUrl, BOOKING_PLATFORMS, platformLogoUrl } from '@/lib/booking-platforms';
import DocumentsField from '@/components/common/DocumentsField';
import AddressAutocomplete from '@/components/common/AddressAutocomplete';
import ConfirmDialog from '@/components/common/ConfirmDialog';
import DateTimeInput from '@/components/common/DateTimeInput';
import TimezoneHint from '@/components/common/TimezoneHint';
import { getDetailsDocuments } from '@/lib/documents';
import { useI18nFormat } from '@/lib/i18n/I18nContext';
import { invalidateTripData } from '@/lib/trip-data';
import { resolveTimezoneFromCoords } from '@/lib/timezone-resolver';

const EMPTY = {
  name: '',
  pickup_at_local: '',
  pickup_address: '',
  pickup_latitude: null,
  pickup_longitude: null,
  pickup_timezone: '',
  dropoff_at_local: '',
  dropoff_address: '',
  dropoff_latitude: null,
  dropoff_longitude: null,
  dropoff_timezone: '',
  return_different_location: false,
  booking_reference: '',
  price: '',
  currency: 'EUR',
  booking_url: '',
  booking_platform: '',
  documents: [],
  notes: '',
};

function serviceToForm(svc) {
  if (!svc) return EMPTY;
  const d = svc.details || {};
  // For existing records: if dropoff TZ/address differs from pickup, show the
  // "return different location" toggle as ON. Otherwise keep it off.
  const hasDifferentDropoff = !!(
    (d.dropoff_address && d.dropoff_address !== d.pickup_address) ||
    (d.dropoff_timezone && d.dropoff_timezone !== d.pickup_timezone)
  );
  return {
    name: svc.name || '',
    pickup_at_local: d.pickup_at_local || '',
    pickup_address: d.pickup_address || '',
    pickup_latitude: d.pickup_latitude ?? null,
    pickup_longitude: d.pickup_longitude ?? null,
    pickup_timezone: d.pickup_timezone || '',
    dropoff_at_local: d.dropoff_at_local || '',
    dropoff_address: d.dropoff_address || '',
    dropoff_latitude: d.dropoff_latitude ?? null,
    dropoff_longitude: d.dropoff_longitude ?? null,
    dropoff_timezone: d.dropoff_timezone || '',
    return_different_location: hasDifferentDropoff,
    booking_reference: d.booking_reference || '',
    // Price/currency moved to top-level fields. Fall back to legacy details
    // values for backwards compatibility with any not-yet-migrated rows.
    price: svc.price ?? d.price ?? '',
    currency: svc.currency || d.currency || 'EUR',
    booking_url: d.booking_url || '',
    booking_platform: d.booking_platform || '',
    documents: getDetailsDocuments(d),
    notes: d.notes || '',
  };
}

export default function CarRentalDialog({ open, onOpenChange, tripId, service }) {
  const { t } = useI18nFormat();
  const qc = useQueryClient();
  const isEdit = !!service;
  const [uploading, setUploading] = useState(false);
  const [form, setForm] = useState(() => serviceToForm(service));
  const [confirmDel, setConfirmDel] = useState(false);

  useEffect(() => {
    if (open) setForm(serviceToForm(service));
  }, [open, service]);

  // Auto-detect platform from URL
  useEffect(() => {
    if (!form.booking_url) return;
    const p = detectPlatformFromUrl(form.booking_url);
    if (p && p !== form.booking_platform) {
      setForm(prev => ({ ...prev, booking_platform: p }));
    }
  }, [form.booking_url]); // eslint-disable-line

  const setField = (k, v) => setForm(prev => ({ ...prev, [k]: v }));

  const dateOrderError = useMemo(() => {
    if (form.pickup_at_local && form.dropoff_at_local) {
      return new Date(form.pickup_at_local).getTime() >= new Date(form.dropoff_at_local).getTime();
    }
    return false;
  }, [form.pickup_at_local, form.dropoff_at_local]);

  // Block Save when the native datetime-local input shows a date without a
  // time. We can't infer this from form state alone (the browser returns ""
  // for partial values), so DateTimeInput reports it via callback.
  const [pickupTimeMissing, setPickupTimeMissing] = useState(false);
  const [dropoffTimeMissing, setDropoffTimeMissing] = useState(false);
  const timeMissing = pickupTimeMissing || dropoffTimeMissing;

  const invalidate = () => {
    qc.invalidateQueries({ queryKey: ['trip-services', tripId] });
    invalidateTripData(qc, tripId);
  };

  const saveMut = useMutation({
    mutationFn: () => {
      // When "return to a different location" is OFF — dropoff inherits pickup
      // address / coords / timezone. This keeps a single source of truth and
      // makes reminders/timeline consistent.
      const useSame = !form.return_different_location;
      const dropoffAddress = useSame ? form.pickup_address : form.dropoff_address;
      const dropoffLat = useSame ? form.pickup_latitude : form.dropoff_latitude;
      const dropoffLng = useSame ? form.pickup_longitude : form.dropoff_longitude;
      const dropoffTz = useSame ? form.pickup_timezone : form.dropoff_timezone;

      const details = {
        pickup_at_local: form.pickup_at_local || undefined,
        pickup_address: form.pickup_address || undefined,
        pickup_latitude: form.pickup_latitude ?? undefined,
        pickup_longitude: form.pickup_longitude ?? undefined,
        pickup_timezone: form.pickup_timezone || undefined,
        dropoff_at_local: form.dropoff_at_local || undefined,
        dropoff_address: dropoffAddress || undefined,
        dropoff_latitude: dropoffLat ?? undefined,
        dropoff_longitude: dropoffLng ?? undefined,
        dropoff_timezone: dropoffTz || undefined,
        booking_reference: form.booking_reference || undefined,
        booking_url: form.booking_url || undefined,
        booking_platform: form.booking_platform || undefined,
        documents: Array.isArray(form.documents) ? form.documents : [],
        // Clear legacy single-voucher and price fields from details.
        voucher_file_url: undefined,
        voucher_file_name: undefined,
        price: undefined,
        currency: undefined,
        notes: form.notes || undefined,
      };
      const payload = {
        trip_id: tripId,
        kind: 'car_rental',
        name: form.name.trim() || t('service.car_default_name'),
        price: form.price === '' ? null : Number(form.price),
        currency: form.currency || 'EUR',
        details,
      };
      if (isEdit) return base44.entities.TripService.update(service.id, payload);
      return base44.entities.TripService.create(payload);
    },
    onSuccess: () => { invalidate(); onOpenChange(false); },
  });

  const deleteMut = useMutation({
    mutationFn: () => base44.entities.TripService.delete(service.id),
    onSuccess: () => { invalidate(); onOpenChange(false); },
  });

  const platformInfo = form.booking_platform ? BOOKING_PLATFORMS[form.booking_platform] : null;
  const platformLogo = platformLogoUrl(form.booking_platform, form.booking_url);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-3xl max-h-[92vh] overflow-y-auto p-0">
        <DialogHeader className="px-6 pt-6 pb-4 border-b">
          <div className="flex items-start gap-3">
            <div className="w-11 h-11 rounded-full bg-emerald-100 dark:bg-emerald-950/40 flex items-center justify-center shrink-0">
              <Car className="w-5 h-5 text-emerald-700 dark:text-emerald-300" />
            </div>
            <div className="flex-1 min-w-0">
              <DialogTitle className="font-display text-2xl">
                {isEdit ? t('service.car_edit') : t('service.car_new')}
              </DialogTitle>
            </div>
          </div>
        </DialogHeader>

        <div className="px-6 pb-6 pt-4 space-y-4">
          <div className="grid md:grid-cols-2 gap-4">
            <section className="rounded-xl border bg-card p-4 space-y-3">
              <div className="flex items-center gap-2 text-sm font-semibold">
                <Car className="w-4 h-4 text-emerald-700 dark:text-emerald-300" /> {t('service.car_main_info')}
              </div>
              <div>
                <Label>{t('service.car_name_required')}</Label>
                <Input
                  value={form.name}
                  onChange={(e) => setField('name', e.target.value)}
                  placeholder={t('service.car_name_ph')}
                  autoFocus
                />
              </div>
            </section>

            <section className="rounded-xl border bg-card p-4 space-y-3">
              <div className="flex items-center gap-2 text-sm font-semibold">
                <CreditCard className="w-4 h-4 text-emerald-700 dark:text-emerald-300" /> {t('service.car_booking')}
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <Label>{t('service.car_booking_ref')}</Label>
                  <Input
                    value={form.booking_reference}
                    onChange={(e) => setField('booking_reference', e.target.value)}
                    placeholder={t('service.car_booking_ref_ph')}
                  />
                </div>
                <div>
                  <Label>{t('service.car_price')}</Label>
                  <Input
                    type="number"
                    step="0.01"
                    value={form.price}
                    onChange={(e) => setField('price', e.target.value)}
                    placeholder="0.00"
                  />
                </div>
              </div>
              <div>
                <Label>{t('service.car_currency')}</Label>
                <CurrencyCombobox value={form.currency} onChange={(v) => setField('currency', v)} />
              </div>
              <div>
                <Label>{t('service.car_booking_url')}</Label>
                <div className="relative">
                  {platformLogo && (
                    <img
                      src={platformLogo}
                      alt={platformInfo?.label || ''}
                      className="w-5 h-5 absolute left-2.5 top-1/2 -translate-y-1/2 rounded-sm"
                    />
                  )}
                  <Input
                    value={form.booking_url}
                    onChange={(e) => setField('booking_url', e.target.value)}
                    placeholder="https://..."
                    className={platformLogo ? 'pl-9' : ''}
                  />
                </div>
                {platformInfo && (
                  <div className="mt-2 flex items-center gap-2">
                    <span className={`inline-flex items-center gap-1.5 px-2 py-0.5 rounded text-xs font-medium ${platformInfo.color}`}>
                      {platformLogo && <img src={platformLogo} alt="" className="w-3.5 h-3.5 rounded-sm" />}
                      {platformInfo.label}
                    </span>
                    {form.booking_url && (
                      <a href={form.booking_url} target="_blank" rel="noreferrer" className="text-xs text-muted-foreground hover:text-primary inline-flex items-center gap-1">
                        <ExternalLink className="w-3 h-3" />{t('common.open')}
                      </a>
                    )}
                  </div>
                )}
              </div>
            </section>

            <section className="rounded-xl border bg-card p-4 space-y-3">
              <div className="flex items-center gap-2 text-sm font-semibold">
                <CalendarDays className="w-4 h-4 text-emerald-700 dark:text-emerald-300" /> {t('service.car_pickup')}
              </div>
              <div>
                <Label>{isEdit ? t('service.car_address') : t('service.car_address_required')}</Label>
                <AddressAutocomplete
                  value={form.pickup_address}
                  onChange={(v) => setField('pickup_address', v)}
                  onPlaceSelected={async (place) => {
                    // Reset timezone before resolving, so stale value doesn't
                    // linger if the new address fails to resolve.
                    setForm(prev => ({
                      ...prev,
                      pickup_address: place.formatted_address || place.description || prev.pickup_address,
                      pickup_latitude: place.latitude ?? null,
                      pickup_longitude: place.longitude ?? null,
                      pickup_timezone: '',
                    }));
                    const tz = await resolveTimezoneFromCoords(place.latitude, place.longitude);
                    if (tz) setField('pickup_timezone', tz);
                  }}
                  placeholder={t('service.car_pickup_ph')}
                />
                {/* Pickup address is required for NEW car rentals only —
                    legacy records without an address remain editable. */}
                {!isEdit && !form.pickup_address?.trim() && (
                  <p className="mt-1 text-xs text-destructive">{t('service.car_pickup_address_required')}</p>
                )}
              </div>
              <div>
                <Label>{t('service.car_date_time')}</Label>
                <DateTimeInput
                  value={form.pickup_at_local}
                  onChange={(v) => setField('pickup_at_local', v)}
                  onTimeMissingChange={setPickupTimeMissing}
                />
                <TimezoneHint tz={form.pickup_timezone} />
                {pickupTimeMissing && (
                  <p className="mt-1 text-xs text-destructive">{t('common.time_required')}</p>
                )}
              </div>
            </section>

            <section className="rounded-xl border bg-card p-4 space-y-3">
              <div className="flex items-center gap-2 text-sm font-semibold">
                <CalendarDays className="w-4 h-4 text-emerald-700 dark:text-emerald-300" /> {t('service.car_dropoff')}
              </div>
              <label className="flex items-center gap-2 text-sm cursor-pointer select-none">
                <Checkbox
                  checked={form.return_different_location}
                  onCheckedChange={(v) => setField('return_different_location', v === true)}
                />
                <span>{t('service.car_return_different_location')}</span>
              </label>
              {form.return_different_location && (
                <div>
                  <Label>{t('service.car_address')}</Label>
                  <AddressAutocomplete
                    value={form.dropoff_address}
                    onChange={(v) => setField('dropoff_address', v)}
                    onPlaceSelected={async (place) => {
                      setForm(prev => ({
                        ...prev,
                        dropoff_address: place.formatted_address || place.description || prev.dropoff_address,
                        dropoff_latitude: place.latitude ?? null,
                        dropoff_longitude: place.longitude ?? null,
                        dropoff_timezone: '',
                      }));
                      const tz = await resolveTimezoneFromCoords(place.latitude, place.longitude);
                      if (tz) setField('dropoff_timezone', tz);
                    }}
                    placeholder={t('service.car_dropoff_ph')}
                  />
                </div>
              )}
              <div>
                <Label>{t('service.car_date_time')}</Label>
                <DateTimeInput
                  value={form.dropoff_at_local}
                  onChange={(v) => setField('dropoff_at_local', v)}
                  onTimeMissingChange={setDropoffTimeMissing}
                />
                {/* Dropoff TZ falls back to pickup TZ when "same location" is on
                    — so the time hint is correct in both modes. */}
                <TimezoneHint tz={form.return_different_location ? form.dropoff_timezone : form.pickup_timezone} />
                {dropoffTimeMissing && (
                  <p className="mt-1 text-xs text-destructive">{t('common.time_required')}</p>
                )}
              </div>
              {dateOrderError && (
                <p className="text-xs text-destructive">{t('service.car_date_order_error')}</p>
              )}
            </section>
          </div>

          {/* Documents */}
          <DocumentsField
            value={form.documents}
            onChange={(docs) => setField('documents', docs)}
            onUploadingChange={setUploading}
            label={t('hotel.documents_label')}
            iconColor="text-emerald-700 dark:text-emerald-300"
          />


          <div>
            <Label>{t('common.notes')}</Label>
            <Textarea
              rows={3}
              value={form.notes}
              onChange={(e) => setField('notes', e.target.value)}
              placeholder={t('service.car_notes_ph')}
            />
          </div>
        </div>

        <DialogFooter className="px-6 py-4 border-t bg-secondary/30 flex sm:justify-between gap-2">
          <div>
            {isEdit && (
              <Button
                variant="ghost"
                size="sm"
                onClick={() => setConfirmDel(true)}
                disabled={deleteMut.isPending}
                className="text-destructive hover:text-destructive"
              >
                <Trash2 className="w-3.5 h-3.5 mr-1.5" />{t('common.delete')}
              </Button>
            )}
          </div>
          <div className="flex gap-2">
            <Button variant="outline" onClick={() => onOpenChange(false)}>{t('common.cancel')}</Button>
            <Button
              onClick={() => saveMut.mutate()}
              disabled={
                !form.name.trim()
                || (!isEdit && !form.pickup_address?.trim())
                || dateOrderError
                || timeMissing
                || saveMut.isPending
                || uploading
              }
            >
              {saveMut.isPending && <Loader2 className="w-3.5 h-3.5 mr-1.5 animate-spin" />}
              {t('common.save')}
            </Button>
          </div>
        </DialogFooter>
      </DialogContent>
      <ConfirmDialog
        open={confirmDel}
        onOpenChange={setConfirmDel}
        title={t('common.delete_confirm_title')}
        description={t('service.delete_confirm')}
        confirmLabel={t('common.delete')}
        variant="destructive"
        onConfirm={() => { deleteMut.mutate(); setConfirmDel(false); }}
      />
    </Dialog>
  );
}