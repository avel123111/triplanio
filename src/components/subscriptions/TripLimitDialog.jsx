// @ts-check
import React, { useState, useEffect, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { Icon } from '@/design/icons';
import { Badge, Btn, Card, IconBtn, DialogRoot as Dialog, DialogContent, DialogTitle } from '@/design/index';
import { invokeFn } from '@/lib/invokeFn';
import { useI18n } from '@/lib/i18n/I18nContext';
import { isActiveTripCapReached } from '@/lib/limits';
import { goPro } from '@/lib/goPro';
import { track } from '@/lib/analytics';

/**
 * Trip-limit modal (Variant D) - shown for the IN-APP "new trip" action when a
 * free user has hit the 1-active-trip limit. (Direct deep-links to the manual /
 * AI planner show a full-screen blocker instead.)
 *
 * Props:
 *   open, onOpenChange
 *   onProceed              - called when the user is allowed to continue
 *   activeCount, isPro     - pre-computed (preferred); otherwise self-fetched
 */
export default function TripLimitDialog({ open, onOpenChange, onProceed, activeCount: activeCountProp, isPro: isProProp }) {
  const { t } = useI18n();
  const hasPreComputed = typeof activeCountProp === 'number' && typeof isProProp === 'boolean';
  const [state, setState] = useState(() => hasPreComputed
    ? { status: 'ready', activeCount: activeCountProp, isPro: isProProp }
    : { status: 'idle', activeCount: 0, isPro: false }
  );
  const nav = useNavigate();
  const openUpgrade = () => { onOpenChange?.(false); goPro(nav, { hidePerTrip: true, from: 'paywall', feature: 'trip_limit' }); };
  const proceededRef = useRef(false);

  useEffect(() => {
    if (!open) {
      proceededRef.current = false;
      setState(hasPreComputed
        ? { status: 'ready', activeCount: activeCountProp, isPro: isProProp }
        : { status: 'idle', activeCount: 0, isPro: false });
      return;
    }
    if (hasPreComputed) {
      setState({ status: 'ready', activeCount: activeCountProp, isPro: isProProp });
      return;
    }
    let cancelled = false;
    setState(s => ({ ...s, status: 'loading' }));
    (async () => {
      try {
        const res = await invokeFn('getActiveTrips', { body: {} });
        if (cancelled) return;
        setState({ status: 'ready', activeCount: res.data?.activeCount || 0, isPro: !!res.data?.isPro });
      } catch (e) {
        console.error(e);
        if (!cancelled) setState({ status: 'ready', activeCount: 0, isPro: false });
      }
    })();
    return () => { cancelled = true; };
  }, [open, hasPreComputed, activeCountProp, isProProp]);

  // Allowed → proceed automatically (in effect, never in render).
  useEffect(() => {
    if (!open || state.status !== 'ready') return;
    const shouldBlock = isActiveTripCapReached(state.isPro, state.activeCount);
    if (!shouldBlock && !proceededRef.current) {
      proceededRef.current = true;
      onProceed?.();
      onOpenChange(false);
    }
  }, [open, state, onProceed, onOpenChange]);

  // TRIP-520: показ блокировки = впечатление пейволла (Revenue funnel), форма
  // пропов как у ProUpsellProvider. Реф-гард — чтобы ререндер не считал повтор.
  const paywallSeenRef = useRef(false);
  useEffect(() => {
    if (!open) { paywallSeenRef.current = false; return; }
    if (state.status !== 'ready') return;
    if (!isActiveTripCapReached(state.isPro, state.activeCount)) return;
    if (paywallSeenRef.current) return;
    paywallSeenRef.current = true;
    track('paywall_viewed', { feature: 'trip_limit', mode: 'upgrade' });
  }, [open, state]);

  if (open && state.status !== 'ready') {
    return (
      <Dialog open={open} onOpenChange={onOpenChange}>
        <DialogContent className="dlg--sm" aria-describedby={undefined}>
          {/* Transient loading state has no visible heading — sr-only Title carries the name. */}
          <DialogTitle className="sr-only">{t('sub.limit_hero_title')}</DialogTitle>
          <div className="row row--j-center" style={{ padding: '32px 0' }}>
            <div className="spin spin--ring spin--lg" />
          </div>
        </DialogContent>
      </Dialog>
    );
  }

  const shouldBlock = isActiveTripCapReached(state.isPro, state.activeCount);
  if (!shouldBlock) return null;

  const freeRows = [
    { ok: true,  text: t('sub.feat_free_active1') },
    { ok: true,  text: t('sub.feat_free_sections') },
    { ok: false, text: t('sub.feat_unlimited_trips') },
    { ok: false, text: t('sub.feat_ai_recognition') },
  ];
  const proRows = [
    <><b>{t('sub.unlimited_word')}</b> {t('sub.feat_unlimited_active_rest')}</>,
    t('sub.feat_ai_recognition'),
    t('sub.feat_all_sections'),
    t('sub.feat_priority_support'),
  ];

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="dlg--wide" aria-describedby={undefined}>
        {/* ★ ШАПКА ЗДЕСЬ — ГЕРОЙ, И ЭТО ЗАКОННАЯ ВТОРАЯ АНАТОМИЯ ОКНА, а не
            обход канона: ровно так же устроены окна события (`.lp-h--ev` —
            тонированная градиентом полоса с заголовком). Сводить её к канон-
            шапке значило бы разменять обещание («Планируй сколько угодно») на
            строку 16/600 и оставить градиент полосой без заголовка — то есть
            перевернуть смысловую иерархию пейволла. Поэтому герой остаётся, а
            на канон переезжает ХРОМ ВОКРУГ него: тело и футер.
            Крестик добавлен — до этого окно нельзя было закрыть мышью вовсе
            (кнопка «Не сейчас» / Esc / подложка), единственное такое в
            приложении. Он лежит В ГЕРОЕ, как крест шапки события. */}
        <div className="dlg__body">
          {/* Hero.
              ⚠⚠ ЧЕРНИЛА ЗДЕСЬ — ЛИТЕРАЛ, И ЭТО НЕ НЕБРЕЖНОСТЬ. `--pro-hero-grad`
              это ФИКСИРОВАННЫЙ тёмный градиент: он один и тот же в светлой и в
              тёмной теме. Значит и текст на нём обязан быть фиксированно
              светлым. Тема-зависимый токен тут ЛОМАЕТ полосу: `--primary-fg`
              («чернила НА --brand») в светлой белый, а в тёмной — почти чёрный
              (см. его объявление в тёмном :root), и заголовок оказывается
              тёмным на тёмно-синем. Так и вышло — подстановка токена «для
              чистоты» уронила читаемость в тёмной теме.
              ★ `--pro-hero-grad` — ЕДИНСТВЕННЫЙ градиент системы без тёмного
              варианта: `--pro-gradient` и `--ai-gradient` объявлены в обеих
              темах, а этот только в светлом :root. Поэтому он и единственное
              место, где литерал — правильный ответ.
              ПРАВИЛО: цвет берётся у токена только тогда, когда ПОВЕРХНОСТЬ под
              ним тоже следует за темой. Под фиксированной поверхностью —
              фиксированные чернила. */}
          <div className="row" style={{ position: 'relative', alignItems: 'flex-start', borderRadius: 'var(--r-btn)', overflow: 'hidden', padding: '22px 24px', marginBottom: 16,
            background: 'var(--pro-hero-grad)', color: '#fff' }}>
            <div className="grow--fit">
              <Badge variant="pro" icon="pro" style={{ marginBottom: 10 }}>PRO</Badge>
              <DialogTitle asChild>
                <div className="t-heading" style={{ marginBottom: 6 }}>
                  {t('sub.limit_hero_title')}
                </div>
              </DialogTitle>
              {/* Тот же литерал по той же причине: `opacity` наследовала бы
                  цвет родителя, а он тут именно фиксированный. */}
              <div style={{ color: 'rgba(255,255,255,.9)' }}>
                {t('sub.limit_hero_sub', { count: state.activeCount })}
              </div>
            </div>
            <IconBtn icon="close" onClick={() => onOpenChange(false)} ariaLabel={t('common.close')} style={{ color: '#fff' }} />
          </div>

          {/* Info strip — TRIP-343 объект 2 (канал 3): скин утоплённой поверхности
              (--wash+рамка+радиус) снят с инлайна на <Card recessed>; бокс внутри
              оболочки диалога (объект 6) — мигрируется бокс, не оболочка. */}
          <Card recessed radius="btn" pad="none" className="t-meta" style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '10px 14px', marginBottom: 16, color: 'var(--muted)' }}>
            <Icon name="info" size={14} style={{ flexShrink: 0 }} />
            {t('sub.limit_info')}
          </Card>

          {/* Two columns */}
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
            {/* Колонка «Free» — та же поверхность, что и колонка Pro справа, поэтому
                тот же примитив: рамка/радиус/фон приезжают с <Card>, а не пишутся
                инлайном рядом с настоящей карточкой. */}
            <Card radius="btn" pad="none" style={{ padding: 16 }}>
              <div className="t-micro" style={{ color: 'var(--muted)', marginBottom: 12 }}>{t('sub.limit_now_free')}</div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 9 }}>
                {freeRows.map((r, i) => (
                  <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 8, color: r.ok ? 'var(--ink-2)' : 'var(--muted-2)' }}>
                    {r.ok ? <Icon name="check" size={14} style={{ color: 'var(--success)', flexShrink: 0 }} />
                          : <Icon name="close" size={14} style={{ color: 'var(--muted-2)', flexShrink: 0 }} />}
                    <span>{r.text}</span>
                  </div>
                ))}
              </div>
            </Card>
            {/* TRIP-343 объект 2 (H): скин-форма (радиус+рамка+фон) снята с инлайна на
                <Card>; Pro-тинт (--pro рамка / --pro-soft фон) остаётся остаточным
                инлайном — у Card нет тона "pro" (тоны brand/ai), а Pro-золото несёт
                данные колонки, как акцент вилки. Инлайн больше не surface-формы (радиус на Card). */}
            <Card radius="btn" pad="none" style={{ padding: 16, borderColor: 'var(--pro)', background: 'var(--pro-soft)' }}>
              <div className="t-micro" style={{ color: 'var(--pro-ink)', marginBottom: 12 }}>PRO</div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 9 }}>
                {proRows.map((node, i) => (
                  <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 8, color: 'var(--ink-2)' }}>
                    <Icon name="check" size={14} style={{ color: 'var(--success)', flexShrink: 0 }} />
                    <span>{node}</span>
                  </div>
                ))}
              </div>
            </Card>
          </div>

          <div className="t-meta" style={{ textAlign: 'center', color: 'var(--muted)', marginTop: 14 }}>
            {t('sub.limit_prices_next')}
          </div>
        </div>

        {/* Футер — канон `.dlg__foot`, а не инлайновый ряд внутри тела. Кнопки
            выезжают ИЗ прокручиваемой области: на низком экране они больше не
            уезжают под сгиб вместе с таблицей сравнения. Раскладку (в колонку и
            во всю ширину на телефоне) канон даёт сам. */}
        <div className="dlg__foot">
          <Btn variant="secondary" onClick={() => onOpenChange(false)}>{t('sub.not_now')}</Btn>
          <Btn variant="pro" icon="pro" onClick={openUpgrade}>{t('sub.see_plans')}</Btn>
        </div>
      </DialogContent>
    </Dialog>
  );
}
