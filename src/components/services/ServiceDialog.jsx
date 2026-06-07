import React, { useEffect, useState } from 'react';
import { supabase } from '@/api/supabaseClient';
import { useAuth } from '@/lib/AuthContext';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { Dialog, Btn, Field } from '@/design/index';
import { Loader2 } from 'lucide-react';
import ConfirmDialog from '@/components/common/ConfirmDialog';
import CurrencyCombobox from '@/components/ui/CurrencyCombobox';
import { useI18nFormat } from '@/lib/i18n/I18nContext';
import { invalidateTripData } from '@/lib/trip-data';

// Simple name + price dialog for non-car-rental service kinds (esim, insurance).
// Car-rental services now go through the unified EventEditDialog at the call sites.
export default function ServiceDialog({ open, onOpenChange, tripId, kind, service }) {
  const { t } = useI18nFormat();
  const qc = useQueryClient();
  const { user } = useAuth();
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
    mutationFn: async () => {
      const payload = {
        trip_id: tripId,
        kind,
        name: name.trim(),
        price: price === '' ? null : Number(price),
        currency: currency || 'EUR',
      };
      if (isEdit) {
        const { data, error } = await supabase
          .from('trip_services')
          .update(payload)
          .eq('id', service.id)
          .select()
          .single();
        if (error) throw error;
        return data;
      }
      const { data, error } = await supabase
        .from('trip_services')
        .insert({ ...payload, created_by: user?.id })
        .select()
        .single();
      if (error) throw error;
      return data;
    },
    onSuccess: () => { invalidate(); onOpenChange(false); },
  });

  const deleteMut = useMutation({
    mutationFn: async () => {
      const { error } = await supabase.from('trip_services').delete().eq('id', service.id);
      if (error) throw error;
    },
    onSuccess: () => { invalidate(); onOpenChange(false); },
  });

  const activeKind = isEdit ? service.kind : kind;
  const title = activeKind ? t(`service.kind.${activeKind}`) : t('service.fallback');

  return (
    <>
      <Dialog
        title={isEdit ? t('service.dialog_edit', { label: title }) : t('service.dialog_new', { label: title })}
        icon="tag"
        size="sm"
        open={open}
        onOpenChange={onOpenChange}
        foot={<>
          {isEdit && (
            <Btn
              variant="danger-ghost"
              icon="trash"
              onClick={() => setConfirmDel(true)}
              disabled={deleteMut.isPending}
            >
              {t('common.delete')}
            </Btn>
          )}
          <div style={{ flex: 1 }} />
          <Btn variant="ghost" onClick={() => onOpenChange(false)}>{t('common.cancel')}</Btn>
          <Btn
            variant="primary"
            onClick={() => saveMut.mutate()}
            disabled={!name.trim() || saveMut.isPending}
          >
            {saveMut.isPending && <Loader2 style={{ width: 14, height: 14, marginRight: 6, animation: 'spin .7s linear infinite' }} />}
            {t('common.save')}
          </Btn>
        </>}
      >
        <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
          <Field label={t('service.name')}>
            <input
              className="input"
              id="svc-name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder={t('service.name_ph')}
              autoFocus
            />
          </Field>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
            <Field label={t('service.price')}>
              <input
                className="input"
                id="svc-price"
                type="number"
                step="0.01"
                value={price}
                onChange={(e) => setPrice(e.target.value)}
                placeholder="0.00"
              />
            </Field>
            <Field label={t('service.currency')}>
              <CurrencyCombobox value={currency} onChange={setCurrency} />
            </Field>
          </div>
        </div>
      </Dialog>

      <ConfirmDialog
        open={confirmDel}
        onOpenChange={setConfirmDel}
        title={t('common.delete_confirm_title')}
        description={t('service.delete_confirm')}
        confirmLabel={t('common.delete')}
        variant="destructive"
        onConfirm={() => { deleteMut.mutate(); setConfirmDel(false); }}
      />
    </>
  );
}
