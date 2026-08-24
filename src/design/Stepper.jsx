// @ts-check
import React from 'react';
import { Icon } from './icons';

// ----- Stepper ----- (TRIP-344 PR 5, разбор облика степперов — апрув Pavel)
// Контрол «− N +». Схлопывает четыре частные реализации одного объекта
// (`.stepper` · `.te-stepper`/`.te-step` · `.ts-startctl` · `.s22f-step`),
// рисовавшие его своими сторонами (26·30) и своими подложками.
//
// ★ Нового имени НЕТ: `.stepper` уже канон-семья, разбор называет каноном её.
// `pill` — дефолт (панель города, ночи). `block` — во всю ширину ячейки под
// `--ctl-h`, центр несёт ДАТУ (шапка «Маршрут»). `bare` — без подложки,
// встроен в карточку-инпут (гости).
//
// ★ ЖИВЁТ СВОИМ МОДУЛЕМ, а не в барреле, по той же причине, что `IconBtn` и
// поле: баррель реэкспортит `components/ui/*`, и взятый оттуда крестик замкнул
// бы кольцо. Экраны зовут степпер через баррель.
//
// ★ ЦЕНТР — `children`. `block` держит между кнопками интерактивную дату
// (Popover), а не число, поэтому центр это слот. Кнопка-дата — тоже button, её
// вид перебивает адресное `.stepper .ts-startctl__date` в app.css.
//
// ★ БАЗА АННОТАЦИИ = `<div>`: туда уезжает остаток (`onPointerDown`/`onClick`
// гасят арминг драга у ночей в перетаскиваемой строке — без них степпер внутри
// строки арсенит перетаскивание). Закрыта СВОЯ ось: `variant="compact"` —
// ошибка типа.
//
// ★ `readOnly` — ЗНАЧЕНИЕ БЕЗ КОНТРОЛА, а не выключенные кнопки (TRIP-459).
// Наблюдателю на «Маршруте» ночи и дата старта только ПОКАЗЫВАЮТСЯ, и просьба
// была буквальная: «только цифра». Disabled-кнопки этого не дают — они всё ещё
// рисуют контрол и обещают, что он когда-то нажмётся.
//
// Кнопки не рендерятся вовсе, а корень и `.n` остаются: `.n` несёт
// `min-width:40px; text-align:center`, и без него число уехало бы влево в своей
// колонке и разошлось бы с центрованной шапкой «Ночи». На `bare` (ряд маршрута)
// корень прозрачный и без падинга — на экране остаётся ровно цифра.
//
// НОВОГО ИМЕНИ НЕТ намеренно: это состояние того же объекта, класса
// `.stepper--readonly` не заводится, CSS не трогается, ось `variant` не растёт.
/** @typedef {'pill'|'block'|'bare'} StepperVariant */
export const Stepper = React.forwardRef(
  /**
   * @param {React.ComponentPropsWithoutRef<'div'> & {
   *   value?: React.ReactNode,
   *   onMinus?: React.MouseEventHandler<HTMLButtonElement>,
   *   onPlus?: React.MouseEventHandler<HTMLButtonElement>,
   *   minusDisabled?: boolean, plusDisabled?: boolean,
   *   minusLabel?: string, plusLabel?: string,
   *   variant?: StepperVariant, readOnly?: boolean,
   * }} p
   */
  ({
    value, onMinus, onPlus, minusDisabled, plusDisabled,
    minusLabel, plusLabel, variant = "pill", readOnly = false,
    className = "", children, ...rest
  }, ref) => (
    <div
      ref={ref}
      className={[
        "stepper",
        variant !== "pill" && `stepper--${variant}`,
        className,
      ].filter(Boolean).join(" ")}
      {...rest}
    >
      {readOnly ? null : (
        <button type="button" onClick={onMinus} disabled={minusDisabled || undefined} aria-label={minusLabel}>
          <Icon name="minus" size={15} />
        </button>
      )}
      <span className="n">{children ?? value}</span>
      {readOnly ? null : (
        <button type="button" onClick={onPlus} disabled={plusDisabled || undefined} aria-label={plusLabel}>
          <Icon name="plus" size={15} />
        </button>
      )}
    </div>
  ),
);
Stepper.displayName = "Stepper";

// ── Карта оси `variant` — источник витрины `/kit` (TRIP-344). Тот же union,
// что типизирует проп: `variant="compact"` — ошибка типа. Дефолт `pill` в
// карту не входит (база без класса).
/** @type {readonly StepperVariant[]} */
export const STEPPER_VARIANTS = ["block", "bare"];
