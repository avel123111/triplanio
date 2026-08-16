// @ts-check
import React from 'react';

// ----- Tooltip ----- (TRIP-274 Ф2.2 — глобальный текст-хинт на ховере/фокусе)
// Обёртка вокруг триггера: показывает короткий текст при наведении/фокусе.
// CSS-only, БЕЗ новой зависимости — примитив несёт текст, портал ему не нужен
// (лестница «нативное над библиотекой»; Radix-tooltip'а в стеке нет, тянуть пакет
// ради текста на ховере — лишнее). Переиспользуемый: сейчас «замок» недоступного
// действия у наблюдателя (`<Btn locked>`), дальше — названия стран на карте и т.п.
//
// Разметка: триггер `.tt` (position:relative), пузырь `.tt__b` (показывается
// `.tt:hover`/`.tt:focus-within`). Доступность: пузырь `role="tooltip"` со своим
// id, триггер ссылается `aria-describedby`. Пустой `content` → рендерит только
// детей (обёртки нет).
/**
 * @param {{
 *   content?: any,
 *   side?: 'top'|'bottom',
 *   children?: any,
 *   className?: string,
 * }} p
 */
export const Tooltip = ({ content, side = 'top', children, className = '' }) => {
  const id = React.useId();
  if (content == null || content === '') return children;
  return (
    <span className={['tt', className].filter(Boolean).join(' ')} aria-describedby={id}>
      {children}
      <span id={id} role="tooltip" className={`tt__b tt__b--${side}`}>{content}</span>
    </span>
  );
};
Tooltip.displayName = 'Tooltip';

/** @type {readonly ('top'|'bottom')[]} */
export const TOOLTIP_SIDES = ['top', 'bottom'];
