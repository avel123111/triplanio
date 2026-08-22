import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { nearestDetent, resolveDetents } from '@/lib/sheetDetents';

/**
 * PeekSheet — НЕМОДАЛЬНЫЙ постоянный боттом-шит с ДЕТЕНТАМИ: он всегда на
 * экране, встаёт на одну из заданных высот, содержимое под ним живёт своей
 * жизнью, и закрыть его нельзя. Веб-эквивалент нативного detent-шита (iOS
 * `UISheetPresentationController` detents / Android `BottomSheetBehavior`).
 *
 * Намеренно НЕ на vaul: vaul — движок МОДАЛЬНОГО drawer'а (открылся над
 * подложкой → свайп закрывает; он лочит страницу и ставит `touch-action:none`
 * на всю поверхность). Это правильно для канон-`<Sheet>` (меню, пикеры,
 * confirm), но воюет с постоянным шитом над живой картой: ломается внутренний
 * скролл и появляется pull-to-refresh страницы. Поэтому здесь свой жест:
 *   • грип и шапка — зоны перетаскивания, тело скроллится нативно;
 *   • раскрытый шит со скролленным телом отдаёт жест телу, а тяга вниз от
 *     верха тела возвращает его шиту (нативная передача скролл↔драг);
 *   • драг зовёт preventDefault, overscroll-behavior contained — страница
 *     не дёргается.
 *
 * ★ ШИТ ПРИКЛЕЕН К НИЗУ, И ЭТО НЕ СЛУЧАЙНОСТЬ. Он `position: fixed; bottom: 0`
 * во всю высоту вьюпорта и УЕЗЖАЕТ ВНИЗ на `--sheet-y`: видимая полоса — это
 * его верх. Ровно поэтому он не может «прилипнуть к верхней части экрана» ни
 * при каком детенте, ни при какой клавиатуре — верхнего якоря у него нет.
 *
 * ★ ГЕОМЕТРИЯ ЖИВЁТ В ДВУХ ПЕРЕМЕННЫХ, И РАЗДЕЛЕНЫ ОНИ РАДИ ПЛАВНОСТИ:
 *   `--sheet-y` — сдвиг, меняется КАЖДЫЙ КАДР жеста (только transform, без
 *                 перекладки — палец ведёт шит 1:1);
 *   `--sheet-h` — высота ЗАФИКСИРОВАННОГО детента, меняется ТОЛЬКО на осадке;
 *                 от неё считается высота тела. Меняй её покадрово — и каждый
 *                 кадр жеста стоил бы layout всего списка.
 *
 * Контролируемый: `detent` (индекс) + `onDetentChange`. `detents` — доли высоты
 * экрана по возрастанию; самая нижняя поднимается до измеренной шапки (грип +
 * header + док + safe-area), чтобы заголовок никогда не обрезался: магических
 * пикселей вызывателю передавать не нужно. Только мобильный: десктоп рисует свою
 * раскладку.
 *
 *   <PeekSheet detents={[0.15, 0.68, 1]} detent={i} onDetentChange={setI}
 *              header={<Head/>} label="Маршрут">
 *     <ScrollableList/>
 *   </PeekSheet>
 */

const DOCK_PX = 60; // фиксированный нижний нав, за которым стоит нижний детент (TRIP-222)
const FLICK_VELOCITY = 0.3; // px/мс на отпускании, выше которого бросок решает направление

// Инсет домашней полоски в px (env() из JS не прочитать).
function safeAreaBottom() {
  if (typeof document === 'undefined') return 0;
  const probe = document.createElement('div');
  probe.style.cssText = 'position:fixed;bottom:0;left:0;width:0;height:env(safe-area-inset-bottom,0px);visibility:hidden;pointer-events:none;';
  document.body.appendChild(probe);
  const h = probe.getBoundingClientRect().height || 0;
  probe.remove();
  return h;
}

