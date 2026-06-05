import React from 'react';
import { Icon } from '@/design/icons';
import { Btn } from '@/design/index';
import { useI18n } from '@/lib/i18n/I18nContext';

/**
 * ProLockedDialog - shown when a free user tries to use a Pro-only feature.
 * Self-contained controlled overlay (no ModalHost dependency).
 *
 * Props:
 *   open          - boolean
 *   onOpenChange  - (open: boolean) => void
 *   feature       - optional feature name to mention
 *   onUpgrade     - called when the user taps "Перейти к Pro"
 */
export default function ProLockedDialog({ open, onOpenChange, feature, onUpgrade }) {
  const { t } = useI18n();
  if (!open) return null;
  const close = () => onOpenChange?.(false);
  return (
    <div className="dlg-backdrop" style={{ zIndex: 320 }}
      onClick={(e) => { if (e.target === e.currentTarget) close(); }}>
      <div className="dlg dlg--sm">
        <div className="dlg__head">
          <div style={{ width: 36, height: 36, borderRadius: 9, background: 'var(--warm-tint)', color: 'var(--warm)', display: 'grid', placeItems: 'center', flexShrink: 0 }}>
            <Icon name="lock" size={17} />
          </div>
          <h2>{t('sub.locked_heading')}</h2>
          <button className="icon-btn" onClick={close}><Icon name="close" size={16} /></button>
        </div>
        <div className="dlg__body">
          <div style={{ textAlign: 'center', padding: '8px 0 4px' }}>
            <div style={{ width: 56, height: 56, borderRadius: 14, background: 'var(--warm-tint)', color: 'var(--warm)', display: 'grid', placeItems: 'center', margin: '0 auto 12px' }}>
              <Icon name="lock" size={24} />
            </div>
            <div style={{ fontWeight: 700, fontSize: 'var(--fs-lg)', marginBottom: 8 }}>
              {feature ? t('sub.locked_feature_named', { feature }) : t('sub.locked_generic')}
            </div>
            <div className="muted" style={{ fontSize: 'var(--fs-base)', lineHeight: 1.6, maxWidth: 320, margin: '0 auto' }}>
              {t('sub.locked_desc')}
            </div>
          </div>
        </div>
        <div className="dlg__foot">
          <Btn variant="ghost" onClick={close}>{t('common.close')}</Btn>
          <Btn variant="primary" icon="crown" onClick={() => { close(); onUpgrade?.(); }}>{t('trips.go_pro')}</Btn>
        </div>
      </div>
    </div>
  );
}
