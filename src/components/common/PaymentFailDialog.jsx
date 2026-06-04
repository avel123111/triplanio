import React from 'react';
import { Icon } from '@/design/icons';
import { Btn } from '@/design/index';
import { useI18n } from '@/lib/i18n/I18nContext';

/**
 * PaymentFailDialog - shown when a Stripe checkout is cancelled or errors out.
 * Self-contained controlled overlay (no ModalHost dependency).
 *
 * Props:
 *   open          - boolean
 *   onOpenChange  - (open: boolean) => void
 *   code          - optional Stripe decline code (e.g. "card_declined")
 *   onRetry       - called when the user taps "Повторить оплату"
 */
export default function PaymentFailDialog({ open, onOpenChange, code, onRetry }) {
  const { t } = useI18n();
  if (!open) return null;
  const close = () => onOpenChange?.(false);
  return (
    <div className="dlg-backdrop" style={{ zIndex: 340 }}
      onClick={(e) => { if (e.target === e.currentTarget) close(); }}>
      <div className="dlg dlg--sm" style={{ position: 'relative' }}>
        <button className="icon-btn" onClick={close}
          style={{ position: 'absolute', top: 14, right: 14, zIndex: 1 }}>
          <Icon name="close" size={16} />
        </button>
        <div className="dlg__body" style={{ textAlign: 'center', padding: '36px 24px 8px' }}>
          <div style={{ width: 72, height: 72, borderRadius: 18, background: 'var(--danger-soft)', color: 'var(--danger)', display: 'grid', placeItems: 'center', margin: '0 auto 18px' }}>
            <Icon name="error" size={36} />
          </div>
          <h2 style={{ marginBottom: 8 }}>{t('sub.fail_title')}</h2>
          <div className="muted" style={{ fontSize: 'var(--fs-strong)', lineHeight: 1.55, marginBottom: 14, maxWidth: 360, margin: '0 auto 14px' }}>
            {code
              ? <>{t('sub.fail_declined_pre')}<span className="mono" style={{ color: 'var(--ink-2)' }}>{code}</span>{t('sub.fail_declined_post')}</>
              : <>{t('sub.fail_cancelled')}</>}
          </div>
          <div style={{ background: 'var(--wash)', padding: 10, borderRadius: 8, fontSize: 'var(--fs-meta)', color: 'var(--muted)', lineHeight: 1.5, maxWidth: 360, margin: '0 auto' }}>
            {t('sub.fail_help')}
          </div>
        </div>
        <div className="dlg__foot">
          <Btn variant="ghost" onClick={close}>{t('common.close')}</Btn>
          <Btn variant="primary" icon="refresh" onClick={() => { close(); onRetry?.(); }}>{t('sub.fail_retry')}</Btn>
        </div>
      </div>
    </div>
  );
}
