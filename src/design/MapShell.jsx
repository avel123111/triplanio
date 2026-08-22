// @ts-check
import React, { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { Card } from './index.jsx';
import { IconBtn } from './IconBtn';
import { PeekSheet } from '@/components/ui/PeekSheet';
import { useIsPhone } from '@/hooks/use-mobile';

/**
 * MapShell — раскладка «карта во всю площадь + панель поверх неё» (TRIP-422).
 *
 * ★ ЗАЧЕМ ПРИМИТИВ, А НЕ ВЁРСТКА ЭКРАНА. Такая раскладка уже в третьем месте
 * (планировщик, линза карты, редактор маршрута), и все три написали её
 * по-своему: свои классы, свои брейкпоинты, своё представление о том, где
 * заканчивается карта. Здесь она одна, и вместе с ней один ответ на главный
 * вопрос — СКОЛЬКО МЕСТА НА ЭКРАНЕ СВОБОДНО.
 *
 * ★ КАРТА НЕ МЕНЯЕТ НИ РАЗМЕР, НИ КАМЕРУ. Слот карты всегда во всю площадь
 * шелла; панель и шит лежат ПОВЕРХ. Резать канвас колонкой значит
 * переаллоцировать буфер и перерисовывать тайлы — это и есть «карта моргнула».
 *
 * ★★ И КАМЕРУ ШЕЛЛ НЕ ТРОГАЕТ ТОЖЕ. Наводить её на свободный остаток —
 * отдельная задача, и она сложнее, чем кажется: отступ вьюпорта на проекции
 * `globe` роняет зум и рассинхронивает лимб атмосферы с тайлами (замерено на
 * живой карте), а сдвиг камеры требует проверки на живом экране, которой у меня
 * пока не было. Поэтому шелл СЧИТАЕТ свободное место и отдаёт его вызывателю
 * (`map(insets)`), но НИ ОДИН экран сейчас эти отступы карте не передаёт: карта
 * во всём приложении работает ровно так, как до шелла.
 *
 * Телефон — панель уезжает в `<PeekSheet>` с детентами; десктоп — плавающая
 * колонка слева, которую можно свернуть (кнопка на шве панели и карты).
 *
 *   <MapShell
 *     map={(insets) => <MapView … insets={insets} />}
 *     panel={<RoutePanel/>} panelLabel="Маршрут"
 *     detents={[0.15, 0.68, 1]} detent={i} onDetentChange={setI}
 *   />
 */

/** Пустая закрытая площадь — общий объект, чтобы не плодить ссылки на рендер. */
const NO_INSETS = Object.freeze({ top: 0, right: 0, bottom: 0, left: 0 });

/**
 * `map` — ФУНКЦИЯ `(insets) => node`, а не готовый узел: отступы должны дойти до
 * карты явно, а не через клонирование чужого элемента украдкой.
 *
 * @param {{
 *   map: (insets: { top: number, right: number, bottom: number, left: number }) => any,
 *   panel?: any,
 *   panelHeader?: any,
 *   panelFooter?: any,
 *   panelLabel: string,
 *   dock?: number,
 *   detents?: number[],
 *   detent?: number,
 *   onDetentChange?: (i: number) => void,
 *   collapsed?: boolean,
 *   onCollapsedChange?: (v: boolean) => void,
 *   collapseLabel?: string,
 *   expandLabel?: string,
 *   className?: string,
 *   children?: any,
 * }} p
 */
export function MapShell({
  map,
  panel,
  // Шапка панели — то, что видно, когда шит опущен на нижний детент (и что на
  // десктопе стоит над телом). Шелл обязан знать про неё отдельно: опущенный
  // шит без шапки — безымянная полоска, по которой не понять, что под ней.
  panelHeader = null,
  // Панель действий (кнопки шага): на виду при любом скролле тела, поэтому
  // слот отдельный, а не «последний ребёнок» содержимого.
  panelFooter = null,
  panelLabel,
  // Высота фиксированного нижнего нава экрана: под линзами трипа он есть, в
  // планировщике его нет. Шелл не гадает — ему говорят.
  dock = 0,
  detents = [0.15, 0.68, 1],
  detent = 0,
  onDetentChange,
  collapsed = false,
  onCollapsedChange,
  collapseLabel = '',
  expandLabel = '',
  className = '',
  children,
}) {
  const isPhone = useIsPhone();
  const rootRef = useRef(/** @type {HTMLDivElement | null} */ (null));
  const panelRef = useRef(/** @type {HTMLElement | null} */ (null));
  const [sheetPx, setSheetPx] = useState(0);
  const [panelPx, setPanelPx] = useState(0);

  // Ширину панели МЕРЯЕМ, а не берём из константы: она задана в CSS (`min()` от
  // вьюпорта), и продублированное в JS число разъехалось бы с ней на первой же
  // правке раскладки.
  const measurePanel = useCallback(() => {
    const root = rootRef.current, el = panelRef.current;
    if (!root || !el) { setPanelPx(0); return; }
    const r = el.getBoundingClientRect(), b = root.getBoundingClientRect();
    setPanelPx(Math.max(0, Math.round(r.right - b.left)));
  }, []);

  useLayoutEffect(() => {
    if (isPhone) { setPanelPx(0); return undefined; }
    measurePanel();
    const ro = typeof ResizeObserver !== 'undefined' ? new ResizeObserver(measurePanel) : null;
    if (ro && panelRef.current) ro.observe(panelRef.current);
    window.addEventListener('resize', measurePanel);
    return () => { if (ro) ro.disconnect(); window.removeEventListener('resize', measurePanel); };
  }, [isPhone, measurePanel, collapsed]);

  // Свёрнутая панель не закрывает ничего — карта получает весь экран.
  const insets = useMemo(() => {
    if (isPhone) return sheetPx > 0 ? { ...NO_INSETS, bottom: sheetPx } : NO_INSETS;
    if (collapsed || panelPx <= 0) return NO_INSETS;
    return { ...NO_INSETS, left: panelPx };
  }, [isPhone, sheetPx, collapsed, panelPx]);

  // Шит живёт в портале на <body>: пока экран смонтирован, он сообщает свою
  // высоту, на выходе площадь обязана обнулиться.
  useEffect(() => () => setSheetPx(0), []);

  return (
    <div className={['mapshell', className].filter(Boolean).join(' ')} ref={rootRef}>
      <div className="mapshell__map">{map(insets)}</div>

      {panel && (isPhone ? (
        <PeekSheet
          detents={detents}
          detent={detent}
          onDetentChange={onDetentChange}
          onHeightChange={setSheetPx}
          dock={dock}
          header={panelHeader}
          footer={panelFooter}
          label={panelLabel}
        >
          {panel}
        </PeekSheet>
      ) : (
        <>
          <aside
            className="mapshell__panel"
            ref={panelRef}
            data-collapsed={collapsed || undefined}
            aria-hidden={collapsed || undefined}
          >
            {/* Поверхность панели — дело ШЕЛЛА, а не экрана: у шва карты и
                панели один облик на всех экранах, и на телефоне ровно ту же
                роль играет поверхность шита (фон + скругление + тень). Экран
                отдаёт содержимое, а не рисует себе карточку заново. */}
            <Card pad="none" radius="btn" raised className="mapshell__card">
              {panelHeader}
              <div className="mapshell__body scrollbar-thin">{panel}</div>
              {panelFooter}
            </Card>
          </aside>
          {/* Шов панели и карты — место, где живёт «свернуть/раскрыть»: он
              принадлежит ГРАНИЦЕ между ними, а не содержимому панели, поэтому
              кнопку рисует шелл, а не экран. Свёрнутая панель уезжает влево, и
              та же кнопка остаётся у края карты. */}
          {onCollapsedChange && (
            <IconBtn
              className="mapshell__toggle"
              icon={collapsed ? 'chev' : 'chevL'}
              round
              tone="outline"
              ariaLabel={collapsed ? expandLabel : collapseLabel}
              ariaExpanded={!collapsed}
              onClick={() => onCollapsedChange(!collapsed)}
            />
          )}
        </>
      ))}

      {children}
    </div>
  );
}

export default MapShell;
