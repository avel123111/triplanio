// @ts-check
import React, { useState, useRef, useId, useCallback } from 'react';
import { createPortal } from 'react-dom';

// ----- Tooltip ----- (TRIP-274 Ф2.2 — глобальный текст-хинт на ховере/фокусе)
// Обёртка вокруг триггера: показывает короткий текст при наведении/фокусе.
// БЕЗ новой зависимости. Пузырь рендерится ПОРТАЛОМ в <body> и позиционируется
// по `getBoundingClientRect` триггера (position: fixed) — поэтому НЕ клипается
// `overflow:hidden`-контейнерами (диалог/карточка), как клипался absolute-вариант.
// Переиспользуемый: «замок» недоступного действия у наблюдателя (`<Btn locked>`),
// дальше — названия стран на карте и т.п.
//
// Доступность: пузырь `role="tooltip"` со своим id, триггер ссылается
// `aria-describedby`, пока показан. Пустой `content` → только дети.
/**
 * @param {{
 *   content?: any,
 *   side?: 'top'|'bottom',
 *   block?: boolean,
 *   children?: any,
 *   className?: string,
 * }} p
 */
export const Tooltip = ({ content, side = 'top', block = false, children, className = '' }) => {
  const id = useId();
  const ref = useRef(/** @type {HTMLSpanElement|null} */(null));
  const [pos, setPos] = useState(/** @type {{top:number,left:number}|null} */(null));

  const show = useCallback(() => {
    const el = ref.current;
    if (!el) return;
    const r = el.getBoundingClientRect();
    setPos({
      top: side === 'bottom' ? r.bottom + 8 : r.top - 8,
      left: r.left + r.width / 2,
    });
  }, [side]);
  const hide = useCallback(() => setPos(null), []);

  if (content == null || content === '') return children;

  return (
    <span
      ref={ref}
      className={['tt', block && 'tt--block', className].filter(Boolean).join(' ')}
      aria-describedby={pos ? id : undefined}
      onMouseEnter={show}
      onMouseLeave={hide}
      onFocus={show}
      onBlur={hide}
    >
      {children}
      {pos && createPortal(
        <span
          id={id}
          role="tooltip"
          className={`tt__b tt__b--${side}`}
          style={{ top: pos.top, left: pos.left }}
        >
          {content}
        </span>,
        document.body,
      )}
    </span>
  );
};
Tooltip.displayName = 'Tooltip';

/** @type {readonly ('top'|'bottom')[]} */
export const TOOLTIP_SIDES = ['top', 'bottom'];
