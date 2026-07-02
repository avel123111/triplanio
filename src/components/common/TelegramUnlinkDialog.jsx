import React from 'react';
import { Dialog, Btn } from '@/design/index';
import { useT } from '@/lib/i18n/I18nContext';

/**
 * Shared destructive confirm for removing a Telegram binding.
 * Controlled via open/onOpenChange (Lumo `Dialog` → ui/dialog engine).
 *
 * Props:
 *   handle       - display string for the chat (@username or first name)
 *   onConfirm    - called when user confirms
 *   open         - controlled open state (optional)
 *   onOpenChange - controlled close handler (optional)
 */
export default function TelegramUnlinkDialog({ handle, onConfirm, open, onOpenChange }) {
  const t = useT();
  const close = () => onOpenChange?.(false);
  return (
    <Dialog
      title={t('telegram.unlink_title')}
      icon="warning"
      size="sm"
      open={open}
      onOpenChange={onOpenChange}
      foot={<>
        <Btn variant="ghost" onClick={close}>{t('common.cancel')}</Btn>
        <Btn variant="danger-solid" onClick={() => { onConfirm?.(); close(); }}>
          {t('telegram.unlink_confirm')}
        </Btn>
      </>}
    >
      <div className="t-body" style={{ color: 'var(--ink-2)' }}>
        {t('telegram.unlink_body', { handle })}
      </div>
    </Dialog>
  );
}
