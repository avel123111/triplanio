// @ts-check
import React from 'react';

// ----- Meter ----- (объект «полоса-доля»)
// Дорожка + сегменты, растянутые `flex-grow` по своим долям. Бывший `.bud-bar`
// виджета бюджета, вынесенный в ДС: вторым читателем стала «Подготовка».
// Доля и цвет приходят из данных, поэтому стиль сегмента — функцией, не литералом.

/** @typedef {{ key: string, value: number, color?: string, title?: string }} MeterSegment */

/** @param {MeterSegment} s */
const segStyle = (s) => ({
  flexGrow: s.value,
  // Ненулевая доля обязана быть видной: без пола сегмент в 0.3% схлопывается.
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
