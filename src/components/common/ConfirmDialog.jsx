import React from 'react';
import { Btn, AlertDialog, AlertDialogContent, AlertDialogHeader, AlertDialogFooter, AlertDialogTitle, AlertDialogDescription, AlertDialogAction, AlertDialogCancel, Sheet } from '@/design/index';
import { useIsMobile } from '@/hooks/use-mobile';
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
  asyncMode = false, // confirm runs an awaited action → show spinner, keep open
  busy = false,
  onConfirm,
}) {
  const t = useT();
  const isMobile = useIsMobile();
  const finalConfirmLabel = confirmLabel || (singleButton ? t('common.ok') : t('common.confirm'));
  const finalCancelLabel = cancelLabel || t('common.cancel');

  // Mobile: render through the canonical bottom-sheet (<Sheet>) so confirms share
  // the same grip / swipe / animation as every other sheet and inherit future
  // sheet changes centrally. Desktop keeps the centred AlertDialog.
  if (isMobile) {
    return (
      <Sheet open={open} onOpenChange={onOpenChange} title={title} titleText={title || finalConfirmLabel}>
        {description && (
          <p
            className="muted t-body"
            style={{ margin: '2px 0 0', whiteSpace: 'pre-wrap', wordBreak: 'break-word' }}
          >
            {description}
          </p>
        )}
        <div className="dlg__foot" style={{ border: 'none', background: 'none', padding: '14px 0 4px' }}>
          {!singleButton && (
            <Btn variant="ghost" disabled={busy} style={{ flex: 1, justifyContent: 'center' }} onClick={() => onOpenChange?.(false)}>
              {finalCancelLabel}
            </Btn>
          )}
          <Btn
            variant={variant === 'destructive' ? 'danger-solid' : 'primary'}
            loading={busy}
            style={{ flex: 1, justifyContent: 'center' }}
            onClick={() => onConfirm?.()}
          >
            {finalConfirmLabel}
          </Btn>
        </div>
      </Sheet>
    );
  }

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
          {!singleButton && <AlertDialogCancel disabled={busy}>{finalCancelLabel}</AlertDialogCancel>}
          {asyncMode ? (
            // Plain Btn (not Radix Action) so the dialog does NOT auto-close on
            // click — the provider keeps it open with a spinner until the
            // awaited action resolves.
            <Btn
              variant={variant === 'destructive' ? 'danger-solid' : 'primary'}
              loading={busy}
              onClick={() => onConfirm?.()}
            >
              {finalConfirmLabel}
            </Btn>
          ) : (
            <AlertDialogAction
              onClick={() => onConfirm?.()}
              variant={variant}
            >
              {finalConfirmLabel}
            </AlertDialogAction>
          )}
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}