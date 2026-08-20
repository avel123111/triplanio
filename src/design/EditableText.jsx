// @ts-check
import React, { useState } from 'react';
import { IconBtn } from './IconBtn';

// ----- EditableText ----- (инлайн-правка текста, примитив ДС)
// Читается как текст с карандашом; клик по карандашу → БЕСШОВНЫЙ инлайн-инпут НА
// ТОМ ЖЕ МЕСТЕ (прозрачный, без рамки/фокус-бокса, наследует шрифт и цвет из
// контекста — `font/color: inherit`), так что правка выглядит как «текст стал
// редактируемым», а не «появился форменный бокс». Именно поэтому НЕ примитив
// `<Input>` (он боксовый: рамка+affix+кольцо) — для инлайн-правки это чужая форма.
// Enter/blur фиксируют, Esc закрывает. Переиспользуемый: не знает про обложку/трип
// — вызыватель даёт value/onChange/placeholder и классы облика текста
// (`textClassName`). Правка едет живьём в `value` (контролируемый инпут).
/**
 * @param {{
 *   value: string,
 *   onChange: (v: string) => void,
 *   placeholder?: string,
 *   ariaLabel: string,
 *   editLabel: string,
 *   className?: string,
 *   textClassName?: string,
 *   inputClassName?: string,
 * } & Record<string, any>} p
 */
export const EditableText = ({
  value, onChange, placeholder = "", ariaLabel, editLabel,
  className = "", textClassName = "", inputClassName = "", ...rest
}) => {
  const [editing, setEditing] = useState(false);
  if (editing) {
    return (
      <input
        className={["editable__input", inputClassName].filter(Boolean).join(" ")}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        onBlur={() => setEditing(false)}
        onKeyDown={(e) => { if (e.key === 'Enter' || e.key === 'Escape') { e.preventDefault(); setEditing(false); } }}
        placeholder={placeholder}
        aria-label={ariaLabel}
        autoFocus
        {...rest}
      />
    );
  }
  return (
    <span className={["editable", className].filter(Boolean).join(" ")}>
      <span className={["editable__text", textClassName].filter(Boolean).join(" ")}>{value || placeholder}</span>
      <IconBtn icon="edit" size="sm" ariaLabel={editLabel} className="editable__edit" onClick={() => setEditing(true)} />
    </span>
  );
};
EditableText.displayName = "EditableText";
