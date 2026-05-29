import React, { useState, useEffect, useMemo } from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Label } from '@/components/ui/label';
import { supabase } from '@/api/supabaseClient';
import { useAuth } from '@/lib/AuthContext';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { getTimezone, countryFlag } from '@/lib/geo';
import { localToUtc, utcToLocalInput, dayKey } from '@/lib/time';
import { Loader2 } from 'lucide-react';
import CitySearch from '@/components/cities/CitySearch';
import { DateTime } from 'luxon';
import { MapPin, Flag, Plane } from 'lucide-react';
import { useT } from '@/lib/i18n/I18nContext';
import { invalidateTripData, optimisticContentUpdate } from '@/lib/trip-data';

/**
 * Single dialog used for creating AND editing a CityVisit.
 */
export default function CityVisitDialog({ open, onOpenChange, tripId, visit = null, previousVisit = null, trip = null, allVisits = [], onCreated }) {
  const t = useT();
  const qc = useQueryClient();
  const { user } = useAuth();
  const isEdit = !!visit;
  const [picked, setPicked] = useState(null);
  const [tz, setTz] = useState('UTC');
  const [form, setForm] = useState({ startDate: '', endDate: '', notes: '' });
  const [kind, setKind] = useState('transit');

  const hasStart = allVisits.some(v => v.kind === 'start' && v.id !== visit?.id);
  const hasEnd = allVisits.some(v => v.kind === 'end' && v.id !== visit?.id);

  useEffect(() => {
    if (!open) return;
    if (visit) {
      setPicked({
        external_city_id: visit.external_city_id,
        city_name: visit.city_name,
        country: visit.country,
        country_code: visit.country_code,
        latitude: visit.latitude,
        longitude: visit.longitude,
      });
      setTz(visit.timezone || 'UTC');
      setForm({
        startDate: dayKey(visit.start_datetime, visit.timezone),
        endDate: dayKey(visit.end_datetime, visit.timezone),
        notes: visit.notes || '',
      });
      setKind(visit.kind || 'transit');
    } else {
      setPicked(null);
      setTz('UTC');
      setForm({ startDate: '', endDate: '', notes: '' });
      setKind('transit');
    }
  }, [open, visit]);

  useEffect(() => {
    if (!picked || isEdit) return;
    (async () => {
      const resolved = await getTimezone(picked.latitude, picked.longitude);
      setTz(resolved);
      const base = previousVisit?.end_datetime
        ? DateTime.fromISO(previousVisit.end_datetime, { zone: 'utc' }).setZone(resolved)
        : trip?.start_date
          ? DateTime.fromISO(trip.start_date, { zone: resolved })
          : DateTime.now().setZone(resolved).plus({ days: 1 });
      const start = base.startOf('day');
      const end = start.plus({ days: 2 });
      setForm(f => ({
        ...f,
        startDate: start.toFormat('yyyy-LL-dd'),
        endDate: end.toFormat('yyyy-LL-dd'),
      }));
    })();
  }, [picked, isEdit, previousVisit, trip]);

  const isAnchor = kind === 'start' || kind === 'end';

  const startUtc = useMemo(
    () => (form.startDate ? localToUtc(`${form.startDate}T00:00`, tz) : null),
    [form.startDate, tz]
  );
  const endUtc = useMemo(
    () => (form.endDate ? localToUtc(`${form.endDate}T23:59`, tz) : null),
    [form.endDate, tz]
  );
  const orderError = !isAnchor && form.startDate && form.endDate && form.startDate > form.endDate;

  const overlapWith = useMemo(() => {
    if (isAnchor || !form.startDate || !form.endDate || orderError) return null;
    const others = allVisits.filter(v => v.id !== visit?.id && v.kind === 'transit' && v.start_datetime && v.end_datetime);
    for (const o of others) {
      const oStart = dayKey(o.start_datetime, o.timezone);
      const oEnd = dayKey(o.end_datetime, o.timezone);
      if (!oStart || !oEnd) continue;
      if (form.startDate < oEnd && oStart < form.endDate) {
        return o;
      }
    }
    return null;
  }, [allVisits, visit?.id, form.startDate, form.endDate, isAnchor, orderError]);

  const mutation = useMutation({
    mutationFn: async () => {
      const payload = {
        trip_id: tripId,
        external_city_id: picked.external_city_id,
        city_name: picked.city_name,
        country: picked.country,
        country_code: picked.country_code,
        latitude: picked.latitude,
        longitude: picked.longitude,
        timezone: tz,
        kind,
        start_datetime: isAnchor ? null : startUtc,
        end_datetime: isAnchor ? null : endUtc,
        notes: form.notes,
      };
      if (visit) {
        const { data, error } = await supabase
          .from('city_visits')
          .update(payload)
          .eq('id', visit.id)
          .select()
          .single();
        if (error) throw error;
        return data;
      }
      const { data, error } = await supabase
        .from('city_visits')
        .insert({ ...payload, created_by: user?.id })
        .select()
        .single();
      if (error) throw error;
      return data;
    },
    onMutate: () => {
      onOpenChange(false);
      const tempId = `optimistic-${Date.now()}`;
      const optimistic = {
        id: visit?.id || tempId,
        trip_id: tripId,
        external_city_id: picked.external_city_id,
        city_name: picked.city_name,
        country: picked.country,
        country_code: picked.country_code,
        latitude: picked.latitude,
        longitude: picked.longitude,
        timezone: tz,
        kind,
        start_datetime: isAnchor ? null : startUtc,
        end_datetime: isAnchor ? null : endUtc,
        notes: form.notes,
      };
      optimisticContentUpdate(qc, tripId, 'cityVisits', visit ? 'update' : 'add', optimistic);
    },
    onSuccess: (created) => {
      qc.invalidateQueries({ queryKey: ['city-visits', tripId] });
      qc.invalidateQueries({ queryKey: ['all-city-visits'] });
      invalidateTripData(qc, tripId);
      if (!visit && onCreated) onCreated(created);
    },
    onError: () => {
      invalidateTripData(qc, tripId);
    },
  });

  const canSave = picked
    && (isAnchor || (form.startDate && form.endDate))
    && !orderError
    && !overlapWith;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg w-[calc(100vw-2rem)] max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="font-display text-2xl">{isEdit ? t('visit.dialog_edit') : t('visit.dialog_new')}</DialogTitle>
        </DialogHeader>

        {!picked ? (
          isEdit ? (
            <div className="flex justify-center py-8"><Loader2 className="w-5 h-5 animate-spin text-muted-foreground" /></div>
          ) : (
            <CitySearch onSelect={setPicked} />
          )
        ) : (
          <div className="space-y-4">
            <div className="flex items-center gap-3 p-3 rounded-lg bg-secondary">
              <span className="text-3xl">{countryFlag(picked.country_code)}</span>
              <div className="flex-1">
                <div className="font-semibold">{picked.city_name}</div>
                <div className="text-xs text-muted-foreground">{picked.country} · {tz}</div>
              </div>
              {!isEdit && <Button type="button" variant="ghost" size="sm" onClick={() => setPicked(null)}>{t('visit.change')}</Button>}
            </div>

            <div>
              <Label>{t('visit.kind_label')}</Label>
              <div className="grid grid-cols-3 gap-2 mt-1">
                <KindButton active={kind === 'start'} disabled={hasStart && kind !== 'start'} onClick={() => setKind('start')} Icon={Plane} label={t('visit.kind_start_short')} hint={t('visit.kind_start_hint')} />
                <KindButton active={kind === 'transit'} onClick={() => setKind('transit')} Icon={MapPin} label={t('visit.kind_transit_short')} hint={t('visit.kind_transit_hint')} />
                <KindButton active={kind === 'end'} disabled={hasEnd && kind !== 'end'} onClick={() => setKind('end')} Icon={Flag} label={t('visit.kind_end_short')} hint={t('visit.kind_end_hint')} />
              </div>
              {isAnchor && (
                <p className="text-xs text-muted-foreground mt-2">
                  {kind === 'start' ? t('visit.anchor_dates_hint_start') : t('visit.anchor_dates_hint_end')}
                </p>
              )}
            </div>

            {kind === 'transit' && (
              <div>
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <Label>{t('visit.arrival')}</Label>
                    <Input type="date" value={form.startDate} onChange={e => setForm({ ...form, startDate: e.target.value })} />
                  </div>
                  <div>
                    <Label>{t('visit.departure')}</Label>
                    <Input type="date" value={form.endDate} onChange={e => setForm({ ...form, endDate: e.target.value })} />
                  </div>
                </div>
                <p className="mt-1.5 text-[11px] text-muted-foreground">
                  {t('visit.same_day_hint')}
                </p>
                {orderError && (
                  <p className="mt-2 text-xs text-destructive">{t('visit.order_error')}</p>
                )}
                {overlapWith && (
                  <p className="mt-2 text-xs text-destructive">
                    {t('visit.overlap_error', { city: overlapWith.city_name })}
                  </p>
                )}
              </div>
            )}

            <div>
              <Label>{t('common.notes_md')}</Label>
              <Textarea rows={3} value={form.notes} onChange={e => setForm({ ...form, notes: e.target.value })} placeholder={t('visit.notes_placeholder')} />
            </div>
          </div>
        )}

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>{t('common.cancel')}</Button>
          <Button onClick={() => mutation.mutate()} disabled={!canSave}>
            {isEdit ? t('visit.save_changes') : t('visit.btn_add')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function KindButton({ active, disabled, onClick, Icon, label, hint }) {
  return (
    <button
      type="button"
      disabled={disabled}
      onClick={onClick}
      className={`flex flex-col items-center gap-1 p-2.5 rounded-lg border text-center transition ${
        active ? 'border-primary bg-primary/10 text-primary' : 'border-border hover:bg-secondary/60'
      } ${disabled ? 'opacity-40 cursor-not-allowed' : ''}`}
    >
      <Icon className="w-4 h-4" />
      <span className="text-xs font-semibold">{label}</span>
      <span className="text-[10px] text-muted-foreground leading-tight">{hint}</span>
    </button>
  );
}