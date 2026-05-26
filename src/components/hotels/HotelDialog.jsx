import React, { useState, useEffect, useMemo, useRef } from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Label } from '@/components/ui/label';
import { Checkbox } from '@/components/ui/checkbox';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import CurrencyCombobox from '@/components/ui/CurrencyCombobox';
import AiField from '@/components/ui/AiField';
import { base44 } from '@/api/base44Client';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { localToUtc, utcToLocalInput } from '@/lib/time';
import { hotelWarnings } from '@/lib/validation';
import DateTimeInput from '@/components/common/DateTimeInput';
import TimezoneHint from '@/components/common/TimezoneHint';
import {
  Loader2, AlertTriangle, Sparkles, Building2, CalendarDays, CreditCard,
  ShieldCheck, ExternalLink, Lock,
} from 'lucide-react';
import { DateTime } from 'luxon';
import { detectPlatformFromUrl, BOOKING_PLATFORMS, platformLogoUrl } from '@/lib/booking-platforms';
import HotelAiUpload from './HotelAiUpload';
import { useToast } from '@/components/ui/use-toast';
import DocumentsField from '@/components/common/DocumentsField';
import AddressAutocomplete from '@/components/common/AddressAutocomplete';
import { getEntityDocuments } from '@/lib/documents';
import UpgradePlanDialog from '@/components/subscriptions/UpgradePlanDialog';
import { useI18nFormat } from '@/lib/i18n/I18nContext';
import { invalidateTripData } from '@/lib/trip-data';

const EMPTY = {
  name: '', address: '',
  checkInLocal: '', checkOutLocal: '',
  booking_reference: '', payment_status: '', price: '', currency: 'EUR',
  free_cancellation: false, free_cancellation_until_local: '',
  phone: '', email: '', booking_url: '', booking_platform: '',
  documents: [],
  notes: '',
};

function hotelToForm(hotel, tz) {
  if (!hotel) return EMPTY;
  return {
    name: hotel.name || '',
    address: hotel.address || '',
    checkInLocal: utcToLocalInput(hotel.check_in_datetime, tz) || '',
    checkOutLocal: utcToLocalInput(hotel.check_out_datetime, tz) || '',
    booking_reference: hotel.booking_reference || '',
    payment_status: hotel.payment_status || '',
    price: hotel.price ?? '',
    currency: hotel.currency || 'EUR',
    free_cancellation: !!hotel.free_cancellation,
    free_cancellation_until_local: utcToLocalInput(hotel.free_cancellation_until, tz) || '',
    phone: hotel.phone || '',
    email: hotel.email || '',
    booking_url: hotel.booking_url || '',
    booking_platform: hotel.booking_platform || '',
    documents: getEntityDocuments(hotel),
    notes: hotel.notes || '',
  };
}

function defaultFormForNew(visit, tz) {
  if (!visit?.start_datetime || !visit?.end_datetime) return EMPTY;
  const vs = DateTime.fromISO(visit.start_datetime, { zone: 'utc' }).setZone(tz);
  const ve = DateTime.fromISO(visit.end_datetime, { zone: 'utc' }).setZone(tz);
  const ci = vs.set({ hour: Math.max(vs.hour, 15), minute: 0 });
  let co = ve.set({ hour: Math.min(ve.hour, 11), minute: 0 });
  // Guarantee check-out is strictly after check-in
  if (co <= ci) co = ci.plus({ hours: 1 });
  return {
    ...EMPTY,
    checkInLocal: ci.toFormat("yyyy-LL-dd'T'HH:mm"),
    checkOutLocal: co.toFormat("yyyy-LL-dd'T'HH:mm"),
  };
}

