import React from 'react';
import { Stepper, Tooltip } from '@/design/index';
import { useT } from '@/lib/i18n/I18nContext';

// ─── NightsStepper ────────────────────────────────────────────────────────────
// Nights +/- for the planner route list and the structural editor grid. Thin
// wrapper over the DS <Stepper> that owns the trip-specific bits: the "Nн" value
// suffix and stopping pointerdown/click so using the stepper inside a draggable /
// clickable row never arms a drag or opens the city panel.
//
// Подсказка — <Tooltip> из ДС, а не браузерный `title`: у браузерного нет ни
// облика системы, ни задержки, ни поведения на фокусе, и на телефоне он не
// показывается вовсе.
//
// ⚠️ АННОТАЦИЯ ОБЯЗАТЕЛЬНА (TRIP-388): без неё TS выводит тип из ДЕСТРУКТУРИЗАЦИИ
// и делает `title` ОБЯЗАТЕЛЬНЫМ. Набор ЗАКРЫТЫЙ, `...rest` тут нет.
/**
 * `readOnly` — наблюдатель на «Маршруте» (TRIP-459): ночи только показываются.
 * Гашение событий при этом СНИМАЕТСЯ, и это не мелочь: `stop` стоит здесь ради
 * драга и открытия панели города, то есть гасит ЧУЖИЕ жесты ради своего
 * контрола. Контрола нет — гасить нечего, а оставленный `stop` превратил бы
 * число в мёртвую зону посреди кликабельного ряда.
 *
 * `className` уходит на ТРИГГЕР тултипа, а не на степпер, и это несущее: в ряду
 * маршрута элементом сетки является именно триггер (`<Tooltip>` оборачивает
 * контрол), поэтому ячейку колонки объявлять нужно на нём. Обёртки-«ещё один
 * div» это не требует — лишний узел ничего бы не держал.
 *
 * @param {{ value: any, onMinus: any, onPlus: any,
 *           minusDisabled?: boolean, plusDisabled?: boolean, title?: string,
 *           readOnly?: boolean, variant?: 'pill'|'block'|'bare', className?: string }} p
 */
export default function NightsStepper({ value, onMinus, onPlus, minusDisabled = false, plusDisabled = false, title, readOnly = false, variant, className }) {
  const t = useT();
  const stop = (e) => e.stopPropagation();
  // Предмет числа у наблюдателя несёт ТОЛЬКО подпись колонки, а на телефоне
  // колонок нет вовсе (`showCols=false`) — там «3н» осталось бы без предмета.
  // У правящего имя дают aria-подписи кнопок ±; снимая кнопки, возвращаем то же
  // имя текстом для читалки (`.sr-only` — утилита репозитория).
  const srName = readOnly ? <span className="sr-only"> {title || t('tse.col_nights')}</span> : null;
  return (
    <Tooltip content={title || t('tse.col_nights')} className={className}>
      <Stepper
        variant={variant}
        readOnly={readOnly}
        value={<>{value}<span className="muted">{t('planner.night_short')}</span>{srName}</>}
        onMinus={onMinus} minusDisabled={minusDisabled} minusLabel={t('planner.fewer_nights')}
        onPlus={onPlus} plusDisabled={plusDisabled} plusLabel={t('planner.more_nights')}
        onPointerDown={readOnly ? undefined : stop} onClick={readOnly ? undefined : stop}
      />
    </Tooltip>
  );
}
