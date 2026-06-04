import React from 'react';
import { Icon } from '@/design/icons';
import { Btn } from '@/design/index';
import { useI18n } from '@/lib/i18n/I18nContext';

/**
 * PaymentSuccessDialog - shown after a successful Stripe checkout return.
 * Self-contained controlled overlay (no ModalHost dependency).
 *
 * Props:
 *   open          - boolean
 *   onOpenChange  - (open: boolean) => void
 *   planLabel     - optional purchased plan name (e.g. "Pro Monthly")
 *   priceLabel    - optional price string (e.g. "€9.99/мес"); shown only if known
 */
export default function PaymentSuccessDialog({ open, onOpenChange, planLabel, priceLabel }) {
  const { t } = useI18n();
  if (!open) return null;
  const close = () => onOpenChange?.(false);
  const chip = planLabel
    ? (priceLabel ? `${planLabel} · ${priceLabel}` : planLabel)
    : null;
  return (
    <div className="dlg-backdrop" style={{ zIndex: 340 }}
      onClick={(e) => { if (e.target === e.currentTarget) close(); }}>
      <div className="dlg dlg--sm" style={{ position: 'relative' }}>
        <button className="icon-btn" onClick={close}
          style={{ position: 'absolute', top: 14, right: 14, zIndex: 1 }}>
          <Icon name="close" size={16} />
        </button>
        <div className="dlg__body" style={{ textAlign: 'center', padding: '36px 24px 8px' }}>
          <div style={{ width: 72, height: 72, borderRadius: 18, background: 'var(--success-soft)', color: 'var(--success)', display: 'grid', placeItems: 'center', margin: '0 auto 18px' }}>
            <Icon name="check" size={36} />
          </div>
          <h2 style={{ marginBottom: 8 }}>{t('sub.success_title')}</h2>
          <div className="muted" style={{ fontSize: 'var(--fs-strong)', lineHeight: 1.55, maxWidth: 360, margin: '0 auto 14px' }}>
            {t('sub.success_desc')}
          </div>
          {chip && (
            <div style={{ display: 'inline-flex', alignItems: 'center', gap: 6, padding: '5px 12px', background: 'var(--warm-tint)', color: 'var(--warm)', borderRadius: 999, fontSize: 'var(--fs-meta)', fontWeight: 600 }}>
              <Icon name="pro" size={12} /> {chip}
            </div>
          )}
        </div>
        <div className="dlg__foot">
          <Btn variant="primary" block onClick={close}>{t('sub.success_cta')}</Btn>
        </div>
      </div>
    </div>
  );
}
