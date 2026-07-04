import React, { useState } from 'react';
import { Icon } from '@/design/icons';
import { Btn, DialogRoot as Dialog, DialogContent } from '@/design/index';
import { useI18n } from '@/lib/i18n/I18nContext';

/**
 * ProUpsellModal — единая Pro-апселл модалка (Ф4).
 * Radix Dialog: focus-trap, Esc, ARIA portal. Визуально — .dlg/.dlg--sm.
 *
 * Props:
 *   open          – boolean
 *   onOpenChange  – (open: boolean) => void
 *   mode          – 'upgrade' | 'info'
 *                     upgrade : owner/free-user → feat-list + btn--pro CTA
 *                     info    : participant → owner note + feat-list + copy link
 *   feature       – optional translated feature name shown in the title
 *   ownerName     – owner display name (info mode)
 *   onUpgrade     – called after close when user taps "Перейти к Pro" (upgrade mode)
 */
export default function ProUpsellModal({
  open, onOpenChange,
  mode = 'upgrade',
  feature, ownerName,
  onUpgrade,
}) {
  const { t } = useI18n();
  const [copied, setCopied] = useState(false);
  const close = () => onOpenChange?.(false);
  const isInfo = mode === 'info';

  const copyLink = async () => {
    try {
      await navigator.clipboard.writeText(window.location.href);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch { /* clipboard unavailable */ }
  };

  // Shared feat-list — shown in both modes (P4 design)
  const proFeatures = [
    t('sub.perk_unlimited'),
    t('sub.perk_ai'),
    t('sub.perk_members'),
  ];

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="dlg--sm">

            {/* ── Header ── */}
            <div className="dlg__head">
              {/* Shared Pro-tile (.pi) — оранж-розовый градиент, звезда-маркер. */}
              <div className="pi">
                <Icon name="pro" size={17} />
              </div>
              <h2>
                {isInfo
                  ? (feature ? t('sub.trip_pro_feature_named', { feature }) : t('sub.trip_pro_heading'))
                  : (feature ? t('sub.locked_feature_named', { feature }) : t('sub.locked_heading'))
                }
              </h2>
              <button className="icon-btn" onClick={close}>
                <Icon name="close" size={16} />
              </button>
            </div>

            {/* ── Body ── */}
            <div className="dlg__body">
              {/* Description — differs by mode */}
              <div className="muted t-body" style={{ marginBottom: 14 }}>
                {isInfo ? (
                  <>
                    {t('sub.trip_pro_desc_pre')}
                    <b style={{ color: 'var(--ink-2)' }}>{ownerName || t('sub.trip_owner_fallback')}</b>
                    {t('sub.trip_pro_desc_post')}
                  </>
                ) : (
                  t('sub.locked_desc')
                )}
              </div>

              {/* Feat-list — both modes (P4 design) */}
              <ul style={{ listStyle: 'none', margin: 0, padding: 0, display: 'flex', flexDirection: 'column', gap: 9 }}>
                {proFeatures.map((feat, i) => (
                  <li key={i} className="t-ui" style={{ display: 'flex', alignItems: 'center', gap: 10, color: 'var(--ink-2)' }}>
                    <span style={{
                      width: 24, height: 24, borderRadius: 8,
                      background: 'var(--pro-soft)', color: 'var(--pro-ink)',
                      display: 'grid', placeItems: 'center', flexShrink: 0,
                    }}>
                      <Icon name="check" size={13} />
                    </span>
                    {feat}
                  </li>
                ))}
              </ul>
            </div>

            {/* ── Footer ── */}
            <div className="dlg__foot">
              {isInfo ? (
                <>
                  <Btn variant="ghost" icon={copied ? 'check' : 'copy'} onClick={copyLink}>
                    {copied ? t('common.copied') : t('trip.copy_link')}
                  </Btn>
                  <Btn variant="primary" onClick={close}>{t('common.got_it')}</Btn>
                </>
              ) : (
                <>
                  <Btn variant="ghost" onClick={close}>{t('common.close')}</Btn>
                  <Btn variant="pro" icon="pro" onClick={() => { close(); onUpgrade?.(); }}>
                    {t('trips.go_pro')}
                  </Btn>
                </>
              )}
            </div>

      </DialogContent>
    </Dialog>
  );
}
