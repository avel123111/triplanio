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

  // Shared feat-list — shown in both modes (P4 design). Three of the four rows are
  // literally the /pro table strings in the same words, so they share those keys
  // (one fact on two surfaces, not the common.copy anti-pattern). The "unlimited
  // trips" row is gone — the Free active-trip cap is lifted (TRIP-503). perk_members
  // stays modal-specific in its own family.
  const proFeatures = [
    t('sub.feat_ai_recognition'),
    t('sub.feat_budget'),
    t('sub.feat_ai_assistant'),
    t('sub.perk_members'),
  ];

  /* ★ ПОЧЕМУ ЗДЕСЬ ОБХОД ПОЛА, А НЕ РЕГРЕСС. `dsshare` — это ДОЛЯ (сотые доли
     процента), а не счётчик: 4276 → 4275 значит 42.76% → 42.75%. Замер на
     origin/dev vs HEAD: числитель 1438 → 1434, знаменатель 3363 → 3354.
     Из экрана ушли РОВНО девять узлов разметки — 4 вызова ДС (DialogContent,
     DialogTitle, IconBtn-крест, Icon-звезда) и 5 сырых тегов (div.pi,
     div.dlg__head, div.dlg__body, div.dlg__foot, h2), — и все девять теперь
     рисует обёртка; в экране остался ОДИН вызов <Dialog>.
     Дальше арифметика дроби: в удалённом куске доля ДС была 4/9 = 44.4% при
     средней по репозиторию 42.76%, а удаление куска ЧИЩЕ СРЕДНЕГО опускает
     среднее. Метрика не говорит «стало хуже» — она по построению не отличает
     «разметку удалили» от «разметку написали сырой», потому что это дробь.
     Следствие шире этого PR: любая унификация в обёртку схлопывает разметку и
     потому рискует уронить долю, даже безупречная.
     floor-exempt: dsshare +1 — доля просела на 0.0045 п.п. из-за схлопывания 9 узлов разметки в 1 вызов обёртки (числитель −4, знаменатель −9); апрув Pavel 2026-08-27 */  return (
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
      <div className="muted" style={{ marginBottom: 14 }}>
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
          <li key={i} style={{ display: 'flex', alignItems: 'center', gap: 10, color: 'var(--ink-2)' }}>
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
