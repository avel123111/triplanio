import React, { useState, useEffect } from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Label } from '@/components/ui/label';
import { Button } from '@/components/ui/button';
import { base44 } from '@/api/base44Client';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { ImageIcon, Loader2, AlertTriangle } from 'lucide-react';
import { isTripInPast } from '@/lib/trip-dates';
import { useT } from '@/lib/i18n/I18nContext';

export default function TripFormDialog({ open, onOpenChange, trip = null, visits = [] }) {
  const t = useT();
  const qc = useQueryClient();
  const [form, setForm] = useState({
    title: '', description: '', cover_image_url: '', notes: '',
  });
  const [uploading, setUploading] = useState(false);
  const isPastTrip = trip && isTripInPast(visits);

  useEffect(() => {
    if (open) {
      setForm({
        title: trip?.title || '',
        description: trip?.description || '',
        cover_image_url: trip?.cover_image_url || '',
        notes: trip?.notes || '',
      });
    }
  }, [open, trip]);

  const mutation = useMutation({
    mutationFn: async (data) => {
      if (trip) return base44.entities.Trip.update(trip.id, data);
      return base44.entities.Trip.create(data);
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['trips'] });
      qc.invalidateQueries({ queryKey: ['trip', trip?.id] });
      onOpenChange(false);
    },
  });

  const handleUpload = async (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setUploading(true);
    const { file_url } = await base44.integrations.Core.UploadFile({ file });
    setForm(f => ({ ...f, cover_image_url: file_url }));
    setUploading(false);
  };

  const submit = (e) => {
    e.preventDefault();
    if (!form.title.trim()) return;
    if (isPastTrip) {
      alert(t('trip.form_past_alert'));
      return;
    }
    mutation.mutate(form);
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
            <div className="flex items-center gap-3 mt-1">
              {form.cover_image_url ? (
                <img src={form.cover_image_url} className="w-24 h-16 object-cover rounded-md border" />
              ) : (
                <div className="w-24 h-16 rounded-md border border-dashed flex items-center justify-center bg-muted">
                  <ImageIcon className="w-5 h-5 text-muted-foreground" />
                </div>
              )}
              <label className="cursor-pointer">
                <input type="file" accept="image/*" onChange={handleUpload} className="hidden" />
                <span className="inline-flex items-center px-3 py-2 rounded-md border bg-background hover:bg-secondary text-sm">
                  {uploading ? <><Loader2 className="w-3 h-3 mr-1.5 animate-spin" />{t('trip.form_uploading')}</> : t('trip.form_upload_image')}
                </span>
              </label>
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