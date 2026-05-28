import React, { useState, useEffect } from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Label } from '@/components/ui/label';
import { Button } from '@/components/ui/button';
import { base44 } from '@/api/base44Client';
import { supabase } from '@/api/supabaseClient';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { Loader2, AlertTriangle } from 'lucide-react';
import { isTripInPast } from '@/lib/trip-dates';
import { useT } from '@/lib/i18n/I18nContext';
import TripCoverPicker from './TripCoverPicker';

export default function TripFormDialog({ open, onOpenChange, trip = null, visits = [] }) {
  const t = useT();
  const qc = useQueryClient();
  const [form, setForm] = useState({
    title: '', description: '', cover_image_url: '', cover_gradient: '', notes: '',
  });
  const isPastTrip = trip && isTripInPast(visits);

  useEffect(() => {
    if (open) {
      setForm({
        title: trip?.title || '',
        description: trip?.description || '',
        cover_image_url: trip?.cover_image_url || '',
        cover_gradient: trip?.cover_gradient || '',
        notes: trip?.notes || '',
      });
    }
  }, [open, trip]);

  const mutation = useMutation({
    mutationFn: async (data) => {
      if (trip) {
        const { error } = await supabase.from('trips').update(data).eq('id', trip.id);
        if (error) throw error;
        return;
      }
      return base44.entities.Trip.create(data);
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['trips'] });
      qc.invalidateQueries({ queryKey: ['trip', trip?.id] });
      if (trip?.id) {
        qc.invalidateQueries({ queryKey: ['trip-shell', trip.id] });
        qc.setQueryData(['trip-shell', trip.id], (old) => {
          if (!old?.trip) return old;
          return { ...old, trip: { ...old.trip, ...form, cover_image_url: form.cover_image_url || null, cover_gradient: form.cover_gradient || null } };
        });
      }
      onOpenChange(false);
    },
  });

  const submit = (e) => {
    e.preventDefault();
    if (!form.title.trim()) return;
    if (isPastTrip) {
      alert(t('trip.form_past_alert'));
      return;
    }
    mutation.mutate({
      ...form,
      cover_image_url: form.cover_image_url || null,
      cover_gradient: form.cover_gradient || null,
    });
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="font-display text-2xl flex items-center gap-2">
            {trip ? t('trip.form_edit') : t('trip.form_new')}
            {isPastTrip && (
              <span className="text-xs text-muted-foreground flex items-center gap-1">
                <AlertTriangle className="w-3 h-3" />{t('trip.form_readonly')}
              </span>
            )}
          </DialogTitle>
        </DialogHeader>
        <form onSubmit={submit} className="space-y-4">
          <div>
            <Label htmlFor="title">{t('trip.form_title_required')}</Label>
            <Input id="title" value={form.title} onChange={e => setForm({...form, title: e.target.value})} placeholder={t('trip.form_title_placeholder')} required />
          </div>
          <div>
            <Label htmlFor="description">{t('trip.description')}</Label>
            <Input id="description" value={form.description} onChange={e => setForm({...form, description: e.target.value})} placeholder={t('trip.form_description_placeholder')} />
          </div>
          <p className="text-xs text-muted-foreground -mt-1">{t('trip.form_dates_hint')}</p>
          <div>
            <Label>{t('trip.form_cover')}</Label>
            <div className="mt-1.5">
              <TripCoverPicker
                coverImageUrl={form.cover_image_url}
                coverGradient={form.cover_gradient}
                tripId={trip?.id}
                onChange={({ cover_image_url, cover_gradient }) =>
                  setForm(f => ({ ...f, cover_image_url, cover_gradient }))
                }
              />
            </div>
          </div>
          <div>
            <Label htmlFor="notes">{t('trip.form_notes')}</Label>
            <Textarea id="notes" rows={4} value={form.notes} onChange={e => setForm({...form, notes: e.target.value})} placeholder={t('trip.form_notes_placeholder')} />
          </div>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>{t('trip.form_cancel')}</Button>
            <Button type="submit" disabled={mutation.isPending || isPastTrip}>
              {mutation.isPending && <Loader2 className="w-3 h-3 mr-1.5 animate-spin" />}
              {isPastTrip ? t('trip.form_cannot_edit') : trip ? t('trip.form_save') : t('trip.form_create')}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
