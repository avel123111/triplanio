// @ts-check
import React from 'react';

// ----- Donut ----- (TRIP-413, объект «кольцевая диаграмма»)
// Чистый SVG-бублик по долям сегментов + необязательный центр (значение+подпись).
// `segments` = [{ id, color, value }]. Наведённый сегмент толстеет, остальные
// гаснут (dim через data-атрибут, синхронно с легендой снаружи через hoveredId).
//
// ★ ЗАЧЕМ. Кольцо — единственная своя геометрия Бюджета, но виз переиспользуем:
// объявлен ОДИН раз в ДС, на витрине. Форматирование центра (деньги/compact) —
// НЕ здесь: центр приходит готовым узлом `center`, семья остаётся общей.
//
// ★ ЦЕНТР ЗАПЕРТ внутри дырки (`.donut__c { inset }`), а не поверх кольца —
// поэтому крупное значение не заезжает на дугу (баг старого bgt-donut на 168px).
export const Donut = React.forwardRef(
  /**
   * @param {{
   *   segments?: Array<{ id: string, color: string, value: number }>,
   *   total?: number, center?: any, label?: any,
   *   hoveredId?: string|null, onHover?: (id: string|null) => void,
   *   thickness?: number, className?: string,
   * } & Record<string, any>} p
   */
  ({ segments = [], total = 0, center, label, hoveredId, onHover, thickness = 10, className = "", ...rest }, ref) => {
    const R = 40;
    const C = 2 * Math.PI * R;
    let acc = 0;
    const arcs = segments.map((s) => {
      const frac = total > 0 ? s.value / total : 0;
      const arc = frac * C;
      const out = { ...s, arc, offset: -acc };
      acc += arc;
      return out;
    });
    return (
      <div ref={ref} className={["donut", className].filter(Boolean).join(" ")} {...rest}>
        <svg viewBox="0 0 100 100" aria-hidden="true">
          <circle cx="50" cy="50" r={R} fill="none" stroke="var(--surface-2)" strokeWidth={thickness - 2} />
          {total > 0 && arcs.map((s) => (
            <circle
              key={s.id}
              className="donut__seg"
              data-dim={hoveredId && hoveredId !== s.id ? "true" : undefined}
              cx="50" cy="50" r={R} fill="none"
              stroke={s.color}
              strokeWidth={hoveredId === s.id ? thickness + 3 : thickness}
              strokeDasharray={`${s.arc} ${C - s.arc}`}
              strokeDashoffset={s.offset}
              onMouseEnter={onHover ? () => onHover(s.id) : undefined}
              onMouseLeave={onHover ? () => onHover(null) : undefined}
            />
          ))}
        </svg>
        {(center != null || label != null) && (
          <div className="donut__c">
            {center != null && <span className="t-title">{center}</span>}
            {label != null && <span className="t-meta muted">{label}</span>}
          </div>
        )}
      </div>
    );
  },
);
Donut.displayName = "Donut";
