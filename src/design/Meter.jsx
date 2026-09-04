// @ts-check
import React from 'react';

// ----- Meter ----- (объект «полоса-доля»)
// Горизонтальная полоса, поделённая на сегменты по их ДОЛЯМ: дорожка (фон)
// плюс сегменты, растягиваемые `flex-grow`. Никакой семантики про деньги или
// проценты — только геометрия доли.
//
// ★ НОВОГО ОБЪЕКТА НЕТ — ЕСТЬ ПЕРЕЕЗД СУЩЕСТВУЮЩЕГО. Полоса уже была написана
// как `.bud-bar` (виджет бюджета): дорожка `--surface-2`, пилюля, `display:flex`,
// дети `<i>` с `flex-grow`. Виджету «Подготовка» нужна ТА ЖЕ полоса, и второй
// экземпляр под своим именем — ровно тот «стилевой зоопарк», против которого
// стоит правило #6. Поэтому `.bud-bar` УДАЛЁН, а его объявления (все до одного,
// включая внешние отступы) переехали на `.meter` байт-в-байт — см. пометки
// `visual-diff-move` в `app.css`.
//
// ★ ОТСТУПЫ — ДЕФОЛТ КЛАССА, А НЕ ЗАБОТА ВЫЗЫВАТЕЛЯ. `.bud-bar` нёс
// `margin: 12px 0 14px`, и это единственное значение, которое полоса когда-либо
// имела. Канон CLAUDE.md для такого случая прямой: отдать классу господствующее
// значение ДЕФОЛТОМ, а исключения пусть переопределяют — иначе отступ уезжает в
// инлайн на каждом вызове.
//
// ★ СТИЛЬ СЕГМЕНТА СОБИРАЕТСЯ ФУНКЦИЕЙ, а не литералом в JSX: цвет и доля
// приходят ИЗ ДАННЫХ (категория бюджета, доля готовности), классом их не
// выразить. Именованный объект — и есть та «общая вещь», которую требует гард 2l.

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
   * } & Record<string, any>} p
   */
  ({ segments = [], ariaLabel, className = '', ...rest }, ref) => (
    <div
      ref={ref}
      className={['meter', className].filter(Boolean).join(' ')}
      role={ariaLabel ? 'img' : 'presentation'}
      aria-label={ariaLabel || undefined}
      {...rest}
    >
      {segments.map((s) => (
        <i key={s.key} className="meter__seg" title={s.title} style={segStyle(s)} />
      ))}
    </div>
  ),
);
Meter.displayName = 'Meter';
