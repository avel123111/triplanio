import React from 'react';
import { Btn, AlertDialog, AlertDialogContent, AlertDialogHeader, AlertDialogFooter, AlertDialogTitle, AlertDialogDescription, AlertDialogAction, AlertDialogCancel, Sheet } from '@/design/index';
import { useIsPhone } from '@/hooks/use-mobile';
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
  content, // rich body node (e.g. <EmptyState/>) — replaces title/description block
  confirmLabel,
  cancelLabel,
  variant = 'default', // 'default' | 'destructive'
  singleButton = false,
  asyncMode = false, // confirm runs an awaited action → show spinner, keep open
  busy = false,
  onConfirm,
}) {
  const t = useT();
  const isPhone = useIsPhone();
  const finalConfirmLabel = confirmLabel || (singleButton ? t('common.ok') : t('common.confirm'));
  const finalCancelLabel = cancelLabel || t('common.cancel');

  // Mobile: render through the canonical bottom-sheet (<Sheet>) so confirms share
  // the same grip / swipe / animation as every other sheet and inherit future
  // sheet changes centrally. Desktop keeps the centred AlertDialog.
  if (isPhone) {
    return (
      // With a rich `content` node the body carries its own heading (EmptyState),
      // so the sheet skips its visible title bar to avoid a duplicate — the
      // accessible name still rides `titleText` (sr-only Drawer.Title).
      <Sheet open={open} onOpenChange={onOpenChange} title={content ? undefined : title} titleText={title || finalConfirmLabel}>
        {content || (description && (
          <p
            className="muted t-body"
            style={{ margin: '2px 0 0', whiteSpace: 'pre-wrap', wordBreak: 'break-word' }}
          >
            {description}
          </p>
        ))}
        <div className="dlg__foot" style={{ border: 'none', background: 'none', padding: '14px 0 4px' }}>
          {!singleButton && (
            <Btn variant="secondary" disabled={busy} style={{ flex: 1, justifyContent: 'center' }} onClick={() => onOpenChange?.(false)}>
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
      {/* Radix opt-out when a caller passes no description — Radix's own sanctioned
          way to silence "Missing Description or aria-describedby" (guard 2f). Belt
          for the braces: CI guard 2ab forbids a title/description-less confirm at
          the call site, so in practice `description` is always present. */}
      <AlertDialogContent {...(description ? {} : { 'aria-describedby': undefined })}>
        {content ? (
          // Rich body (EmptyState) carries its own visible heading AND its own
          // padding, so it sits straight in the card (no .dlg__body, which would
          // double the padding). Radix still needs a Title for a11y → sr-only one.
          <>
            <AlertDialogTitle className="sr-only">{title || finalConfirmLabel}</AlertDialogTitle>
            {content}
          </>
        ) : (
          <AlertDialogHeader>
            {title && <AlertDialogTitle>{title}</AlertDialogTitle>}
            {description && (
              <AlertDialogDescription className="whitespace-pre-wrap break-words">
                {description}
              </AlertDialogDescription>
            )}
          </AlertDialogHeader>
        )}
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