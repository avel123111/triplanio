// @ts-check
import React from 'react';

// ----- Meter ----- (объект «полоса-доля»)
// Горизонтальная полоса, поделённая на сегменты по их ДОЛЯМ: дорожка (фон)
// плюс сегменты, растягиваемые `flex-grow`. Никакой семантики про деньги или
// проценты — только геометрия доли.
//
// ★ НОВОГО ОБЪЕКТА НЕТ — ПЕРЕЕЗД СУЩЕСТВУЮЩЕГО: полоса была написана как
// `.bud-bar` в бюджете, «Подготовке» нужна ТА ЖЕ. `.bud-bar` удалён, объявления
// переехали байт-в-байт (`visual-diff-move` в `app.css`), внешние отступы —
// дефолтом класса, иначе они уезжают в инлайн на каждом вызове.
//
// Стиль сегмента собирается функцией: цвет и доля приходят ИЗ ДАННЫХ, классом
// их не выразить, а литерал в JSX — тот самый инлайн, который считает гард 2l.

/** @typedef {{ key: string, value: number, color?: string, title?: string }} MeterSegment */

/** @param {MeterSegment} s */
const segStyle = (s) => ({
  flexGrow: s.value,
  // Ненулевая доля обязана быть ВИДНОЙ: без пола сегмент в 0.3% схлопывается в
  // ничто и полоса врёт «этого нет вовсе».
  minWidth: s.value > 0 ? 4 : 0,
  background: s.color,
});

export const Meter = React.forwardRef(
  /**
   * @param {{
   *   segments?: MeterSegment[],
   *   ariaLabel?: string,
   *   className?: string,
   * }} p
   */
  ({ segments = [], ariaLabel, className = '' }, ref) => (
    <div
      ref={ref}
      className={['meter', className].filter(Boolean).join(' ')}
      role={ariaLabel ? 'img' : 'presentation'}
      aria-label={ariaLabel || undefined}
    >
      {segments.map((s) => (
        <i key={s.key} className="meter__seg" title={s.title} style={segStyle(s)} />
      ))}
    </div>
  ),
);
Meter.displayName = 'Meter';