export default function HotelDialog({ open, onOpenChange, visit, hotel = null, otherHotels = [] }) {
  const qc = useQueryClient();
  const { toast } = useToast();
  const { t, locale, fmtCountry } = useI18nFormat();
  const isEdit = !!hotel;
  const tz = visit?.timezone || 'UTC';

  const [form, setForm] = useState(() =>
    hotel ? hotelToForm(hotel, tz) : defaultFormForNew(visit, tz)
  );
  const [aiOpen, setAiOpen] = useState(false);
  const [aiFields, setAiFields] = useState(new Set());
  const [uploading, setUploading] = useState(false);
  const [isPro, setIsPro] = useState(null); // null = checking
  const [isOwner, setIsOwner] = useState(false);
  const [upgradeOpen, setUpgradeOpen] = useState(false);

  useEffect(() => {
    let cancelled = false;
    setIsPro(null);
    setIsOwner(false);
    const checkPro = async () => {
      try {
        const res = await base44.functions.invoke('checkSubscriptionStatus', { tripId: visit?.trip_id });
        if (!cancelled) {
          setIsPro(!!res.data.isPro);
          setIsOwner(!!res.data.isOwner);
        }
      } catch (e) {
        console.error(e);
        if (!cancelled) setIsPro(false);
      }
    };
    if (visit?.trip_id) checkPro(); else setIsPro(false);
    return () => { cancelled = true; };
  }, [visit?.trip_id]);

  // Re-hydrate form whenever the dialog opens or the hotel prop changes.
  useEffect(() => {
    if (!open) return;
    setForm(hotel ? hotelToForm(hotel, tz) : defaultFormForNew(visit, tz));
    setAiOpen(false);
    setAiFields(new Set());
  }, [open, hotel?.id]); // eslint-disable-line

  const setField = (k, v) => {
    setForm(prev => ({ ...prev, [k]: v }));
    setAiFields(prev => {
      if (!prev.has(k)) return prev;
      const next = new Set(prev); next.delete(k); return next;
    });
  };

  useEffect(() => {
    if (!form.booking_url) return;
    const p = detectPlatformFromUrl(form.booking_url);
    if (p && p !== form.booking_platform) {
      setForm(prev => ({ ...prev, booking_platform: p }));
    }
  }, [form.booking_url]); // eslint-disable-line

  const draft = useMemo(() => ({
    id: hotel?.id,
    check_in_datetime: localToUtc(form.checkInLocal, tz),
    check_out_datetime: localToUtc(form.checkOutLocal, tz),
    name: form.name,
  }), [form, tz, hotel]);

  const warnings = useMemo(() => hotelWarnings(draft, visit, otherHotels), [draft, visit, otherHotels]);

  const ciUtc = useMemo(() => localToUtc(form.checkInLocal, tz), [form.checkInLocal, tz]);
  const coUtc = useMemo(() => localToUtc(form.checkOutLocal, tz), [form.checkOutLocal, tz]);
  const dateOrderError = ciUtc && coUtc && new Date(ciUtc).getTime() >= new Date(coUtc).getTime();

  // Block Save when the native datetime-local input shows a date without a
  // time. The browser returns "" for partial input, so we can't tell from
  // form state alone — DateTimeInput reports it via callback.
  const [ciTimeMissing, setCiTimeMissing] = useState(false);
  const [coTimeMissing, setCoTimeMissing] = useState(false);
  const [fcTimeMissingRaw, setFcTimeMissingRaw] = useState(false);
  const fcTimeMissing = !!form.free_cancellation && fcTimeMissingRaw;
  const timeMissing = ciTimeMissing || coTimeMissing || fcTimeMissing;

  // Blocking range validation: check-in must be on or after city arrival day,
  // check-out must be on or before city departure day (city's timezone).
  const rangeError = useMemo(() => {
    if (!visit) return null;
    const dayOf = (iso) => iso
      ? DateTime.fromISO(iso, { zone: 'utc' }).setZone(tz).toFormat('yyyy-LL-dd')
      : null;
    const ciDay = ciUtc ? dayOf(ciUtc) : null;
    const coDay = coUtc ? dayOf(coUtc) : null;
    const vsDay = dayOf(visit.start_datetime);
    const veDay = dayOf(visit.end_datetime);
    if (ciDay && vsDay && ciDay < vsDay) return t('hotel.range_checkin_before');
    if (coDay && veDay && coDay > veDay) return t('hotel.range_checkout_after');
    return null;
  }, [ciUtc, coUtc, visit, tz, t]);

  const visitHeader = useMemo(() => {
    if (!visit) return '';
    const s = DateTime.fromISO(visit.start_datetime, { zone: 'utc' }).setZone(tz).setLocale(locale);
    const e = DateTime.fromISO(visit.end_datetime, { zone: 'utc' }).setZone(tz).setLocale(locale);
    const country = fmtCountry(visit.country_code, visit.country || '');
    return t('hotel.dialog_visit_header', {
      city: visit.city_name,
      country: country || '',
      start: s.toFormat('LLL d'),
      end: e.toFormat('LLL d'),
    });
  }, [visit, tz, locale, t, fmtCountry]);

  const handleAiExtract = (data, fileUrl, fileName) => {
    const filled = new Set();
    const upd = { ...form };
    const setIf = (key, value) => {
      if (value === undefined || value === null || value === '') return;
      upd[key] = value;
      filled.add(key);
    };
    setIf('name', data.name);
    setIf('address', data.address);
    setIf('booking_reference', data.booking_reference);
    setIf('payment_status', data.payment_status);
    if (typeof data.price === 'number') setIf('price', data.price);
    setIf('currency', data.currency);
    if (typeof data.free_cancellation === 'boolean') {
      upd.free_cancellation = data.free_cancellation;
      filled.add('free_cancellation');
    }
    setIf('phone', data.phone);
    setIf('email', data.email);
    setIf('booking_url', data.booking_url);
    setIf('booking_platform', data.booking_platform);

    const combine = (d, t) => {
      if (!d) return '';
      const time = t && /^\d{1,2}:\d{2}/.test(t) ? t.padStart(5, '0').slice(0, 5) : '00:00';
      return `${d}T${time}`;
    };
    if (data.check_in_date) { upd.checkInLocal = combine(data.check_in_date, data.check_in_time); filled.add('checkInLocal'); }
    if (data.check_out_date) { upd.checkOutLocal = combine(data.check_out_date, data.check_out_time); filled.add('checkOutLocal'); }
    if (data.free_cancellation_until) {
      const s = data.free_cancellation_until.replace(' ', 'T').slice(0, 16);
      upd.free_cancellation_until_local = s;
      filled.add('free_cancellation_until_local');
    }

    // AI returns one main file — append it to the documents array.
    if (Array.isArray(data.documents) && data.documents.length > 0) {
      upd.documents = [...(upd.documents || []), ...data.documents].slice(0, 50);
      filled.add('documents');
    } else if (fileUrl) {
      upd.documents = [...(upd.documents || []), { file_url: fileUrl, file_name: fileName || '' }];
      filled.add('documents');
    }

    setForm(upd);
    setAiFields(filled);
    setAiOpen(false);
  };

  const mutation = useMutation({
    mutationFn: async () => {
      const payload = {
        city_visit_id: visit.id,
        trip_id: visit.trip_id,
        name: form.name || 'Hotel',
        address: form.address,
        check_in_datetime: draft.check_in_datetime,
        check_out_datetime: draft.check_out_datetime,
        booking_reference: form.booking_reference || undefined,
        payment_status: form.payment_status || undefined,
        price: form.price === '' ? undefined : Number(form.price),
        // currency is required on the entity — always fall back to EUR if the
        // user somehow cleared the combobox.
        currency: form.currency || 'EUR',
        free_cancellation: !!form.free_cancellation,
        free_cancellation_until: form.free_cancellation && form.free_cancellation_until_local
          ? localToUtc(form.free_cancellation_until_local, tz) : undefined,
        phone: form.phone || undefined,
        email: form.email || undefined,
        booking_url: form.booking_url || undefined,
        booking_platform: form.booking_platform || undefined,
        documents: Array.isArray(form.documents) ? form.documents : [],
        // Clear legacy single-voucher fields when saving the new format.
        voucher_file_url: '',
        voucher_file_name: '',
        notes: form.notes,
        details: {},
      };
      if (hotel) return base44.entities.HotelStay.update(hotel.id, payload);
      return base44.entities.HotelStay.create(payload);
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['hotels', visit.trip_id] });
      // TripView fetches everything via a single `getTripDetails` call cached
      // under the trip-shell/trip-content keys — invalidate those too so the
      // read-only view refreshes immediately after edit.
      invalidateTripData(qc, visit.trip_id);
      onOpenChange(false);
    },
  });

  if (!visit) return null;

  const platformInfo = form.booking_platform ? BOOKING_PLATFORMS[form.booking_platform] : null;
  const platformLogo = platformLogoUrl(form.booking_platform, form.booking_url);

  return (
    <>
      <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-4xl max-h-[92vh] overflow-y-auto p-0 w-[calc(100%-1rem)] sm:w-full">
        <DialogHeader className="px-4 sm:px-6 pt-5 sm:pt-6 pb-4 border-b">
          <div className="flex items-start gap-3 pr-8">
            <div className="w-11 h-11 rounded-full bg-blue-100 dark:bg-blue-950/40 flex items-center justify-center shrink-0">
              <Building2 className="w-5 h-5 text-blue-600 dark:text-blue-300" />
            </div>
            <div className="flex-1 min-w-0">
              <DialogTitle className="font-display text-xl sm:text-2xl leading-snug">
                {isEdit ? t('hotel.edit') : t('hotel.add')}
              </DialogTitle>
              <div className="text-xs sm:text-sm text-muted-foreground mt-0.5 break-words">{visitHeader}</div>
            </div>
          </div>
        </DialogHeader>

        <div className="px-4 sm:px-6 pb-6 pt-4 space-y-4">
          {!isEdit && !aiOpen && (
            <button
              type="button"
              onClick={() => (isPro ? setAiOpen(true) : setUpgradeOpen(true))}
              disabled={isPro === null}
              className="group w-full rounded-xl px-5 py-4 text-white font-semibold flex items-center gap-3
                bg-gradient-to-r from-primary via-chart-1 to-chart-3 shadow-card
                hover:shadow-pop hover:brightness-110 active:scale-[0.99] transition
                disabled:opacity-70 disabled:pointer-events-none"
            >
              <Sparkles className="w-5 h-5 shrink-0" />
              <div className="flex-1 text-left min-w-0">
                <div className="text-base leading-tight">{t('hotel.ai_button_text')}</div>
                <div className="text-xs font-normal opacity-85 mt-0.5">{t('hotel.ai_button_hint')}</div>
              </div>
              {isPro === null ? (
                <Loader2 className="w-5 h-5 animate-spin shrink-0" />
              ) : !isPro ? (
                <Lock className="w-5 h-5 shrink-0" />
              ) : null}
            </button>
          )}

          {aiOpen && (
            <HotelAiUpload onExtract={handleAiExtract} onCancel={() => setAiOpen(false)} />
          )}

          <fieldset disabled={aiOpen} className={`space-y-4 ${aiOpen ? 'opacity-50 pointer-events-none select-none' : ''}`}>
          <div className="grid md:grid-cols-2 gap-4">
            <section className="rounded-xl border bg-card p-4 space-y-3">
              <div className="flex items-center gap-2 text-sm font-semibold">
                <Building2 className="w-4 h-4 text-blue-600 dark:text-blue-300" /> {t('hotel.section_main_info')}
              </div>
              <div>
                <Label>{t('hotel.name_required')}</Label>
                <AiField active={aiFields.has('name')}>
                  <Input value={form.name} onChange={e => setField('name', e.target.value)} placeholder={t('hotel.name_placeholder')} />
                </AiField>
              </div>
              <div>
                <Label>{t('hotel.address')}</Label>
                <AiField active={aiFields.has('address')}>
                  <AddressAutocomplete
                    value={form.address}
                    onChange={(v) => setField('address', v)}
                    placeholder={t('hotel.address_placeholder_typing')}
                  />
                </AiField>
              </div>
            </section>

            <section className="rounded-xl border bg-card p-4 space-y-3">
              <div className="flex items-center gap-2 text-sm font-semibold">
                <CreditCard className="w-4 h-4 text-blue-600 dark:text-blue-300" /> {t('hotel.section_booking_payment')}
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div className="min-w-0">
                  <Label>{t('hotel.booking_ref')}</Label>
                  <AiField active={aiFields.has('booking_reference')}>
                    <Input value={form.booking_reference} onChange={e => setField('booking_reference', e.target.value)} placeholder={t('hotel.booking_ref_placeholder')} />
                  </AiField>
                </div>
                <div className="min-w-0">
                  <Label>{t('hotel.payment_status')}</Label>
                  <AiField active={aiFields.has('payment_status')}>
                    <Select value={form.payment_status} onValueChange={v => setField('payment_status', v)}>
                      <SelectTrigger><SelectValue placeholder={t('hotel.payment_select_placeholder')} /></SelectTrigger>
                      <SelectContent>
                        <SelectItem value="paid">{t('hotel.pay_paid')}</SelectItem>
                        <SelectItem value="partial">{t('hotel.pay_partial')}</SelectItem>
                        <SelectItem value="pay_on_arrival">{t('hotel.pay_on_arrival')}</SelectItem>
                      </SelectContent>
                    </Select>
                  </AiField>
                </div>
                <div className="min-w-0">
                  <Label>{t('hotel.price')}</Label>
                  <AiField active={aiFields.has('price')}>
                    <Input type="number" step="0.01" value={form.price} onChange={e => setField('price', e.target.value)} placeholder="0.00" />
                  </AiField>
                </div>
                <div className="min-w-0">
                  <Label>{t('hotel.currency')}</Label>
                  <AiField active={aiFields.has('currency')}>
                    <CurrencyCombobox value={form.currency} onChange={v => setField('currency', v)} />
                  </AiField>
                </div>
              </div>
              <div>
                <Label>{t('hotel.booking_url')}</Label>
                <AiField active={aiFields.has('booking_url')}>
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
                      onChange={e => setField('booking_url', e.target.value)}
                      placeholder="https://..."
                      className={platformLogo ? 'pl-9' : ''}
                    />
                  </div>
                </AiField>
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
                <CalendarDays className="w-4 h-4 text-blue-600 dark:text-blue-300" /> {t('hotel.section_dates_time')}
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div className="min-w-0">
                  <Label>{t('hotel.checkin_required')}</Label>
                  <AiField active={aiFields.has('checkInLocal')}>
                    <DateTimeInput
                      value={form.checkInLocal}
                      onChange={(v) => setField('checkInLocal', v)}
                      onTimeMissingChange={setCiTimeMissing}
                      className="w-full"
                    />
                  </AiField>
                  <TimezoneHint tz={tz} />
                  {ciTimeMissing && (
                    <p className="mt-1 text-xs text-destructive">{t('common.time_required')}</p>
                  )}
                </div>
                <div className="min-w-0">
                  <Label>{t('hotel.checkout_required')}</Label>
                  <AiField active={aiFields.has('checkOutLocal')}>
                    <DateTimeInput
                      value={form.checkOutLocal}
                      onChange={(v) => setField('checkOutLocal', v)}
                      onTimeMissingChange={setCoTimeMissing}
                      className="w-full"
                    />
                  </AiField>
                  <TimezoneHint tz={tz} />
                  {coTimeMissing && (
                    <p className="mt-1 text-xs text-destructive">{t('common.time_required')}</p>
                  )}
                </div>
              </div>
              {dateOrderError && (
                <p className="text-xs text-destructive">{t('hotel.date_order_error')}</p>
              )}
              {rangeError && (
                <p className="text-xs text-destructive">{rangeError}</p>
              )}
            </section>

            <section className="rounded-xl border bg-card p-4 space-y-3">
              <div className="flex items-center gap-2 text-sm font-semibold">
                <ShieldCheck className="w-4 h-4 text-blue-600 dark:text-blue-300" /> {t('hotel.section_terms_contacts')}
              </div>
              <AiField active={aiFields.has('free_cancellation')}>
                <div className="flex items-start gap-2 p-2 rounded-md">
                  <Checkbox
                    id="free-cancel"
                    checked={form.free_cancellation}
                    onCheckedChange={v => setField('free_cancellation', !!v)}
                  />
                  <div className="flex-1">
                    <label htmlFor="free-cancel" className="text-sm font-medium cursor-pointer">{t('hotel.free_cancellation')}</label>
                    {form.free_cancellation && (
                      <div className="mt-2">
                        <Label className="text-xs">{t('hotel.free_cancellation_until')}</Label>
                        <AiField active={aiFields.has('free_cancellation_until_local')}>
                          <DateTimeInput
                            value={form.free_cancellation_until_local}
                            onChange={(v) => setField('free_cancellation_until_local', v)}
                            onTimeMissingChange={setFcTimeMissingRaw}
                          />
                        </AiField>
                        <TimezoneHint tz={tz} />
                        {fcTimeMissing && (
                          <p className="mt-1 text-xs text-destructive">{t('common.time_required')}</p>
                        )}
                      </div>
                    )}
                  </div>
                </div>
              </AiField>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div className="min-w-0">
                  <Label>{t('hotel.phone')}</Label>
                  <AiField active={aiFields.has('phone')}>
                    <Input value={form.phone} onChange={e => setField('phone', e.target.value)} placeholder={t('hotel.phone_placeholder')} />
                  </AiField>
                </div>
                <div className="min-w-0">
                  <Label>{t('hotel.email')}</Label>
                  <AiField active={aiFields.has('email')}>
                    <Input type="email" value={form.email} onChange={e => setField('email', e.target.value)} placeholder={t('hotel.email_placeholder')} />
                  </AiField>
                </div>
              </div>
            </section>
          </div>

          {/* Documents */}
          <AiField active={aiFields.has('documents')}>
            <DocumentsField
              value={form.documents}
              onChange={(docs) => setField('documents', docs)}
              onUploadingChange={setUploading}
              label={t('hotel.documents_label')}
              iconColor="text-blue-600 dark:text-blue-300"
            />
          </AiField>

          <div>
            <Label>{t('common.notes_md')}</Label>
            <Textarea rows={3} value={form.notes} onChange={e => setField('notes', e.target.value)} />
          </div>

          {warnings.length > 0 && (
            <div className="rounded-lg border border-amber-300 bg-amber-50 dark:bg-amber-950/30 dark:border-amber-800 p-3 text-sm text-amber-900 dark:text-amber-200 space-y-1">
              {warnings.map((w, i) => (
                <div key={i} className="flex items-start gap-2"><AlertTriangle className="w-4 h-4 mt-0.5 shrink-0" />{w}</div>
              ))}
            </div>
          )}
          </fieldset>
        </div>

        <DialogFooter className="px-4 sm:px-6 py-4 border-t bg-secondary/30 gap-2">
          <Button variant="outline" onClick={() => onOpenChange(false)}>{t('common.cancel')}</Button>
          <Button onClick={() => mutation.mutate()} disabled={!form.name?.trim() || dateOrderError || !!rangeError || timeMissing || mutation.isPending || uploading}>
            {mutation.isPending && <Loader2 className="w-3 h-3 mr-1.5 animate-spin" />}{t('hotel.save_btn')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>

    <UpgradePlanDialog
      open={upgradeOpen}
      onOpenChange={setUpgradeOpen}
      tripId={visit?.trip_id}
    />
    </>
  );
}