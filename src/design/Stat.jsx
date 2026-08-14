// @ts-check
import React from 'react';
import { Tile } from './Tile';

// ----- Stat ----- (TRIP-413, объект «плитка-показатель», KPI)
// Карточка-показатель: цветная иконка-плитка + подпись + крупное значение +
// строка снизу. Опционально кликабельная (носитель <button>). Тон красит иконку.
//
// ★ ЗАЧЕМ. Плитка показателя рисовалась приватно (bgt-stat …) на каждом экране;
// один объект — своё имя. Здесь он один; тон/клик — оси, не новые имена.
//
// ★ ТОН красит ИКОНКУ через союз тонов плитки (`<Tile tone>`): событийные цвета
// (`--ev-*`) с TRIP-350 живут на `.tile--<tone>` (hotel/activity/transfer), поэтому
// scoped-правило `.stat--<tone> .tile` больше не нужно — тон едет прямо в плитку.
//
// ★ ПОДПИСИ — канон текста (`.t-label`/`.t-meta` + утилита `.muted`), не свои
// классы: своё у stat только раскладка и тон.
/** @typedef {'brand'|'activity'|'transfer'} StatTone */
export const Stat = React.forwardRef(
  /**
   * @param {{
   *   icon?: string, tone?: StatTone, label?: any, value?: any, sub?: any,
   *   onClick?: any, className?: string, children?: any,
   * } & Record<string, any>} p
   */
  ({ icon, tone, label, value, sub, onClick, className = "", children, ...rest }, ref) => {
    const clickable = !!onClick;
    const El = /** @type {any} */ (clickable ? "button" : "div");
    return (
      <El
        ref={ref}
        type={clickable ? "button" : undefined}
        onClick={onClick}
        className={[
          "card", "stat",
          clickable && "stat--clickable",
          className,
        ].filter(Boolean).join(" ")}
        {...rest}
      >
        <Tile size="xl" tone={tone} icon={icon} />
        <div className="stat__body">
          {label != null && <div className="t-label muted">{label}</div>}
          {value != null && <div className="t-title">{value}</div>}
          {(sub != null || children) && <div className="t-meta muted">{sub ?? children}</div>}
        </div>
      </El>
    );
  },
);
Stat.displayName = "Stat";

/** @type {readonly StatTone[]} */
export const STAT_TONES = ["brand", "activity", "transfer"];
