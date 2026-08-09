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
// (Popover), а не число, поэтому центр это слот. Кнопки скоплены `.stepper >
// button`, чтобы кнопка-дата ВНУТРИ центра не считалась плюс/минусом.
//
// ★ БАЗА АННОТАЦИИ = `<div>`: туда уезжает остаток (`onPointerDown`/`onClick`
// гасят арминг драга у ночей в перетаскиваемой строке — без них степпер внутри
// строки арсенит перетаскивание). Закрыта СВОЯ ось: `variant="compact"` —
// ошибка типа.
export const Stepper = React.forwardRef(
  /**
   * @param {React.ComponentPropsWithoutRef<'div'> & {
   *   value?: React.ReactNode,
   *   onMinus?: React.MouseEventHandler<HTMLButtonElement>,
   *   onPlus?: React.MouseEventHandler<HTMLButtonElement>,
   *   minusDisabled?: boolean, plusDisabled?: boolean,
   *   minusLabel?: string, plusLabel?: string,
   *   variant?: 'pill'|'block'|'bare',
   * }} p
   */
  ({
    value, onMinus, onPlus, minusDisabled, plusDisabled,
    minusLabel, plusLabel, variant = "pill",
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
      <button type="button" onClick={onMinus} disabled={minusDisabled || undefined} aria-label={minusLabel}>
        <Icon name="minus" size={15} />
      </button>
      <span className="n">{children ?? value}</span>
      <button type="button" onClick={onPlus} disabled={plusDisabled || undefined} aria-label={plusLabel}>
        <Icon name="plus" size={15} />
      </button>
    </div>
  ),
);
Stepper.displayName = "Stepper";
