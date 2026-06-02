import React from 'react';
import { Dialog, Btn } from '@/design/index';
import { useT } from '@/lib/i18n/I18nContext';

/**
 * Shared destructive confirm for removing a Telegram binding.
 *
 * Used in two places (single source of truth - matches the design modal):
 *   - Trip settings (SettingsLens → TelegramSection): remove a bound chat from a trip.
 *   - Account settings (ScreenAccount → ConnectedAccountsSection): unlink a trip.
 *
 * Both render it through the design ModalHost (window.__openModal). The actual
 * deletion is the caller's `onConfirm` (telegramDisconnect({ tripId, integrationId })).
 *
 * Props:
 *   handle    - display string for the chat (@username or first name), shown in the body.
 *   onConfirm - called when the user confirms; the dialog closes itself afterwards.
 */
export default function TelegramUnlinkDialog({ handle, onConfirm }) {
  const t = useT();
  return (
    <Dialog
      title={t('telegram.unlink_title')}
      icon="warning"
      size="sm"
      foot={<>
        <Btn variant="ghost" onClick={() => window.__closeModal?.()}>{t('common.cancel')}</Btn>
        <Btn variant="danger-solid" onClick={() => { onConfirm?.(); window.__closeModal?.(); }}>
          {t('telegram.unlink_confirm')}
        </Btn>
      </>}
    >
      <div style={{ fontSize: 13.5, color: 'var(--ink-2)', lineHeight: 1.55 }}>
        {t('telegram.unlink_body', { handle })}
      </div>
    </Dialog>
  );
}
