import React from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Smartphone, Car, ShieldCheck, Pencil } from 'lucide-react';
import CarRentalViewDialog from './CarRentalViewDialog';
import { useI18nFormat } from '@/lib/i18n/I18nContext';

const KIND_ICONS = {
  esim: Smartphone,
  car_rental: Car,
  insurance: ShieldCheck,
};

export default function ServiceViewDialog({ open, onOpenChange, service, onEdit, readOnly = false }) {
  const { t } = useI18nFormat();
  if (!service) return null;
  if (service.kind === 'car_rental') {
    return <CarRentalViewDialog open={open} onOpenChange={onOpenChange} service={service} onEdit={onEdit} readOnly={readOnly} />;
  }
  const Icon = KIND_ICONS[service.kind] || Smartphone;
  const kindLabel = service.kind ? t(`service.kind.${service.kind}`) : t('service.fallback');
  const hasPrice = service.price !== undefined && service.price !== null && service.price !== '';

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <div className="w-9 h-9 rounded-md bg-violet-100 dark:bg-violet-950/40 text-violet-700 dark:text-violet-300 flex items-center justify-center shrink-0">
              <Icon className="w-4 h-4" />
            </div>
            <div>
              <div className="text-[11px] uppercase tracking-wider text-muted-foreground font-semibold">{kindLabel}</div>
              <div className="text-base">{service.name}</div>
            </div>
          </DialogTitle>
        </DialogHeader>

        {hasPrice && (
          <div className="px-1 py-2 text-sm">
            <span className="text-muted-foreground">{t('service.price')}:</span>{' '}
            <span className="font-medium">{service.price} {service.currency || ''}</span>
          </div>
        )}

        <DialogFooter className="flex sm:justify-end gap-2">
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