/**
 * `header` — то, что видно на САМОМ НИЖНЕМ детенте (и зона перетаскивания):
 * шапка обязана читаться, когда шит опущен, иначе опущенный шит превращается в
 * безымянную полоску. `children` — тело, оно скроллится.
 *
 * @param {{
 *   header?: any,
 *   children?: any,
 *   detent?: number,
 *   onDetentChange?: (i: number) => void,
 *   detents?: number[],
 *   onHeightChange?: (px: number) => void,
 *   label: string,
 *   className?: string,
 * }} p
 */
export function PeekSheet({
  header,
  children,
  detent = 0,
  onDetentChange,
  detents = [0.15, 1],
  onHeightChange,
  label,
  className = '',
}) {
  const sheetRef = useRef(null);
  const headRef = useRef(null);
  const bodyRef = useRef(null);
  const drag = useRef(null);
  // Полоса шапки (грип + header + док + safe-area) и высота вьюпорта — обе
  // измеряются, а не задаются числом: шапка у каждого экрана своя.
  const [headPx, setHeadPx] = useState(96);
  const [vh, setVh] = useState(() => (typeof window === 'undefined' ? 0 : window.innerHeight));
  const [dragY, setDragY] = useState(null); // px, пока палец на экране; иначе null

  // Доли → пиксели: один расчёт на рендер, он же кормит жест и стили.
  const stops = useMemo(() => resolveDetents(detents, vh, headPx), [detents, vh, headPx]);
  const index = Math.max(0, Math.min(stops.length - 1, detent));
  const sheetH = stops[index] ?? 0;
  const restY = Math.max(0, vh - sheetH);

  // Свежие пропы для однажды навешанных нативных слушателей.
  const live = useRef();
  live.current = { index, stops, vh, onDetentChange };

  const measure = useCallback(() => {
    const sheet = sheetRef.current, head = headRef.current;
    if (!sheet || !head) return;
    const band = head.getBoundingClientRect().bottom - sheet.getBoundingClientRect().top;
    setHeadPx(Math.round(band + DOCK_PX + safeAreaBottom()));
    setVh(window.innerHeight);
  }, []);

  useLayoutEffect(() => {
    measure();
    const ro = typeof ResizeObserver !== 'undefined' ? new ResizeObserver(measure) : null;
    if (ro && headRef.current) ro.observe(headRef.current);
    window.addEventListener('resize', measure);
    return () => { if (ro) ro.disconnect(); window.removeEventListener('resize', measure); };
  }, [measure]);

  // Нативный не-пассивный тач — навешан один раз, текущее состояние читает через
  // `live`. preventDefault на драге и есть то, что глушит pull-to-refresh.
  useEffect(() => {
    const el = sheetRef.current;
    if (!el) return undefined;
    const opts = { passive: false };

    const onStart = (e) => {
      if (e.touches.length !== 1) { drag.current = null; return; }
      const { index: i, stops: st, vh: h } = live.current;
      drag.current = {
        startY: e.touches[0].clientY,
        base: Math.max(0, h - (st[i] ?? 0)),
        min: Math.max(0, h - (st[st.length - 1] ?? 0)), // самый высокий детент
        max: Math.max(0, h - (st[0] ?? 0)),             // самый низкий
        last: Math.max(0, h - (st[i] ?? 0)),
        lastY: e.touches[0].clientY, lastT: e.timeStamp, vy: 0,
        // Тап по грипу ИЛИ шапке переключает детент (не только по полоске).
        onHandle: !!(e.target.closest && e.target.closest('[data-peek-grip],[data-peek-head]')),
        mode: 'idle',
      };
    };
    const onMove = (e) => {
      const d = drag.current; if (!d) return;
      const y = e.touches[0].clientY;
      const dy = y - d.startY; // + вниз, − вверх
      if (d.mode === 'idle') {
        if (Math.abs(dy) < 4) return; // ждём намерения
        const atTop = !bodyRef.current || bodyRef.current.scrollTop <= 0;
        const { index: i, stops: st } = live.current;
        const atMax = i >= st.length - 1;
        // На верхнем детенте тело скроллится, и только тяга вниз от его верха
        // возвращает жест шиту. Ниже — любой драг двигает шит.
        d.mode = (!atMax || (dy > 0 && atTop)) ? 'drag' : 'scroll';
      }
      if (d.mode !== 'drag') return;
      e.preventDefault();
      const dt = e.timeStamp - d.lastT;
      if (dt > 0) d.vy = (y - d.lastY) / dt;
      d.lastY = y; d.lastT = e.timeStamp;
      const next = Math.max(d.min, Math.min(d.max, d.base + dy));
      d.last = next;
      setDragY(next);
    };
    const onEnd = (e) => {
      const d = drag.current; drag.current = null;
      if (!d) return;
      const { index: i, stops: st, vh: h, onDetentChange: cb } = live.current;
      if (d.mode === 'drag') {
        setDragY(null);
        // Скорость, замершая до отпускания (>80мс), — это осознанная установка,
        // а не бросок.
        const vy = (e.timeStamp - d.lastT) < 80 ? d.vy : 0;
        // Бросок считаем в две строки не для красоты: одна строка со знаками
        // «больше» и «меньше» разом читается сканером i18n как JSX-текст.
        const isFlick = Math.abs(vy) > FLICK_VELOCITY;
        const flick = isFlick ? Math.sign(-vy) : 0;
        const next = nearestDetent({ stops: st, height: h - d.last, from: i, flick });
        if (next !== i) cb && cb(next);
      } else if (d.mode === 'idle' && d.onHandle) {
        e.preventDefault(); // глушим эмулированный клик и переключаем
        const next = i >= st.length - 1 ? 0 : i + 1;
        cb && cb(next);
      }
    };

    el.addEventListener('touchstart', onStart, opts);
    el.addEventListener('touchmove', onMove, opts);
    el.addEventListener('touchend', onEnd, opts);
    el.addEventListener('touchcancel', onEnd, opts);
    return () => {
      el.removeEventListener('touchstart', onStart, opts);
      el.removeEventListener('touchmove', onMove, opts);
      el.removeEventListener('touchend', onEnd, opts);
      el.removeEventListener('touchcancel', onEnd, opts);
    };
    // `stops` читается из замыкания на осадке — он же лежит в `live`, поэтому
    // перевешивать слушатели на каждое изменение размеров не нужно.
  }, []);

  // Клавиатура: стрелки двигают по детентам поштучно, Enter/Space — по кругу.
  const onGripKey = (e) => {
    const last = stops.length - 1;
    const go = (n) => { e.preventDefault(); if (n !== index) onDetentChange && onDetentChange(n); };
    if (e.key === 'ArrowUp') go(Math.min(last, index + 1));
    else if (e.key === 'ArrowDown') go(Math.max(0, index - 1));
    else if (e.key === 'Enter' || e.key === ' ') go(index >= last ? 0 : index + 1);
  };

  // Высоту сообщаем наверх ТОЛЬКО зафиксированную (не покадрово во время жеста):
  // ею шелл считает закрытую площадь карты, а камера обязана ехать после осадки,
  // а не драться с пальцем.
  useEffect(() => { onHeightChange && onHeightChange(sheetH); }, [sheetH, onHeightChange]);

  const style = {
    '--sheet-y': (dragY ?? restY) + 'px',
    '--sheet-h': sheetH + 'px',
    '--sheet-head': headPx + 'px',
  };

  if (typeof document === 'undefined') return null;
  // Портал в <body>: `position: fixed` обязан считаться от вьюпорта, а не от
  // предка с transform/filter, и шит делит стек-контекст с доком.
  return createPortal(
    <div
      ref={sheetRef}
      className={['peek-sheet', dragY != null ? 'is-dragging' : '', className].filter(Boolean).join(' ')}
      style={style}
      data-detent={index}
      data-detent-max={stops.length - 1}
    >
      <div
        className="peek-sheet__grip"
        data-peek-grip
        role="slider"
        tabIndex={0}
        aria-label={label}
        aria-valuemin={0}
        aria-valuemax={stops.length - 1}
        aria-valuenow={index}
        onKeyDown={onGripKey}
      >
        <i />
      </div>
      <div ref={headRef} className="peek-sheet__head" data-peek-head>{header}</div>
      <div ref={bodyRef} className="peek-sheet__body">{children}</div>
    </div>,
    document.body,
  );
}

export default PeekSheet;
