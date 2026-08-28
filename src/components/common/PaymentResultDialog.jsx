// @ts-check
import React from 'react';
import { Badge, Btn, Card, Dialog } from '@/design/index';
import { useI18n } from '@/lib/i18n/I18nContext';

/**
 * PaymentResultDialog — единый диалог исхода оплаты (Ф5, P5 design).
 *
 * ★ ОБОЛОЧКА — КАНОН-<Dialog>, а не голый DialogContent. До этого экран собирал
 * `.dlg__body`/`.dlg__foot` руками и рисовал СВОЮ раскладку: 52-пиксельная
 * плитка по центру, центрированный заголовок, инлайновый паддинг `32px 24px 8px`.
 * Выглядело это самостоятельно, но стоило трёх вещей сразу:
 *   1. КРЕСТИКА НЕ БЫЛО ВОВСЕ — единственное окно приложения, которое нельзя
 *      закрыть мышью (только кнопка/Esc/подложка);
 *   2. инлайновый паддинг ГЛУШИЛ канон — любая правка ритма окна проходила мимо
 *      этого экрана молча;
 *   3. «исход операции» — не отдельный жанр: у окна одна анатомия, а success и
 *      fail это ТОН, и он уже есть у плитки шапки (`.tile--success`/`--danger`).
 * Центрированная раскладка снята сознательно: 52-px иконка по центру — второй
 * облик окна, который ничем, кроме привычки, не оправдан.
 *
 * ★ ПОЧЕМУ ЗДЕСЬ ОБХОД ПОЛА, А НЕ РЕГРЕСС. `dsshare` — ДОЛЯ, а не счётчик.
 * Замер origin/dev vs HEAD: 1446/3370 = 42.91% → 1443/3366 = 42.87%, то есть
 * числитель −3 при знаменателе −4. Схлопнутый кусок был на 75% из ДС при
 * средней по репозиторию 42.91% — удаление куска ЧИЩЕ СРЕДНЕГО опускает
 * среднее. Метрика по построению не отличает «разметку удалили» от «разметку
 * написали сырой»: тот же эффект уже фиксировали при переводе ProUpsellModal
 * на обёртку (PR #1043). Инлайнов при этом стало на 8 меньше (484 → 476).
 * floor-exempt: dsshare +4 — доля просела на 0.04 п.п. из-за схлопывания сырой разметки в обёртку (числитель −3, знаменатель −4); апрув Pavel (задание «сделай системно»)
 *
 * Props:
 *   open          – boolean
 *   onOpenChange  – (open: boolean) => void
 *   status        – 'success' | 'fail'
 *   variant       – 'sub' | 'trip' — копия/CTA успеха
 *   planLabel     – optional plan name (success only, e.g. "Pro Monthly")
 *   priceLabel    – optional price string (success only, e.g. "€9.99/мес")
 *   code          – optional Stripe decline code (fail only)
 *   onRetry       – called when user taps retry (fail only)
 *
 * Replaces: PaymentSuccessDialog + PaymentFailDialog.
 */
export default function PaymentResultDialog({
  open, onOpenChange,
  status,
  variant = 'sub',           // 'sub' | 'trip' — picks copy/CTA for the success state
  planLabel, priceLabel,
  code, onRetry,
}) {
  const { t } = useI18n();
  const close = () => onOpenChange?.(false);
  const isSuccess = status === 'success';
  const isTrip = variant === 'trip';

  // Per-trip purchase has no subscription → never show a plan/price chip.
  const chip = isSuccess && !isTrip && planLabel
    ? (priceLabel ? `${planLabel} · ${priceLabel}` : planLabel)
    : null;

  return (
    <Dialog
      size="sm"
      icon={isSuccess ? 'check' : 'error'}
      iconTone={isSuccess ? 'success' : 'danger'}
      title={isSuccess ? t(isTrip ? 'sub.success_title_trip' : 'sub.success_title') : t('sub.fail_title')}
      open={open}
      onOpenChange={onOpenChange}
      foot={isSuccess ? (
        <Btn variant="primary" onClick={close}>
          {t(isTrip ? 'sub.success_cta_trip' : 'sub.success_cta')}
        </Btn>
      ) : (
        <>
          <Btn variant="secondary" onClick={close}>{t('common.close')}</Btn>
          <Btn variant="primary" icon="refresh" onClick={() => { close(); onRetry?.(); }}>
            {t('sub.fail_retry')}
          </Btn>
        </>
      )}
    >
      {/* Кегль приходит от тела окна (канон Support), здесь только тон. */}
      <div className="muted">
        {isSuccess
          ? t(isTrip ? 'sub.success_desc_trip' : 'sub.success_desc')
          : code
            ? <>{t('sub.fail_declined_pre')}<span className="mono t-mono" style={{ color: 'var(--ink-2)' }}>{code}</span>{t('sub.fail_declined_post')}</>
            : t('sub.fail_cancelled')
        }
      </div>

      {/* Success: plan chip */}
      {chip && (
        <Badge variant="pro" icon="pro" style={{ marginTop: 10 }}>{chip}</Badge>
      )}

      {/* Fail: help note. Утоплённая заметка — канон <Card recessed>; радиус
          `btn`, потому что лестница ВНУТРИ окна короче лестницы карточки:
          оболочка 14 > вложенное 10 (см. --r-dlg в app.css). */}
      {!isSuccess && (
        <Card recessed radius="btn" pad="none" className="t-meta" style={{ padding: '9px 12px', marginTop: 10, color: 'var(--muted)' }}>
          {t('sub.fail_help')}
        </Card>
      )}
    </Dialog>
  );
}
