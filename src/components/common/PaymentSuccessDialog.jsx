import React from 'react';
import { Icon } from '@/design/icons';
import { Btn } from '@/design/index';

/**
 * PaymentSuccessDialog — shown after a successful Stripe checkout return.
 * Self-contained controlled overlay (no ModalHost dependency).
 *
 * Props:
 *   open          — boolean
 *   onOpenChange  — (open: boolean) => void
 */
export default function PaymentSuccessDialog({ open, onOpenChange }) {
  if (!open) return null;
  const close = () => onOpenChange?.(false);
  return (
    <div className="dlg-backdrop" style={{ zIndex: 340 }}
      onClick={(e) => { if (e.target === e.currentTarget) close(); }}>
      <div className="dlg dlg--sm">
        <div className="dlg__body" style={{ textAlign: 'center', padding: '32px 24px 8px' }}>
          <div style={{ width: 64, height: 64, borderRadius: 18, background: 'var(--success-soft)', color: 'var(--success)', display: 'grid', placeItems: 'center', margin: '0 auto 16px' }}>
            <Icon name="check" size={30} />
          </div>
          <div style={{ fontFamily: 'var(--font-display)', fontWeight: 700, fontSize: 22, marginBottom: 8 }}>
            Pro подключён!
          </div>
          <div className="muted" style={{ fontSize: 13.5, lineHeight: 1.6, maxWidth: 320, margin: '0 auto' }}>
            Спасибо за поддержку. Все Pro-возможности уже доступны в твоих трипах.
          </div>
        </div>
        <div className="dlg__foot" style={{ justifyContent: 'center' }}>
          <Btn variant="primary" icon="check" block onClick={close}>Отлично</Btn>
        </div>
      </div>
    </div>
  );
}
