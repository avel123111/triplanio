import React from 'react';
import { Icon } from '../../design/icons';
import { useT } from '@/lib/i18n/I18nContext';

// ─── NightsStepper ────────────────────────────────────────────────────────────
// Shared nights +/- stepper used by both the planner route list and the
// structural editor grid. Was duplicated inline in two places with the same
// `.te-stepper / .te-step / .te-nights` markup; unified here so one control
// drives both screens. Stops pointerdown + click so using the stepper inside a
// draggable / clickable row never arms a drag or opens the city panel.
//
// Props: value, onMinus, onPlus, minusDisabled, plusDisabled, title.
//
// ⚠️ АННОТАЦИЯ ОБЯЗАТЕЛЬНА (TRIP-388): без неё TS выводит тип из ДЕСТРУКТУРИЗАЦИИ
// и делает `title` ОБЯЗАТЕЛЬНЫМ только потому, что у него нет дефолта в сигнатуре.
// Набор ЗАКРЫТЫЙ: остаток пропов никуда не уезжает, `...rest` тут нет.
// `title?` проверен УСТРОЙСТВОМ КОДА - у него есть фолбэк `title || t('tse.col_nights')`,
// то есть без него контрол действительно работает. Остальные три обязательны:
// `value` рендерится безусловно, `onMinus`/`onPlus` - единственное действие кнопок.
/**
 * @param {{ value: any, onMinus: any, onPlus: any,
 *           minusDisabled?: boolean, plusDisabled?: boolean, title?: string }} p
 */
export default function NightsStepper({ value, onMinus, onPlus, minusDisabled = false, plusDisabled = false, title }) {
  const t = useT();
  const stop = (e) => e.stopPropagation();
  return (
    <span className="row row--inline te-stepper" onPointerDown={stop} onClick={stop} title={title || t('tse.col_nights')}>
      <button className="te-step" onClick={onMinus} disabled={minusDisabled} aria-label={t('planner.fewer_nights')}>
        <Icon name="minus" size={12} />
      </button>
      <span className="num te-nights">{value}<span className="muted">{t('planner.night_short')}</span></span>
      <button className="te-step" onClick={onPlus} disabled={plusDisabled} aria-label={t('planner.more_nights')}>
        <Icon name="plus" size={10} />
      </button>
    </span>
  );
}
