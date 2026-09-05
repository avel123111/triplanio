// @ts-check
import React, { useState, useRef, useId, useCallback, useEffect, useLayoutEffect } from 'react';
import { createPortal } from 'react-dom';
import { SurfaceCrashGuard } from '@/components/ui/surfaceCrashGuard';

// ----- Tooltip ----- (TRIP-274 Ф2.2 — глобальный текст-хинт на ховере/фокусе)
// Обёртка вокруг триггера: показывает короткий текст при наведении/фокусе.
// БЕЗ новой зависимости. Пузырь рендерится ПОРТАЛОМ в <body> и позиционируется
// по `getBoundingClientRect` триггера (position: fixed) — поэтому НЕ клипается
// `overflow:hidden`-контейнерами (диалог/карточка), как клипался absolute-вариант.
// Переиспользуемый: «замок» недоступного действия у наблюдателя (`<Btn locked>`),
// кнопки поверх карты (`MapControls`), названия стран на карте и т.п.
//
// ★★ ПУЗЫРЬ ОБЯЗАН ПОМЕЩАТЬСЯ НА ЭКРАНЕ — ЭТО ДЕЛО ПРИМИТИВА, А НЕ ВЫЗЫВАТЕЛЯ.
// Сторон было две (top/bottom) и обе центрированы по триггеру, поэтому у
// элемента, прижатого к краю, подсказка гарантированно попадала в беду: у кнопок
// карты (правый верхний угол) она налезала на шапку приложения И обрезалась
// правым краем вьюпорта. Экран не может это чинить у себя — у него нет ни
// размеров пузыря, ни права двигать чужой портал.
//
// Поэтому здесь: `side` — ПРЕДПОЧТЕНИЕ ('top' | 'bottom' | 'left' | 'right'), а
// финальное место считает сам примитив по фактическому размеру пузыря:
//   • не помещается по выбранной оси → переворачивается на противоположную
//     сторону (ОДИН раз: если места нет и там, лучше прижатый пузырь, чем
//     мигание туда-сюда);
//   • по второй оси зажимается в границы вьюпорта с полем `EDGE`.
// Замер идёт в `useLayoutEffect` — до отрисовки кадра, поэтому промежуточное
// положение не видно.
//
// ★★ ПОДСКАЗКА — ЯЗЫК УКАЗАТЕЛЯ, А НЕ ПАЛЬЦА.
// Пузырь открывался на `mouseenter`/`focus` — обоих на телефоне НЕ существует
// как отдельного намерения: браузер шлёт эмулированный `mouseenter` на ТАП, а
// `mouseleave` после него не приходит НИКОГДА, и фокус остаётся на кнопке. Вместе
// это давало ровно то, что видел пользователь: нажал кнопку — получил результат
// нажатия И висящую подсказку. Поэтому:
//   • указатель открывает пузырь ТОЛЬКО когда он мышь (`pointerType === 'mouse'`),
//     а не эмуляция тача — правило по СОБЫТИЮ, не по ширине экрана: гибридный
//     ноутбук с тачем сохраняет подсказку под мышью и не показывает под пальцем;
//   • фокус открывает его только КЛАВИАТУРНЫЙ (`:focus-visible`);
//   • нажатие по триггеру закрывает сразу (`pointerdown`), скролл и ресайз тоже.
//
// Доступность: пузырь `role="tooltip"` со своим id, триггер ссылается
// `aria-describedby`, пока показан. Пустой `content` → только дети. Текст
// подсказки ДУБЛИРУЕТСЯ в `aria-label` кнопки вызывателем — на телефоне пузыря
// нет, и имя кнопки остаётся единственным носителем смысла для скринридера.

/** Зазор между триггером и пузырём и поле у края экрана (px). */
const GAP = 8;
const EDGE = 8;

/** Точка, от которой пузырь раскрывается для выбранной стороны. */
function anchorFor(side, r) {
  if (side === 'left') return { top: r.top + r.height / 2, left: r.left - GAP };
  if (side === 'right') return { top: r.top + r.height / 2, left: r.right + GAP };
  if (side === 'bottom') return { top: r.bottom + GAP, left: r.left + r.width / 2 };
  return { top: r.top - GAP, left: r.left + r.width / 2 };
}

const OPPOSITE = { top: 'bottom', bottom: 'top', left: 'right', right: 'left' };

/**
 * @param {{
 *   content?: any,
 *   side?: 'top'|'bottom'|'left'|'right',
 *   block?: boolean,
 *   children?: any,
 *   className?: string,
 * }} p
 */
export const Tooltip = ({ content, side = 'top', block = false, children, className = '' }) => {
  const id = useId();
  const ref = useRef(/** @type {HTMLSpanElement|null} */(null));
  const bubbleRef = useRef(/** @type {HTMLSpanElement|null} */(null));
  const [pos, setPos] = useState(
    /** @type {{top:number,left:number,side:string,fitted?:boolean}|null} */(null),
  );

  const show = useCallback(() => {
    const el = ref.current;
    if (!el) return;
    setPos({ ...anchorFor(side, el.getBoundingClientRect()), side });
  }, [side]);
  const hide = useCallback(() => setPos(null), []);

  // Довести пузырь до экрана: перевернуть, если не влез по своей оси, и зажать
  // по второй. Один проход — `fitted` не даёт эффекту зациклиться, когда места
  // не хватает ни с одной стороны.
  useLayoutEffect(() => {
    if (!pos || pos.fitted) return;
    const b = bubbleRef.current?.getBoundingClientRect();
    const t = ref.current?.getBoundingClientRect();
    if (!b || !t) return;
    const W = window.innerWidth, H = window.innerHeight;
    let next = { ...pos, fitted: true };

    const overflows = pos.side === 'top' ? b.top < EDGE
      : pos.side === 'bottom' ? b.bottom > H - EDGE
        : pos.side === 'left' ? b.left < EDGE
          : b.right > W - EDGE;
    if (overflows) {
      const flipped = OPPOSITE[pos.side];
      next = { ...anchorFor(flipped, t), side: flipped, fitted: true };
    }

    // Зажим по ВТОРОЙ оси считается от того же пузыря: его размер от переворота
    // не меняется, меняется только точка раскрытия.
    const horizontal = next.side === 'top' || next.side === 'bottom';
    const dx = next.left - pos.left, dy = next.top - pos.top;
    const box = { top: b.top + dy, bottom: b.bottom + dy, left: b.left + dx, right: b.right + dx };
    if (horizontal) {
      if (box.right > W - EDGE) next.left -= box.right - (W - EDGE);
      else if (box.left < EDGE) next.left += EDGE - box.left;
    } else if (box.bottom > H - EDGE) next.top -= box.bottom - (H - EDGE);
    else if (box.top < EDGE) next.top += EDGE - box.top;

    setPos(next);
  }, [pos]);

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
          ref={bubbleRef}
          id={id}
          role="tooltip"
          className={`tt__b tt__b--${pos.side}`}
          style={{ top: pos.top, left: pos.left }}
        >
          {/* Портал стоит на document.body, ВНЕ роутовых границ — краш в content
              ловил бы только AppErrorBoundary. Граница краха (TRIP-515) гасит
              пузырь, а не приложение. */}
          <SurfaceCrashGuard>{content}</SurfaceCrashGuard>
        </span>,
        document.body,
      )}
    </span>
  );
};
Tooltip.displayName = 'Tooltip';

/** @type {readonly ('top'|'bottom'|'left'|'right')[]} */
export const TOOLTIP_SIDES = ['top', 'bottom', 'left', 'right'];
