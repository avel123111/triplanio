// @ts-check
import React from 'react';
import { Icon } from './icons';

// ----- Swatch ----- (TRIP-344, разбор облика кнопок — апрув Pavel)
// Плитка выбора: цвет категории бюджета, иконка категории бюджета, обложка
// трипа. Схлопывает три частные реализации одного объекта, рисовавшие плитку
// своими размерами, своими рамками и своими способами показать «выбрано»:
//   · `.bgt-swatch` (цвет, 30px, рамка 2.5px, ховер scale(1.1)) ·
//   · `.bgt-iconpick button` (иконка, 40px, тон категории инлайном) ·
//   · `.tcp__sw` (обложка, 40px круг, галочка-оверлей, ховер scale(1.05)).
//
// ★ СОСТОЯНИЕ = ДАННЫЕ. «Выбрано» помечается `aria-pressed`, а не классом
// `.on`/`.is-active`: атрибут читает скринридер, класс — нет, и правило
// `.swatch[aria-pressed="true"]` красит рамкой сам. Галочка-оверлей у обложки
// снята — выбор виден рамкой `--ink` + внутренним кольцом, как у цвета.
//
// ★ ТОН ИЗ КОНТЕКСТА — НЕ проп. `icon`-плитка в выбранном состоянии красится
// каналом `--sw` (умолчание — бренд): оболочка передаёт его через `tint`,
// поэтому иконка категории сохраняет ПРЕВЬЮ выбранного цвета — ровно как Chip
// читает `--hl`, а активный сегмент `Seg` — тон с оболочки.
//
// ★ ЖИВЁТ СВОИМ МОДУЛЕМ (как `IconBtn`/`Stepper`/`Seg`/`Chip`): точка входа в ДС
// одна (баррель), а сам примитив из `components/ui/*` ничего не тянет.
//
// ★ БАЗА АННОТАЦИИ = `<button>`: туда уезжает остаток (`onClick`, `title`,
// `style` с фоном-цветом/градиентом, `aria-label`, `data-*`). `variant` —
// закрытая ось из трёх (`color` цвет · `icon` иконка · `round` круглая
// обложка); неверное значение — ошибка типа, а не красный CI.
/** @typedef {'color'|'icon'|'round'} SwatchVariant */
export const Swatch = React.forwardRef(
  /**
   * @param {Omit<React.ComponentPropsWithoutRef<'button'>, 'aria-pressed'> & {
   *   variant?: SwatchVariant,
   *   on?: boolean,
   *   icon?: string,
   *   tint?: string,
   * }} p
   */
  ({ variant = "color", on, icon, tint, children, className = "", type = "button", style, ...rest }, ref) => (
    <button
      ref={ref}
      type={type}
      aria-pressed={on === undefined ? undefined : on}
      className={[
        "swatch",
        variant === "icon" && "swatch--icon",
        variant === "round" && "swatch--round",
        className,
      ].filter(Boolean).join(" ")}
      style={tint ? { "--sw": tint, ...style } : style}
      {...rest}
    >
      {icon && <Icon name={icon} size={16} />}
      {children}
    </button>
  ),
);
Swatch.displayName = "Swatch";

// ── Карта оси `variant` — источник витрины `/kit` (TRIP-344). Тот же union,
// что типизирует проп: `variant="compact"` — ошибка типа. Дефолт `color` в
// карту не входит (база без класса-модификатора).
/** @type {readonly SwatchVariant[]} */
export const SWATCH_VARIANTS = ["icon", "round"];
