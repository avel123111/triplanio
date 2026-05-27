import React, { useState, useMemo, useEffect } from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Label } from '@/components/ui/label';
import { supabase } from '@/api/supabaseClient';
import { useAuth } from '@/lib/AuthContext';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { localToUtc, utcToLocalInput } from '@/lib/time';
import { activityWarnings } from '@/lib/validation';
import DateTimeInput from '@/components/common/DateTimeInput';
import TimezoneHint from '@/components/common/TimezoneHint';
import { Loader2, AlertTriangle } from 'lucide-react';
import { DateTime } from 'luxon';
import DocumentsField from '@/components/common/DocumentsField';
import AddressAutocomplete from '@/components/common/AddressAutocomplete';
import CurrencyCombobox from '@/components/ui/CurrencyCombobox';
import { getEntityDocuments } from '@/lib/documents';
import { useT } from '@/lib/i18n/I18nContext';
import { invalidateTripData, optimisticContentUpdate } from '@/lib/trip-data';

export default function ActivityDialog({ open, onOpenChange, visit, activity = null, defaultStart = null }) {
  const t = useT();
  const qc = useQueryClient();
  const { user } = useAuth();
  const isEdit = !!activity;
  const tz = visit?.timezone || 'UTC';
  const [uploading, setUploading] = useState(false);

  const buildForm = () => {
    if (!visit) return { title: '', startLocal: '', endLocal: '', location_name: '', location_address: '', price: '', currency: 'EUR', documents: [], notes: '' };
    if (activity) {
      return {
        title: activity.title || '',
        startLocal: utcToLocalInput(activity.start_datetime, tz),
        endLocal: utcToLocalInput(activity.end_datetime, tz),
        location_name: activity.location_name || '',
        location_address: activity.location_address || '',
        price: activity.price ?? '',
        currency: activity.currency || 'EUR',
        documents: getEntityDocuments(activity),
        notes: activity.notes || '',
      };
    }
    const visitStart = DateTime.fromISO(visit.start_datetime, { zone: 'utc' }).setZone(tz);
    const proposed = defaultStart
      ? DateTime.fromISO(defaultStart, { zone: 'utc' }).setZone(tz)
      : visitStart.set({ hour: 10, minute: 0 });
    const start = proposed < visitStart ? visitStart : proposed;
    const end = start.plus({ hours: 2 });
    return {
      title: '',
      startLocal: start.toFormat("yyyy-LL-dd'T'HH:mm"),
      endLocal: end.toFormat("yyyy-LL-dd'T'HH:mm"),
      location_name: '',
      location_address: '',
      price: '',
      currency: 'EUR',
      documents: [],
      notes: '',
    };
  };

  const [form, setForm] = useState(buildForm);

  useEffect(() => {
    if (!open) return;
    setForm(buildForm());
  }, [open, activity?.id]); // eslint-disable-line

  const draft = useMemo(() => ({
    id: activity?.id,
    start_datetime: localToUtc(form.startLocal, tz),
    end_datetime: localToUtc(form.endLocal, tz),
  }), [form, tz, activity]);

  const warnings = useMemo(() => activityWarnings(draft, visit), [draft, visit]);

  const dateOrderError = draft.start_datetime && draft.end_datetime &&
    new Date(draft.start_datetime).getTime() >= new Date(draft.end_datetime).getTime();

  // Block Save when the native datetime-local input shows a date without a
  // time (browser returns "" for partial input — DateTimeInput reports it).
  const [startTimeMissing, setStartTimeMissing] = useState(false);
  const [endTimeMissing, setEndTimeMissing] = useState(false);
  const timeMissing = startTimeMissing || endTimeMissing;

  const mutation = useMutation({
    mutationFn: async () => {
      const payload = {
        city_visit_id: visit.id,
        trip_id: visit.trip_id,
        title: form.title || 'Activity',
        start_datetime: draft.start_datetime,
        end_datetime: draft.end_datetime,
        location_name: form.location_name,
        location_address: form.location_address,
        price: form.price === '' ? null : Number(form.price),
        currency: form.currency || 'EUR',
        documents: Array.isArray(form.documents) ? form.documents : [],
        notes: form.notes,
        details: {},
      };
      if (activity) {
        const { data, error } = await supabase
          .from('activities')
          .update(payload)
          .eq('id', activity.id)
          .select()
          .single();
        if (error) throw error;
        return data;
      }
      const { data, error } = await supabase
        .from('activities')
        .insert({ ...payload, created_by: user?.email })
        .select()
        .single();
      if (error) throw error;
      return data;
    },
    onMutate: () => {
      // Close immediately — optimistic update will show the new item right away
      onOpenChange(false);
      const tempId = `optimistic-${Date.now()}`;
      const optimistic = {
        id: activity?.id || tempId,
        city_visit_id: visit.id,
        trip_id: visit.trip_id,
        title: form.title || 'Activity',
        start_datetime: draft.start_datetime,
        end_datetime: draft.end_datetime,
        location_name: form.location_name,
        location_address: form.location_address,
        price: form.price === '' ? null : Number(form.price),
        currency: form.currency || 'EUR',
        documents: Array.isArray(form.documents) ? form.documents : [],
        notes: form.notes,
      };
      optimisticContentUpdate(qc, visit.trip_id, 'activities', activity ? 'update' : 'add', optimistic);
      return { tempId };
    },
    onSuccess: () => {
      invalidateTripData(qc, visit.trip_id);
    },
    onError: (_err, _vars, ctx) => {
      // Roll back optimistic update on failure
      invalidateTripData(qc, visit.trip_id);
    },
  });

  if (!visit) return null;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="font-display text-2xl">{isEdit ? t('activity.dialog_edit') : t('activity.dialog_new')}</DialogTitle>
        </DialogHeader>

        <div className="space-y-4">
          <div>
            <Label>{t('activity.title_required')}</Label>
            <Input value={form.title} onChange={e => setForm({ ...form, title: e.target.value })} placeholder={t('activity.title_placeholder')} />
          </div>
          <div>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div className="min-w-0">
                <Label className="break-words">{t('activity.start')}</Label>
                <DateTimeInput
                  value={form.startLocal}
                  onChange={(v) => setForm({ ...form, startLocal: v })}
                  onTimeMissingChange={setStartTimeMissing}
                  className="w-full"
                />
                <TimezoneHint tz={tz} />
                {startTimeMissing && (
                  <p className="mt-1 text-xs text-destructive">{t('common.time_required')}</p>
                )}
              </div>
              <div className="min-w-0">
                <Label className="break-words">{t('activity.end')}</Label>
                <DateTimeInput
                  value={form.endLocal}
                  onChange={(v) => setForm({ ...form, endLocal: v })}
                  onTimeMissingChange={setEndTimeMissing}
                  className="w-full"
                />
                <TimezoneHint tz={tz} />
                {endTimeMissing && (
                  <p className="mt-1 text-xs text-destructive">{t('common.time_required')}</p>
                )}
              </div>
            </div>
            {dateOrderError && (
              <p className="mt-1 text-xs text-destructive">{t('activity.date_order_error')}</p>
            )}
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div>
              <Label>{t('activity.location_name')}</Label>
              <Input value={form.location_name} onChange={e => setForm({ ...form, location_name: e.target.value })} placeholder={t('activity.location_name_ph')} />
            </div>
            <div>
              <Label>{t('activity.address')}</Label>
              <AddressAutocomplete
                value={form.location_address}
                onChange={(v) => setForm({ ...form, location_address: v })}
                onPlaceSelected={(p) => {
                  setForm(prev => ({
                    ...prev,
                    location_address: p.formatted_address || p.description || prev.location_address,
                    location_name: prev.location_name || (p.name && p.name !== p.formatted_address ? p.name : prev.location_name),
                  }));
                }}
                placeholder={t('activity.address_ph')}
              />
            </div>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <Label>{t('activity.price')}</Label>
              <Input
                type="number"
                step="0.01"
                value={form.price}
                onChange={e => setForm({ ...form, price: e.target.value })}
                placeholder="0.00"
              />
            </div>
            <div>
              <Label>{t('activity.currency')}</Label>
              <CurrencyCombobox value={form.currency} onChange={(v) => setForm({ ...form, currency: v })} />
            </div>
          </div>
          <DocumentsField
            value={form.documents}
            onChange={(docs) => setForm({ ...form, documents: docs })}
            onUploadingChange={setUploading}
            label={t('activity.documents_label')}
            iconColor="text-violet-600 dark:text-violet-300"
          />
          <div>
            <Label>{t('common.notes_md')}</Label>
            <Textarea rows={3} value={form.notes} onChange={e => setForm({ ...form, notes: e.target.value })} />
          </div>

          {warnings.length > 0 && (
            <div className="rounded-lg border border-amber-300 bg-amber-50 dark:bg-amber-950/30 dark:border-amber-800 p-3 text-sm text-amber-900 dark:text-amber-200 space-y-1">
              {warnings.map((w, i) => (
                <div key={i} className="flex items-start gap-2"><AlertTriangle className="w-4 h-4 mt-0.5 shrink-0" />{w}</div>
              ))}
            </div>
          )}
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>{t('common.cancel')}</Button>
          <Button onClick={() => mutation.mutate()} disabled={!form.title || !form.startLocal || dateOrderError || timeMissing || uploading}>
            {t('common.save')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}