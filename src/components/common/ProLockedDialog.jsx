import React from 'react';
import { Icon } from '@/design/icons';
import { Btn } from '@/design/index';

/**
 * ProLockedDialog — shown when a free user tries to use a Pro-only feature.
 * Self-contained controlled overlay (no ModalHost dependency).
 *
 * Props:
 *   open          — boolean
 *   onOpenChange  — (open: boolean) => void
 *   feature       — optional feature name to mention
 *   onUpgrade     — called when the user taps "Перейти к Pro"
 */
export default function ProLockedDialog({ open, onOpenChange, feature, onUpgrade }) {
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
          <h2>Функция Pro</h2>
          <button className="icon-btn" onClick={close}><Icon name="close" size={16} /></button>
        </div>
        <div className="dlg__body">
          <div style={{ textAlign: 'center', padding: '8px 0 4px' }}>
            <div style={{ width: 56, height: 56, borderRadius: 14, background: 'var(--warm-tint)', color: 'var(--warm)', display: 'grid', placeItems: 'center', margin: '0 auto 12px' }}>
              <Icon name="lock" size={24} />
            </div>
            <div style={{ fontWeight: 700, fontSize: 16, marginBottom: 8 }}>
              {feature ? `«${feature}» доступна в Pro` : 'Доступно в Pro'}
            </div>
            <div className="muted" style={{ fontSize: 13, lineHeight: 1.6, maxWidth: 320, margin: '0 auto' }}>
              Подключи Pro-тариф, чтобы открыть расширенные возможности трипа.
            </div>
          </div>
        </div>
        <div className="dlg__foot">
          <Btn variant="ghost" onClick={close}>Закрыть</Btn>
          <Btn variant="primary" icon="crown" onClick={() => { close(); onUpgrade?.(); }}>Перейти к Pro</Btn>
        </div>
      </div>
    </div>
  );
}
