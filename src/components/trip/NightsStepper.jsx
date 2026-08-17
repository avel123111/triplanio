import React from 'react';
import { Stepper } from '@/design/index';
import { useT } from '@/lib/i18n/I18nContext';

// ─── NightsStepper ────────────────────────────────────────────────────────────
// Nights +/- for the planner route list and the structural editor grid. Thin
// wrapper over the DS <Stepper> that owns the trip-specific bits: the "Nн" value
// suffix and stopping pointerdown/click so using the stepper inside a draggable /
// clickable row never arms a drag or opens the city panel.
//
// ⚠️ АННОТАЦИЯ ОБЯЗАТЕЛЬНА (TRIP-388): без неё TS выводит тип из ДЕСТРУКТУРИЗАЦИИ
// и делает `title` ОБЯЗАТЕЛЬНЫМ. Набор ЗАКРЫТЫЙ, `...rest` тут нет.
/**
 * @param {{ value: any, onMinus: any, onPlus: any,
 *           minusDisabled?: boolean, plusDisabled?: boolean, title?: string,
 *           variant?: 'pill'|'block'|'bare' }} p
 */
export default function NightsStepper({ value, onMinus, onPlus, minusDisabled = false, plusDisabled = false, title, variant }) {
  const t = useT();
  const stop = (e) => e.stopPropagation();
  return (
    <Stepper
      variant={variant}
      value={<>{value}<span className="muted">{t('planner.night_short')}</span></>}
      onMinus={onMinus} minusDisabled={minusDisabled} minusLabel={t('planner.fewer_nights')}
      onPlus={onPlus} plusDisabled={plusDisabled} plusLabel={t('planner.more_nights')}
      title={title || t('tse.col_nights')}
      onPointerDown={stop} onClick={stop}
    />
  );
}
