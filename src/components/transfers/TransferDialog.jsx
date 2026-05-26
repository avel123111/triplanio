import React, { useState, useEffect, useMemo, useRef } from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Label } from '@/components/ui/label';
import { base44 } from '@/api/base44Client';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { localToUtc, utcToLocalInput } from '@/lib/time';
import { transferWarnings, MAX_TRANSFER_SEGMENTS } from '@/lib/validation';
import DateTimeInput from '@/components/common/DateTimeInput';
import TimezoneHint from '@/components/common/TimezoneHint';
import { TRANSPORT_TYPES, SIMPLE_TRANSPORT_TYPES } from '@/lib/transport';
import { DateTime } from 'luxon';
import {
  Loader2, AlertTriangle, Sparkles, CalendarDays, MapPin, CreditCard, ExternalLink, Lock,
} from 'lucide-react';
import { detectPlatformFromUrl, BOOKING_PLATFORMS, platformLogoUrl } from '@/lib/booking-platforms';
import TransferAiUpload from './TransferAiUpload';
import CurrencyCombobox from '@/components/ui/CurrencyCombobox';
import AiField from '@/components/ui/AiField';
import { useToast } from '@/components/ui/use-toast';
import DocumentsField from '@/components/common/DocumentsField';
import AddressAutocomplete from '@/components/common/AddressAutocomplete';
import { getEntityDocuments } from '@/lib/documents';
import UpgradePlanDialog from '@/components/subscriptions/UpgradePlanDialog';
import { useI18nFormat } from '@/lib/i18n/I18nContext';
import { invalidateTripData } from '@/lib/trip-data';

const EMPTY = {
  startLocal: '',
  endLocal: '',
  carrier: '',
  booking_reference: '',
  booking_url: '',
  booking_platform: '',
  from_address: '',
  to_address: '',
  price: '',
  currency: 'EUR',
  documents: [],
  notes: '',
};

function transferToForm(transfer, startTz, endTz) {
  if (!transfer) return EMPTY;
  return {
    ...EMPTY,
    startLocal: utcToLocalInput(transfer.start_datetime, startTz) || '',
    endLocal: utcToLocalInput(transfer.end_datetime, endTz) || '',
    carrier: transfer.carrier || '',
    booking_reference: transfer.booking_reference || '',
    booking_url: transfer.booking_url || '',
    booking_platform: transfer.booking_platform || '',
    from_address: transfer.from_address || '',
    to_address: transfer.to_address || '',
    price: transfer.price ?? '',
    currency: transfer.currency || 'EUR',
    documents: getEntityDocuments(transfer),
    notes: transfer.notes || '',
  };
}

function defaultsForNew(fromVisit, toVisit, startTz, endTz) {
  // Anchor on the LAST day of the from-visit at 12:00 → 15:00 (local times).
  // Fall back to the to-visit's start day if the from-visit has no dates
  // (e.g. when departing from a `start` anchor without dates).
  const baseStartIso = fromVisit?.end_datetime || toVisit?.start_datetime;
  const baseEndIso = toVisit?.start_datetime || fromVisit?.end_datetime;

  const startDt = baseStartIso
    ? DateTime.fromISO(baseStartIso, { zone: 'utc' }).setZone(startTz).set({ hour: 12, minute: 0, second: 0, millisecond: 0 })
    : null;
  const endDt = baseEndIso
    ? DateTime.fromISO(baseEndIso, { zone: 'utc' }).setZone(endTz).set({ hour: 15, minute: 0, second: 0, millisecond: 0 })
    : null;

  return {
    ...EMPTY,
    startLocal: startDt ? startDt.toFormat("yyyy-LL-dd'T'HH:mm") : '',
    endLocal: endDt ? endDt.toFormat("yyyy-LL-dd'T'HH:mm") : '',
  };
}

