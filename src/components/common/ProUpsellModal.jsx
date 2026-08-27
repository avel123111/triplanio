// @ts-check
import React, { useState } from 'react';
import { Icon } from '@/design/icons';
import { Btn, Dialog, Tile } from '@/design/index';
import { useI18n } from '@/lib/i18n/I18nContext';
import { proUpsellCopy, proUpsellFooter } from '@/lib/proUpsell';

/**
 * ProUpsellModal — единая Pro-апселл модалка (Ф4).
 *
 * ★ ОБОЛОЧКА — КАНОН-<Dialog>, а не голый DialogContent. До этого модалка
 * собирала `.dlg__head`/`.dlg__body`/`.dlg__foot` руками: выглядело один в один,
 * потому что копировались те же классы, но копия не наследовала того, что живёт
 * в обёртке (крест с `ariaLabel`, `busy`, скрытие футера на клавиатуре, опт-аут
 * `aria-describedby`) — и любая правка обёртки до неё не доезжала. Гард 2f
 * (`check-dialog-radix.mjs`) называет этот файл в списке тех, ради кого
 * пришлось заводить вторую проверку «DialogContent без Title».
 *
 * Плитка Pro в шапке — тон `iconTone="pro"` канон-<Tile> (`.tile--solid.tile--pro`,
 * тот же `--pro-gradient`). Приватный `.pi` умер вместе с этим переводом.
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

  /* ★ ПОЧЕМУ ЗДЕСЬ ОБХОД ПОЛА, А НЕ РЕГРЕСС. `dsshare` считает вызовы ДС в
     ЭКРАННОМ коде, а внутренности `src/design/**` в числитель не входят по
     построению. Перевод на обёртку УВЁЛ два вызова из экрана В систему: крест
     (`IconBtn`) и значок шапки (`Icon`) теперь эмитит сам <Dialog>. Замер
     изоляцией — правка только этого файла даёт IconBtn 50→49 и Icon 176→175,
     правка `design/index.jsx` не двигает ничего (она внутри ДС). То есть UI
     стал БОЛЬШЕ из системы, а счётчик упал: метрика штрафует ровно ту работу,
     ради которой заведена.
     floor-exempt: dsshare +1 — вызовы ДС уехали из экрана внутрь обёртки <Dialog>, числитель их не видит; апрув Pavel (задача «унифицировать ProUpsellModal», 2026-08-27) */
  return (
    <Dialog
      size="sm"
      icon="pro"
      iconTone="pro"
      title={t(copy.titleKey, copy.titleParams)}
      open={open}
      onOpenChange={onOpenChange}
      foot={askOwner ? (
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
    >
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
    </Dialog>
  );
}
