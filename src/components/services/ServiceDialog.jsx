import React, { useEffect, useState } from 'react';
import { base44 } from '@/api/base44Client';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Loader2, Trash2 } from 'lucide-react';
import CarRentalDialog from './CarRentalDialog';
import ConfirmDialog from '@/components/common/ConfirmDialog';
import CurrencyCombobox from '@/components/ui/CurrencyCombobox';
import { useI18nFormat } from '@/lib/i18n/I18nContext';
import { invalidateTripData } from '@/lib/trip-data';

export default function ServiceDialog({ open, onOpenChange, tripId, kind, service }) {
  // Car rental has its own large dialog with detailed fields.
  const effectiveKind = service?.kind || kind;
  if (effectiveKind === 'car_rental') {
    return <CarRentalDialog open={open} onOpenChange={onOpenChange} tripId={tripId} service={service} />;
  }
  return <SimpleServiceDialog open={open} onOpenChange={onOpenChange} tripId={tripId} kind={kind} service={service} />;
}

function SimpleServiceDialog({ open, onOpenChange, tripId, kind, service }) {
  const { t } = useI18nFormat();
  const qc = useQueryClient();
  const isEdit = !!service;
  const [name, setName] = useState('');
  const [price, setPrice] = useState('');
  const [currency, setCurrency] = useState('EUR');
  const [confirmDel, setConfirmDel] = useState(false);

  useEffect(() => {
    if (open) {
      setName(service?.name || '');
      setPrice(service?.price ?? '');
      setCurrency(service?.currency || 'EUR');
    }
  }, [open, service]);

  const invalidate = () => {
    qc.invalidateQueries({ queryKey: ['trip-services', tripId] });
    invalidateTripData(qc, tripId);
  };

  const saveMut = useMutation({
    mutationFn: () => {
      const payload = {
        trip_id: tripId,
        kind,
        name: name.trim(),
        price: price === '' ? null : Number(price),
        currency: currency || 'EUR',
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

  const activeKind = isEdit ? service.kind : kind;
  const title = activeKind ? t(`service.kind.${activeKind}`) : t('service.fallback');

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{isEdit ? t('service.dialog_edit', { label: title }) : t('service.dialog_new', { label: title })}</DialogTitle>
        </DialogHeader>

        <div className="space-y-3 py-2">
          <div className="space-y-1.5">
            <Label htmlFor="svc-name">{t('service.name')}</Label>
            <Input
              id="svc-name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder={t('service.name_ph')}
              autoFocus
            />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label htmlFor="svc-price">{t('service.price')}</Label>
              <Input
                id="svc-price"
                type="number"
                step="0.01"
                value={price}
                onChange={(e) => setPrice(e.target.value)}
                placeholder="0.00"
              />
            </div>
            <div className="space-y-1.5">
              <Label>{t('service.currency')}</Label>
              <CurrencyCombobox value={currency} onChange={setCurrency} />
            </div>
          </div>
        </div>

        <DialogFooter className="flex sm:justify-between gap-2">
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
            <Button onClick={() => saveMut.mutate()} disabled={!name.trim() || saveMut.isPending}>
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