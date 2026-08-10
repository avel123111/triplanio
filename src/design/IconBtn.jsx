// @ts-check
import React from 'react';
import { Icon } from './icons';

// ----- IconBtn ----- (TRIP-344 PR 2, разбор облика кнопок — апрув Pavel)
// Кнопка БЕЗ подписи: содержимое — одна иконка. Схлопывает частные реализации
// одного объекта, рисовавшие его своими сторонами (24·26·28·30·34·38) и своими
// ховерами.
//
// ★ Нового имени НЕТ: `.icon-btn` уже канон-семья, и разбор облика называет
// каноном именно её. Меняется не имя, а то, что у неё появляются ОБЪЯВЛЕННЫЕ
// обличья, а частные копии умирают.
//
// ★ ЖИВЁТ СВОИМ МОДУЛЕМ, а не в барреле `design/index.jsx`, по той же причине,
// что поле (TRIP-333) и раскладка (TRIP-388): баррель реэкспортит
// `components/ui/*`, поэтому крестик тоста, взятый оттуда, замкнул бы кольцо
// `design/index → ui/toaster → design/index`. Экраны зовут кнопку через
// баррель — точка входа в ДС остаётся одна; напрямую отсюда импортирует только
// тот, кому кольцо иначе не разорвать.
//
// ★ ТРИ ОСИ, А НЕ ОДИН ПЛОСКИЙ СПИСОК. Разбор перечисляет варианты строкой
// (`quiet · soft · outline · solid · ai · danger · sm · round · fab`), но это
// значения ТРЁХ независимых осей, а не один набор: `.lp-back` — это soft И
// round одновременно, `.mapfs-close` — outline И round. Плоский юнион сделал бы
// такую пару невыразимой, и её пришлось бы дописывать классом мимо пропа —
// ровно то, что этот PR убирает. Набор классов на выходе тот же, что в разборе.
//
// `children` — для метки непрочитанных у колокольчика: она лежит ВНУТРИ кнопки
// и позиционируется от неё, поэтому это ребёнок, а не проп.
//
// ★ REF И ОСТАТОК ПРОПОВ — НЕ УКРАШЕНИЕ, А УСЛОВИЕ РАБОТОСПОСОБНОСТИ. Кнопка
// служит триггером Radix (`PopoverTrigger asChild` у колокольчика,
// `DropdownMenu.Trigger asChild` у меню строки): `asChild` КЛОНИРУЕТ ребёнка и
// вешает на него ref, `data-state`, `aria-haspopup` и свои обработчики. Без
// проброса меню просто НЕ ОТКРЫВАЕТСЯ, причём молча — React отдаст варнинг про
// ref, а потерянные обработчики не скажут ничего.
//
// ★ БАЗА АННОТАЦИИ = ТО, КУДА УЕЗЖАЕТ ОСТАТОК. Здесь остаток уезжает на
// `<button>`, значит носитель и обязан быть базой (урок ревью Codex, TRIP-388:
// один дефект дал четыре витка ровно потому, что правило копировалось ФОРМОЙ).
// Закрытым набор при этом не остаётся — и не должен: `data-state` от Radix
// законен. Закрыты СВОИ оси: `tone="compact"` — по-прежнему ошибка типа.
// ⚠️ Аннотация стоит НА ПАРАМЕТРЕ, а не перед `const`: у `forwardRef` функция —
// это АРГУМЕНТ, и JSDoc перед объявлением к ней не относится (TRIP-388: сделал
// иначе — ошибки остались на месте, а проба выглядела зелёной).
export const IconBtn = React.forwardRef(
  /**
   * @param {React.ComponentPropsWithoutRef<'button'> & {
   *   icon: string,
   *   ariaLabel: string,
   *   tone?: 'quiet'|'soft'|'outline'|'solid'|'ai'|'danger',
   *   size?: 'md'|'sm'|'fab',
   *   round?: boolean,
   *   ariaPressed?: boolean, ariaExpanded?: boolean,
   * }} p
   */
  ({
    icon, ariaLabel, tone = "quiet", size = "md", round,
    disabled, ariaPressed, ariaExpanded,
    className = "", children, ...rest
  }, ref) => (
    <button
      ref={ref}
      type="button"
      className={[
        "icon-btn",
        tone !== "quiet" && `icon-btn--${tone}`,
        size !== "md" && `icon-btn--${size}`,
        round && "icon-btn--round",
        className,
      ].filter(Boolean).join(" ")}
      disabled={disabled || undefined}
      aria-label={ariaLabel}
      aria-pressed={ariaPressed}
      aria-expanded={ariaExpanded}
      {...rest}
    >
      <Icon name={icon} size={size === "fab" ? 24 : size === "sm" ? 14 : 16} />
      {children}
    </button>
  ),
);
IconBtn.displayName = "IconBtn";