export default function TransferDialog({ open, onOpenChange, tripId, fromVisit, toVisit, transfer = null }) {
  const qc = useQueryClient();
  const { toast } = useToast();
  const { t, plural } = useI18nFormat();
  const isEdit = !!transfer;

  const startTz = fromVisit?.timezone || 'UTC';
  const endTz = toVisit?.timezone || 'UTC';

  const [transportType, setTransportType] = useState(transfer?.transport_type || 'plane');
  const [form, setForm] = useState(() =>
    transfer ? transferToForm(transfer, startTz, endTz) : defaultsForNew(fromVisit, toVisit, startTz, endTz)
  );
  const [aiOpen, setAiOpen] = useState(false);
  const [aiFields, setAiFields] = useState(new Set());
  // Extra segments detected by AI but not yet shown in the form (created on save as separate Transfer rows).
  const [extraSegments, setExtraSegments] = useState([]);
  const [isPro, setIsPro] = useState(null); // null = checking
  const [isOwner, setIsOwner] = useState(false);
  const [upgradeOpen, setUpgradeOpen] = useState(false);

  useEffect(() => {
    let cancelled = false;
    setIsPro(null);
    setIsOwner(false);
    const checkPro = async () => {
      try {
        const res = await base44.functions.invoke('checkSubscriptionStatus', { tripId });
        if (!cancelled) {
          setIsPro(!!res.data.isPro);
          setIsOwner(!!res.data.isOwner);
        }
      } catch (e) {
        console.error(e);
        if (!cancelled) setIsPro(false);
      }
    };
    if (tripId) checkPro(); else setIsPro(false);
    return () => { cancelled = true; };
  }, [tripId]);

  useEffect(() => {
    if (!open) return;
    setTransportType(transfer?.transport_type || 'plane');
    setForm(transfer
      ? transferToForm(transfer, startTz, endTz)
      : defaultsForNew(fromVisit, toVisit, startTz, endTz));
    setAiFields(new Set());
    setAiOpen(false);
    setExtraSegments([]);
  }, [open, transfer?.id, fromVisit?.id, toVisit?.id, startTz, endTz]);

  const setField = (k, v) => {
    setForm(prev => ({ ...prev, [k]: v }));
    setAiFields(prev => {
      if (!prev.has(k)) return prev;
      const next = new Set(prev); next.delete(k); return next;
    });
  };

  // Auto-detect platform from URL
  useEffect(() => {
    if (!form.booking_url) return;
    const p = detectPlatformFromUrl(form.booking_url);
    if (p && p !== form.booking_platform) {
      setForm(prev => ({ ...prev, booking_platform: p }));
    }
  }, [form.booking_url]); // eslint-disable-line

  const isSimple = SIMPLE_TRANSPORT_TYPES.has(transportType);

  const draft = useMemo(() => ({
    id: transfer?.id,
    start_datetime: localToUtc(form.startLocal, startTz),
    end_datetime: localToUtc(form.endLocal, endTz),
  }), [form.startLocal, form.endLocal, startTz, endTz, transfer]);

  const warnings = useMemo(() => transferWarnings(draft, fromVisit, toVisit), [draft, fromVisit, toVisit]);

  const dateOrderError = draft.start_datetime && draft.end_datetime &&
    new Date(draft.start_datetime).getTime() >= new Date(draft.end_datetime).getTime();

  // Block Save when the native datetime-local input shows a date without a
  // time. The browser returns "" for partial input, so DateTimeInput reports
  // the partial-date state via callback.
  const [startTimeMissing, setStartTimeMissing] = useState(false);
  const [endTimeMissing, setEndTimeMissing] = useState(false);
  const timeMissing = startTimeMissing || endTimeMissing;

  const handleAiExtract = (data, fileUrl, fileName) => {
    const filled = new Set();
    const upd = { ...form };
    const setIf = (key, value) => {
      if (value === undefined || value === null || value === '') return;
      upd[key] = value;
      filled.add(key);
    };

    // Top-level platform info shared across segments
    setIf('booking_url', data.booking_url);
    setIf('booking_platform', data.booking_platform);

    const segments = Array.isArray(data.segments) && data.segments.length > 0 ? data.segments : [data];
    const first = segments[0] || {};

    setIf('carrier', first.carrier);
    setIf('booking_reference', first.booking_reference);
    setIf('from_address', first.from_address);
    setIf('to_address', first.to_address);
    if (typeof first.price === 'number') setIf('price', first.price);
    setIf('currency', first.currency);

    const combine = (d, t) => {
      if (!d) return '';
      const time = t && /^\d{1,2}:\d{2}/.test(t) ? t.padStart(5, '0').slice(0, 5) : '00:00';
      return `${d}T${time}`;
    };
    if (first.departure_date) { upd.startLocal = combine(first.departure_date, first.departure_time); filled.add('startLocal'); }
    if (first.arrival_date) { upd.endLocal = combine(first.arrival_date, first.arrival_time); filled.add('endLocal'); }

    if (Array.isArray(data.documents) && data.documents.length > 0) {
      upd.documents = [...(upd.documents || []), ...data.documents].slice(0, 50);
      filled.add('documents');
    } else if (fileUrl) {
      upd.documents = [...(upd.documents || []), { file_url: fileUrl, file_name: fileName || '' }];
      filled.add('documents');
    }

    if (first.transport_type && TRANSPORT_TYPES.some(t => t.value === first.transport_type)) {
      setTransportType(first.transport_type);
    }

    // Stash additional segments (capped). They will be created as extra Transfer rows on save.
    const extras = segments.slice(1, MAX_TRANSFER_SEGMENTS).map(s => ({
      transport_type: TRANSPORT_TYPES.some(tt => tt.value === s.transport_type) ? s.transport_type : (first.transport_type || 'plane'),
      start_datetime: s.departure_date ? combine(s.departure_date, s.departure_time) : '',
      end_datetime: s.arrival_date ? combine(s.arrival_date, s.arrival_time) : '',
      carrier: s.carrier || '',
      booking_reference: s.booking_reference || '',
      from_address: s.from_address || '',
      to_address: s.to_address || '',
      price: typeof s.price === 'number' ? s.price : '',
      currency: s.currency || first.currency || 'EUR',
    }));

    setForm(upd);
    setAiFields(filled);
    setExtraSegments(extras);
    setAiOpen(false);
  };

  const mutation = useMutation({
    mutationFn: async () => {
      const payload = {
        trip_id: tripId,
        from_city_visit_id: fromVisit.id,
        to_city_visit_id: toVisit.id,
        transport_type: transportType,
        start_datetime: draft.start_datetime,
        end_datetime: draft.end_datetime,
        notes: form.notes || undefined,
        details: {},
      };
      if (!isSimple) {
        Object.assign(payload, {
          carrier: form.carrier || undefined,
          booking_reference: form.booking_reference || undefined,
          booking_url: form.booking_url || undefined,
          booking_platform: form.booking_platform || undefined,
          from_address: form.from_address || undefined,
          to_address: form.to_address || undefined,
          price: form.price === '' ? undefined : Number(form.price),
          // currency is required on the entity — always fall back to EUR.
          currency: form.currency || 'EUR',
          documents: Array.isArray(form.documents) ? form.documents : [],
          // Clear legacy fields when saving in new format.
          voucher_file_url: '',
          voucher_file_name: '',
        });
      }
      if (transfer) return base44.entities.Transfer.update(transfer.id, payload);
      const created = await base44.entities.Transfer.create(payload);
      // If AI returned additional segments, create them as separate Transfer rows.
      for (const s of extraSegments) {
        if (!s.start_datetime || !s.end_datetime) continue;
        await base44.entities.Transfer.create({
          trip_id: tripId,
          from_city_visit_id: fromVisit.id,
          to_city_visit_id: toVisit.id,
          transport_type: s.transport_type,
          start_datetime: localToUtc(s.start_datetime, startTz),
          end_datetime: localToUtc(s.end_datetime, endTz),
          carrier: s.carrier || undefined,
          booking_reference: s.booking_reference || undefined,
          booking_url: form.booking_url || undefined,
          booking_platform: form.booking_platform || undefined,
          from_address: s.from_address || undefined,
          to_address: s.to_address || undefined,
          price: s.price === '' ? undefined : Number(s.price),
          // currency is required on the entity — always fall back to EUR.
          currency: s.currency || 'EUR',
          details: {},
        });
      }
      return created;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['transfers', tripId] });
      invalidateTripData(qc, tripId);
      onOpenChange(false);
    },
  });

  if (!fromVisit || !toVisit) return null;

  const platformInfo = form.booking_platform ? BOOKING_PLATFORMS[form.booking_platform] : null;
  const platformLogo = platformLogoUrl(form.booking_platform, form.booking_url);

  return (
    <>
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-3xl max-h-[92vh] overflow-y-auto p-0 w-[calc(100%-1rem)] sm:w-full">
        <DialogHeader className="px-4 sm:px-6 pt-5 sm:pt-6 pb-4 border-b">
          <DialogTitle className="font-display text-xl sm:text-2xl pr-8 leading-snug">
            {t(isEdit ? 'transfer.dialog_title_edit' : 'transfer.dialog_title_new', {
              from: fromVisit.city_name,
              to: toVisit.city_name,
            })}
          </DialogTitle>
        </DialogHeader>

        <div className="px-4 sm:px-6 pb-6 pt-4 space-y-4">
          {/* Transport selector */}
          <div>
            <Label>{t('transfer.transport_label')}</Label>
            <div className="grid grid-cols-3 sm:grid-cols-5 gap-2 mt-1">
              {TRANSPORT_TYPES.map(t => {
                const Icon = t.Icon;
                const active = transportType === t.value;
                return (
                  <button key={t.value} type="button"
                    onClick={() => setTransportType(t.value)}
                    className={`flex flex-col items-center gap-1 p-2 rounded-lg border text-xs transition ${active ? 'border-primary bg-primary/10 text-primary' : 'border-border hover:bg-secondary'}`}>
                    <Icon className="w-5 h-5" />{t.label}
                  </button>
                );
              })}
            </div>
          </div>

          {/* AI button — only for create + detailed types + collapsed */}
          {!isEdit && !isSimple && !aiOpen && (
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
                <div className="text-base leading-tight">{t('transfer.ai_button_text')}</div>
                <div className="text-xs font-normal opacity-85 mt-0.5">{t('transfer.ai_button_hint')}</div>
              </div>
              {isPro === null ? (
                <Loader2 className="w-5 h-5 animate-spin shrink-0" />
              ) : !isPro ? (
                <Lock className="w-5 h-5 shrink-0" />
              ) : null}
            </button>
          )}

          {aiOpen && !isSimple && (
            <TransferAiUpload onExtract={handleAiExtract} onCancel={() => setAiOpen(false)} />
          )}

          <fieldset disabled={aiOpen} className={`space-y-4 ${aiOpen ? 'opacity-50 pointer-events-none select-none' : ''}`}>
          {/* Dates & times — always shown */}
          <section className="rounded-xl border bg-card p-4 space-y-3">
            <div className="flex items-center gap-2 text-sm font-semibold">
              <CalendarDays className="w-4 h-4 text-primary" /> {t('transfer.section_dates')}
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div className="min-w-0">
                <Label className="break-words">{t('transfer.departure')}</Label>
                <AiField active={aiFields.has('startLocal')}>
                  <DateTimeInput
                    value={form.startLocal}
                    onChange={(v) => setField('startLocal', v)}
                    onTimeMissingChange={setStartTimeMissing}
                    className="w-full"
                  />
                </AiField>
                <TimezoneHint tz={startTz} />
                {startTimeMissing && (
                  <p className="mt-1 text-xs text-destructive">{t('common.time_required')}</p>
                )}
              </div>
              <div className="min-w-0">
                <Label className="break-words">{t('transfer.arrival')}</Label>
                <AiField active={aiFields.has('endLocal')}>
                  <DateTimeInput
                    value={form.endLocal}
                    onChange={(v) => setField('endLocal', v)}
                    onTimeMissingChange={setEndTimeMissing}
                    className="w-full"
                  />
                </AiField>
                <TimezoneHint tz={endTz} />
                {endTimeMissing && (
                  <p className="mt-1 text-xs text-destructive">{t('common.time_required')}</p>
                )}
              </div>
            </div>
            {dateOrderError && (
              <p className="text-xs text-destructive">{t('transfer.date_order_error')}</p>
            )}
          </section>

          {!isSimple && (
            <>
              <div className="grid md:grid-cols-2 gap-4">
                <section className="rounded-xl border bg-card p-4 space-y-3">
                  <div className="flex items-center gap-2 text-sm font-semibold">
                    <MapPin className="w-4 h-4 text-primary" /> {t('transfer.section_route')}
                  </div>
                  <div>
                    <Label>{t('transfer.from_address')}</Label>
                    <AiField active={aiFields.has('from_address')}>
                      <AddressAutocomplete
                        value={form.from_address}
                        onChange={(v) => setField('from_address', v)}
                        placeholder={t('transfer.from_address_ph')}
                      />
                    </AiField>
                  </div>
                  <div>
                    <Label>{t('transfer.to_address')}</Label>
                    <AiField active={aiFields.has('to_address')}>
                      <AddressAutocomplete
                        value={form.to_address}
                        onChange={(v) => setField('to_address', v)}
                        placeholder={t('transfer.to_address_ph')}
                      />
                    </AiField>
                  </div>
                  <div>
                    <Label>{t('transfer.carrier')}</Label>
                    <AiField active={aiFields.has('carrier')}>
                      <Input value={form.carrier} onChange={e => setField('carrier', e.target.value)} placeholder={t('transfer.carrier_ph')} />
                    </AiField>
                  </div>
                </section>

                <section className="rounded-xl border bg-card p-4 space-y-3">
                  <div className="flex items-center gap-2 text-sm font-semibold">
                    <CreditCard className="w-4 h-4 text-primary" /> {t('transfer.section_booking')}
                  </div>
                  <div>
                    <Label>{t('transfer.booking_ref')}</Label>
                    <AiField active={aiFields.has('booking_reference')}>
                      <Input value={form.booking_reference} onChange={e => setField('booking_reference', e.target.value)} placeholder={t('transfer.booking_ref_ph')} />
                    </AiField>
                  </div>
                  <div>
                    <Label>{t('transfer.booking_url')}</Label>
                    <AiField active={aiFields.has('booking_url')}>
                      <div className="relative">
                        {platformLogo && (
                          <img src={platformLogo} alt="" className="w-5 h-5 absolute left-2.5 top-1/2 -translate-y-1/2 rounded-sm" />
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
                            <ExternalLink className="w-3 h-3" />{t('transfer.open_link')}
                          </a>
                        )}
                      </div>
                    )}
                  </div>
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                    <div className="min-w-0">
                      <Label>{t('transfer.price')}</Label>
                      <AiField active={aiFields.has('price')}>
                        <Input type="number" step="0.01" value={form.price} onChange={e => setField('price', e.target.value)} placeholder="0.00" />
                      </AiField>
                    </div>
                    <div className="min-w-0">
                      <Label>{t('transfer.currency')}</Label>
                      <AiField active={aiFields.has('currency')}>
                        <CurrencyCombobox value={form.currency} onChange={v => setField('currency', v)} />
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
                  onUploadingChange={(v) => setField('_uploading', v)}
                  label={t('transfer.documents_label')}
                  iconColor="text-primary"
                />
              </AiField>
            </>
          )}

          <div>
            <Label>{t('common.notes_md')}</Label>
            <Textarea rows={3} value={form.notes} onChange={e => setField('notes', e.target.value)} placeholder={t('transfer.notes_placeholder')} />
          </div>

          {warnings.length > 0 && (
            <div className="rounded-lg border border-amber-300 bg-amber-50 dark:bg-amber-950/30 dark:border-amber-800 p-3 text-sm text-amber-900 dark:text-amber-200 space-y-1">
              {warnings.map((w, i) => (
                <div key={i} className="flex items-start gap-2"><AlertTriangle className="w-4 h-4 mt-0.5 shrink-0" />{w}</div>
              ))}
            </div>
          )}

          {extraSegments.length > 0 && (
            <div className="rounded-lg border border-primary/30 bg-primary/5 p-3 text-sm space-y-1.5">
              <div className="flex items-center gap-2 font-semibold text-primary">
                <Sparkles className="w-4 h-4" />
                {plural(extraSegments.length, 'transfer.ai_extra').replace('{count}', extraSegments.length)}
              </div>
              <div className="text-xs text-muted-foreground">
                {t('transfer.ai_extra_desc', { from: fromVisit.city_name, to: toVisit.city_name })}
              </div>
              <ul className="text-xs space-y-0.5 mt-1">
                {extraSegments.map((s, i) => (
                  <li key={i} className="text-muted-foreground">
                    • {s.from_address || '?'} → {s.to_address || '?'} {s.carrier ? `(${s.carrier})` : ''}
                  </li>
                ))}
              </ul>
            </div>
          )}
          </fieldset>
        </div>

        <DialogFooter className="px-4 sm:px-6 py-4 border-t bg-secondary/30 gap-2">
          <Button variant="outline" onClick={() => onOpenChange(false)}>{t('common.cancel')}</Button>
          <Button onClick={() => mutation.mutate()} disabled={!form.startLocal || !form.endLocal || dateOrderError || timeMissing || mutation.isPending || !!form._uploading}>
            {mutation.isPending && <Loader2 className="w-3 h-3 mr-1.5 animate-spin" />}{t('common.save')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>

    <UpgradePlanDialog
      open={upgradeOpen}
      onOpenChange={setUpgradeOpen}
      tripId={tripId}
    />
    </>
  );
}