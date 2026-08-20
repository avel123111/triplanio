// @ts-check
import React, { useState } from 'react';
import { IconBtn } from './IconBtn';

// ----- EditableText ----- (инлайн-правка текста, примитив ДС)
// Читается как текст с карандашом; клик по карандашу → БЕСШОВНЫЙ инлайн-инпут НА
// ТОМ ЖЕ МЕСТЕ (прозрачный, без рамки/фокус-бокса, наследует шрифт/размер/цвет из
// контекста — `font/letter-spacing/color: inherit`), так что правка выглядит как
// «текст стал редактируемым», а не «появился форменный бокс». Именно поэтому НЕ
// примитив `<Input>` (он боксовый: рамка+affix+кольцо) — для инлайн-правки чужая форма.
//
// ОБА состояния держат ОДНУ обёртку `.editable` (inline-flex) и ОДНУ иконку-кнопку
// справа: карандаш (просмотр) ⇄ галочка (правка). Это НЕ косметика — иконка задаёт
// высоту строки, и без неё в режиме правки ряд схлопывался, а привязанный к
// `bottom:0` заголовок на обложке прыгал вниз. Галочка = ВИДИМОЕ подтверждение
// (mobile-first: клавиатурный «Готово» на iOS после первого раза подменяется
// автокомплитом — тап по галочке фиксирует всегда). Enter/blur тоже фиксируют,
// Esc закрывает. `enterKeyHint=done` + `autoComplete=off` держат клавиатурный
// экшен «Готово», а не подсказки. Переиспользуемый: облик текста задаёт вызыватель
// (`textClassName`), правка едет живьём в `value` (контролируемый инпут).
/**
 * @param {{
 *   value: string,
 *   onChange: (v: string) => void,
 *   placeholder?: string,
 *   ariaLabel: string,
 *   editLabel: string,
 *   confirmLabel: string,
 *   className?: string,
 *   textClassName?: string,
 *   inputClassName?: string,
 * } & Record<string, any>} p
 */
export const EditableText = ({
  value, onChange, placeholder = "", ariaLabel, editLabel, confirmLabel,
  className = "", textClassName = "", inputClassName = "", ...rest
}) => {
  const [editing, setEditing] = useState(false);
  return (
    <span className={["editable", className].filter(Boolean).join(" ")}>
      {editing ? (
        <>
          <input
            className={["editable__input", inputClassName].filter(Boolean).join(" ")}
            value={value}
            onChange={(e) => onChange(e.target.value)}
            onBlur={() => setEditing(false)}
            onKeyDown={(e) => { if (e.key === 'Enter' || e.key === 'Escape') { e.preventDefault(); setEditing(false); } }}
            placeholder={placeholder}
            aria-label={ariaLabel}
            enterKeyHint="done"
            autoComplete="off"
            autoCapitalize="sentences"
            spellCheck={false}
            autoFocus
            {...rest}
          />
          {/* Галочка = подтверждение. `blur` (тап мимо) тоже фиксирует, поэтому даже
              если тап по галочке уводит фокус раньше её onClick — итог тот же (правка
              закрыта). preventDefault на mousedown держит фокус до клика на десктопе. */}
          <IconBtn
            icon="check" size="sm" ariaLabel={confirmLabel} className="editable__edit"
            onMouseDown={(e) => e.preventDefault()}
            onClick={() => setEditing(false)}
          />
        </>
      ) : (
        <>
          <span className={["editable__text", textClassName].filter(Boolean).join(" ")}>{value || placeholder}</span>
          <IconBtn icon="edit" size="sm" ariaLabel={editLabel} className="editable__edit" onClick={() => setEditing(true)} />
        </>
      )}
    </span>
  );
};
EditableText.displayName = "EditableText";
