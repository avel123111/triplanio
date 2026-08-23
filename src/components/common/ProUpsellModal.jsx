// @ts-check
import React, { useState } from 'react';
import { Icon } from '@/design/icons';
import { Btn, IconBtn, Tile, DialogRoot as Dialog, DialogContent, DialogTitle } from '@/design/index';
import { useI18n } from '@/lib/i18n/I18nContext';
import { proUpsellCopy, proUpsellFooter } from '@/lib/proUpsell';

/**
 * ProUpsellModal — единая Pro-апселл модалка (Ф4).
 * Radix Dialog: focus-trap, Esc, ARIA portal. Визуально — .dlg/.dlg--sm.
 *
 * Props:
 *   open          – boolean
 *   onOpenChange  – (open: boolean) => void
 *   role          – 'owner' | 'member' — что человек МОЖЕТ (владелец платит,
 *                   участник просит владельца). Решает футер.
 *   source        – 'menu' | 'feature' — что он СПРАШИВАЕТ (что такое Pro /
 *                   почему это закрыто). Решает копию.
 *   feature       – optional translated feature name shown in the title
 *   ownerName     – owner display name (участнику)
 *   onUpgrade     – called after close when user taps "Перейти к Pro" (владелец)
 *
 * Обе оси — в `@/lib/proUpsell` одной таблицей: предикат там один и покрыт
 * тестом, здесь остаётся только рендер.
 *
 * @param {{ open?: boolean, onOpenChange?: (o: boolean) => void,
 *           role?: import('@/lib/proUpsell').ProRole,
 *           source?: import('@/lib/proUpsell').ProSource,
 *           feature?: string, ownerName?: string, onUpgrade?: () => void }} p
 */
export default function ProUpsellModal({
  open, onOpenChange,
  role = 'owner', source = 'feature',
  feature, ownerName,
  onUpgrade,
}) {
  const { t } = useI18n();
  const [copied, setCopied] = useState(false);
  const close = () => onOpenChange?.(false);
  const copy = proUpsellCopy({ role, source, feature });
  const askOwner = proUpsellFooter(role) === 'ask-owner';

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
      <DialogContent className="dlg--sm" aria-describedby={undefined}>

            {/* ── Header ── */}
            <div className="dlg__head">
              {/* Shared Pro-tile (.pi) — оранж-розовый градиент, звезда-маркер. */}
              <div className="pi">
                <Icon name="pro" size={17} />
              </div>
              <DialogTitle asChild>
                <h2>{t(copy.titleKey, copy.titleParams)}</h2>
              </DialogTitle>
              <IconBtn icon="close" onClick={close} ariaLabel={t('common.close')} />
            </div>

            {/* ── Body ── */}
            <div className="dlg__body">
              {/* Description — differs by mode */}
              <div className="muted t-body" style={{ marginBottom: 14 }}>
                {copy.desc === 'owner-note' ? (
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
                  <li key={i} className="t-body" style={{ display: 'flex', alignItems: 'center', gap: 10, color: 'var(--ink-2)' }}>
                    <Tile as="span" style={{ '--tile': '24px', '--tile-ic': '13px', '--hl-soft': 'var(--pro-soft)', '--hl-ink': 'var(--pro-ink)' }}>
                      <Icon name="check" size={13} />
                    </Tile>
                    {feat}
                  </li>
                ))}
              </ul>
            </div>

            {/* ── Footer ── */}
            <div className="dlg__foot">
              {askOwner ? (
                <>
                  <Btn variant="secondary" icon={copied ? 'check' : 'copy'} onClick={copyLink}>
                    {copied ? t('common.copied') : t('trip.copy_link')}
                  </Btn>
                  <Btn variant="primary" onClick={close}>{t('common.got_it')}</Btn>
                </>
              ) : (
                <>
                  <Btn variant="secondary" onClick={close}>{t('common.close')}</Btn>
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
