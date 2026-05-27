import React from 'react';
import { Icon } from '@/design/icons';
import { Btn } from '@/design/index';

/**
 * PaymentFailDialog — shown when a Stripe checkout is cancelled or errors out.
 * Self-contained controlled overlay (no ModalHost dependency).
 *
 * Props:
 *   open          — boolean
 *   onOpenChange  — (open: boolean) => void
 *   message       — optional error detail to show
 *   onRetry       — called when the user taps "Повторить"
 */
export default function PaymentFailDialog({ open, onOpenChange, message, onRetry }) {
  if (!open) return null;
  const close = () => onOpenChange?.(false);
  return (
    <div className="dlg-backdrop" style={{ zIndex: 340 }}
      onClick={(e) => { if (e.target === e.currentTarget) close(); }}>
      <div className="dlg dlg--sm">
        <div className="dlg__body" style={{ textAlign: 'center', padding: '32px 24px 8px' }}>
          <div style={{ width: 64, height: 64, borderRadius: 18, background: 'var(--danger-soft)', color: 'var(--danger)', display: 'grid', placeItems: 'center', margin: '0 auto 16px' }}>
            <Icon name="error" size={30} />
          </div>
          <div style={{ fontFamily: 'var(--font-display)', fontWeight: 700, fontSize: 22, marginBottom: 8 }}>
            Оплата не прошла
          </div>
          <div className="muted" style={{ fontSize: 13.5, lineHeight: 1.6, maxWidth: 320, margin: '0 auto' }}>
            {message || 'Платёж был отменён или не завершён. Подписка не оформлена — попробуй ещё раз.'}
          </div>
        </div>
        <div className="dlg__foot" style={{ justifyContent: 'center' }}>
          <Btn variant="ghost" onClick={close}>Закрыть</Btn>
          <Btn variant="primary" icon="refresh" onClick={() => { close(); onRetry?.(); }}>Повторить</Btn>
        </div>
      </div>
    </div>
  );
}
