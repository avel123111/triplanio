// @ts-check
import React from 'react';
import { Icon } from './icons';

// ----- Chip ----- (TRIP-344 PR 7, разбор облика кликабельных пилюль — апрув Pavel)
// Кликабельная пилюля: фильтр «Входящих», пагинация форк-панели, швы редактора
// маршрута, «Новые сообщения», «Участники», «+N ещё» календаря. Схлопывает
// ~десять частных реализаций одного объекта (`.te-seam__pill`(--add) ·
// `.te-actchip` · `.te-hotelicon` · `.chat-jump` · `.chat-members-btn` ·
// `.ncal-more` · `.fork-pg`(--on)), рисовавших пилюлю своими подложками, своими
// размерами и своими состояниями (`.on` / `.is-on` / `.fork-pg--on`).
//
// ★ Нового имени НЕТ: `.fpill` уже канон-семья (фильтр «Входящих»), разбор
// называет каноном её — как `Seg` обернул `.seg`, а `Stepper` — `.stepper`.
// Все перечисленные копии УДАЛЯЮТСЯ, их разметка переезжает сюда.
//
// ★ СОСТОЯНИЕ = ДАННЫЕ. Активная пилюля (выбранный фильтр, текущая страница)
// помечается `aria-pressed`, а не классом `.on`/`.is-on`: `aria-pressed` читает
// скринридер, класс — нет, и правило `.fpill[aria-pressed="true"]` красит её сам.
// `on` — необязателен: пилюля-действие (шов «добавить переезд», «Участники»,
// «Новые сообщения») переключателем не является и `aria-pressed` не несёт.
//
// ★ ЖИВЁТ СВОИМ МОДУЛЕМ (как `IconBtn`/`Stepper`/`Seg`): точка входа в ДС одна
// (баррель), а сам примитив из `components/ui/*` ничего не тянет и кольца не
// замыкает.
//
// ★ ОСИ НЕЗАВИСИМЫ (как у `IconBtn` tone×size×round). `variant` — ЗАЛИВКА
// (`neutral` фильтр · `tone` тип брони, канал `--evs/--evi/--ev` с оболочки ·
// `placeholder` пустой шов, пунктир · `soft` мягкий тон бренда). `square`
// (радиус ячейки + квадратный минимум), `sm` (мелкая ступень), `avatars`
// (стопка аватаров, высота от содержимого) — ОРТОГОНАЛЬНЫЕ модификаторы,
// комбинируются свободно (`.ncal-more` = `soft·sm·square`, `.te-actchip` =
// `tone·square`). Плоским юнионом такие пары не выразить.
//
// ★ ТОН ИЗ КОНТЕКСТА — НЕ проп. `tone`/`placeholder` читают `--evs/--evi/--ev`,
// которые оболочка шва ставит инлайном по типу брони (`--ev-transfer-*` и т.д.),
// — ровно как активный сегмент `Seg` читает `--hl*`.
//
// ★ БАЗА АННОТАЦИИ = `<button>`: туда уезжает остаток (`onClick`, `title`,
// `disabled`, `aria-current`, `data-*`). `variant` — закрытая ось; неверное
// значение (`ghost`) — ошибка типа, а не красный CI.
export const Chip = React.forwardRef(
  /**
   * @param {Omit<React.ComponentPropsWithoutRef<'button'>, 'aria-pressed'> & {
   *   variant?: 'neutral'|'tone'|'placeholder'|'soft',
   *   square?: boolean,
   *   sm?: boolean,
   *   avatars?: boolean,
   *   on?: boolean,
   *   icon?: string,
   *   iconRight?: string,
   *   count?: React.ReactNode,
   * }} p
   */
  ({ variant = "neutral", square, sm, avatars, on, icon, iconRight, count, children, className = "", type = "button", ...rest }, ref) => (
    <button
      ref={ref}
      type={type}
      aria-pressed={on === undefined ? undefined : on}
      className={[
        "fpill",
        variant !== "neutral" && `fpill--${variant}`,
        square && "fpill--square",
        sm && "fpill--sm",
        avatars && "fpill--avatars",
        className,
      ].filter(Boolean).join(" ")}
      {...rest}
    >
      {icon && <Icon name={icon} size={sm ? 12 : 14} />}
      {children}
      {count !== undefined && count !== null && <span className="fpill__c">{count}</span>}
      {iconRight && <Icon name={iconRight} size={sm ? 12 : 14} />}
    </button>
  ),
);
Chip.displayName = "Chip";
