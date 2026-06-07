import React from 'react';
import {
  AlertDialog,
  AlertDialogContent,
  AlertDialogHeader,
  AlertDialogFooter,
  AlertDialogTitle,
  AlertDialogDescription,
  AlertDialogAction,
  AlertDialogCancel,
} from '@/components/ui/alert-dialog';
import { useT } from '@/lib/i18n/I18nContext';

/**
 * Reusable confirm/alert dialog - replacement for native window.confirm()/alert().
 *
 * Two modes:
 *  - Confirm (default): two buttons (cancel + action). `onConfirm` is called when
 *    the action button is pressed. Use `variant="destructive"` for delete flows.
 *  - Alert (info-only): pass `singleButton` to show a single OK button. No
 *    `onConfirm` callback is required.
 *
 * Always controlled: parent owns `open` state and clears it via `onOpenChange`.
 */
export default function ConfirmDialog({
  open,
  onOpenChange,
  title,
  description,
  confirmLabel,
  cancelLabel,
  variant = 'default', // 'default' | 'destructive'
  singleButton = false,
  onConfirm,
}) {
  const t = useT();
  const finalConfirmLabel = confirmLabel || (singleButton ? t('common.ok') : t('common.confirm'));
  const finalCancelLabel = cancelLabel || t('common.cancel');

  return (
    <AlertDialog open={open} onOpenChange={onOpenChange}>
      <AlertDialogContent>
        <AlertDialogHeader>
          {title && <AlertDialogTitle>{title}</AlertDialogTitle>}
          {description && (
            <AlertDialogDescription className="whitespace-pre-wrap break-words">
              {description}
            </AlertDialogDescription>
          )}
        </AlertDialogHeader>
        <AlertDialogFooter>
          {!singleButton && <AlertDialogCancel>{finalCancelLabel}</AlertDialogCancel>}
          <AlertDialogAction
            onClick={() => onConfirm?.()}
            variant={variant}
          >
            {finalConfirmLabel}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}