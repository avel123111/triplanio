// @ts-check
import React from 'react';

// ----- Seg ----- (TRIP-344 PR 6, разбор облика сегмент-контролов — апрув Pavel)
// Сегментированный переключатель «одно из нескольких». Схлопывает четыре
// частные реализации одного объекта (`.seg` · `.seg--fill` · `.tweaks__seg` ·
// `.ncal-vtgl`/`.ncal-vtgl-btn`), рисовавшие его своими подложками и своими
// состояниями (`.active` / `.is-on`).
//
// ★ Нового имени НЕТ: `.seg` уже канон-семья, разбор называет каноном её —
// как `Stepper` обернул `.stepper`. `.tweaks__seg` и `.ncal-vtgl-btn` — копии,
// они УДАЛЯЮТСЯ, разметка переезжает сюда.
//
// ★ СОСТОЯНИЕ = ДАННЫЕ. Активный сегмент помечается `aria-pressed`, а не
// классом `.active`/`.is-on`: `aria-pressed` читает скринридер, класс — нет.
// Выбор приходит пропом `value`, набор кнопок — пропом `options` (данные, не
// разметка), поэтому экран не может завести пятый способ рисовать состояние.
//
// ★ ЖИВЁТ СВОИМ МОДУЛЕМ, а не в барреле, — так же, как `IconBtn`, `Stepper` и
// поле: точка входа в ДС одна (баррель), а сам примитив ничего из
// `components/ui/*` не тянет и кольцо зависимостей не замыкает.
//
// ★ ТОН ИЗ КОНТЕКСТА — НЕ отдельный вариант. Панели/диалоги события ставят на
// оболочку инлайновый канал `--hl*` (тип события), а активный сегмент читает
// `--hl-soft`/`--hl-ink` (правило `.seg button[aria-pressed="true"]` в app.css).
// Seg внутри такой оболочки окрашивается сам — здесь для этого ничего не нужно.
//
// ★ БАЗА АННОТАЦИИ = `<div>`: туда уезжает остаток (`style`, `title`, `role`,
// `data-*`). `variant` — закрытая ось (`auto`|`fill`); `fill` растягивает
// сегменты на всю ширину строки поровну. `compact` — ошибка типа.
export const Seg = React.forwardRef(
  /**
   * @param {Omit<React.ComponentPropsWithoutRef<'div'>, 'onChange'> & {
   *   options: { value: string, label: React.ReactNode, ariaLabel?: string, title?: string, disabled?: boolean }[],
   *   value: string,
   *   onChange: (value: string) => void,
   *   variant?: 'auto'|'fill',
   *   ariaLabel?: string,
   * }} p
   */
  ({ options, value, onChange, variant = "auto", ariaLabel, className = "", ...rest }, ref) => (
    <div
      ref={ref}
      role="group"
      aria-label={ariaLabel}
      className={[
        "seg",
        variant === "fill" && "seg--fill",
        className,
      ].filter(Boolean).join(" ")}
      {...rest}
    >
      {options.map((o) => (
        <button
          key={o.value}
          type="button"
          aria-pressed={value === o.value}
          onClick={() => onChange(o.value)}
          aria-label={o.ariaLabel}
          title={o.title}
          disabled={o.disabled || undefined}
        >
          {o.label}
        </button>
      ))}
    </div>
  ),
);
Seg.displayName = "Seg";
