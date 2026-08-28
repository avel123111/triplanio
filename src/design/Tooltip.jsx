// @ts-check
import React, { useState, useRef, useId, useCallback, useEffect } from 'react';
import { createPortal } from 'react-dom';

// ----- Tooltip ----- (TRIP-274 Ф2.2 — глобальный текст-хинт на ховере/фокусе)
// Обёртка вокруг триггера: показывает короткий текст при наведении/фокусе.
// БЕЗ новой зависимости. Пузырь рендерится ПОРТАЛОМ в <body> и позиционируется
// по `getBoundingClientRect` триггера (position: fixed) — поэтому НЕ клипается
// `overflow:hidden`-контейнерами (диалог/карточка), как клипался absolute-вариант.
// Переиспользуемый: «замок» недоступного действия у наблюдателя (`<Btn locked>`),
// кнопки поверх карты (`MapControls`), названия стран на карте и т.п.
//
// ★★ ПОДСКАЗКА — ЯЗЫК УКАЗАТЕЛЯ, А НЕ ПАЛЬЦА, И ЭТО НЕСУЩЕЕ ПРАВИЛО.
// Пузырь открывался на `mouseenter`/`focus` — обоих на телефоне НЕ существует
// как отдельного намерения: браузер шлёт эмулированный `mouseenter` на ТАП, а
// `mouseleave` после него не приходит НИКОГДА, и фокус остаётся на кнопке. Вместе
// это давало ровно то, что видел пользователь: нажал кнопку — получил результат
// нажатия И висящую подсказку, прибитую к координатам, снятым один раз
// (`position: fixed`), то есть к месту, где триггер был ДО перерисовки.
//
// Поэтому здесь:
//   • указатель открывает пузырь ТОЛЬКО когда он мышь (`pointerType === 'mouse'`),
//     а не эмуляция тача — правило по СОБЫТИЮ, не по ширине экрана: гибридный
//     ноутбук с тачем сохраняет подсказку под мышью и не показывает под пальцем;
//   • фокус открывает его только КЛАВИАТУРНЫЙ (`:focus-visible`) — фокус после
//     тапа/клика подсказку не поднимает;
//   • нажатие по триггеру закрывает пузырь СРАЗУ (`pointerdown`): подсказка
//     объясняет кнопку до нажатия, после нажатия говорит уже сам результат;
//   • скролл/ресайз тоже закрывают — координаты сняты один раз, и «прибитый»
//     пузырь в новой раскладке врёт о том, к чему относится.
//
// Доступность: пузырь `role="tooltip"` со своим id, триггер ссылается
// `aria-describedby`, пока показан. Пустой `content` → только дети. Текст
// подсказки ДУБЛИРУЕТСЯ в `aria-label` кнопки вызывателем — на телефоне пузыря
// нет, и имя кнопки остаётся единственным носителем смысла для скринридера.
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

  // Пузырь показан — значит его координаты уже устарели при первом же сдвиге
  // страницы. Закрываем, а не пересчитываем: подсказка живёт доли секунды, и
  // «едущий за элементом» пузырь — это движение там, где пользователь его не
  // просил. `capture` — чтобы поймать скролл ЛЮБОГО контейнера, не только окна.
  useEffect(() => {
    if (!pos) return undefined;
    window.addEventListener('scroll', hide, true);
    window.addEventListener('resize', hide);
    return () => {
      window.removeEventListener('scroll', hide, true);
      window.removeEventListener('resize', hide);
    };
  }, [pos, hide]);

  if (content == null || content === '') return children;

  return (
    <span
      ref={ref}
      className={['tt', block && 'tt--block', className].filter(Boolean).join(' ')}
      aria-describedby={pos ? id : undefined}
      onPointerEnter={(e) => { if (e.pointerType === 'mouse') show(); }}
      onPointerLeave={hide}
      onPointerDown={hide}
      onFocus={(e) => {
        // `:focus-visible` — единственный способ отличить фокус от клавиатуры от
        // фокуса, который браузер поставил по тапу. Старые движки без него
        // подсказку по фокусу просто не покажут (у них есть мышь и ховер).
        try { if (e.target.matches(':focus-visible')) show(); } catch { /* нет поддержки — молчим */ }
      }}
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
