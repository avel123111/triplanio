// @ts-check
import React, { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { Card } from './index.jsx';
import { IconBtn } from './IconBtn';
import { PeekSheet } from '@/components/ui/PeekSheet';
import { useIsPhone } from '@/hooks/use-mobile';
import { mapSlotInsets } from '@/lib/mapShellSlot';

/**
 * MapShell — раскладка «карта в свободном окне + панель над ним» (TRIP-422).
 *
 * ★ ЗАЧЕМ ПРИМИТИВ, А НЕ ВЁРСТКА ЭКРАНА. Такая раскладка уже в третьем месте
 * (планировщик, линза карты, редактор маршрута), и все три написали её
 * по-своему: свои классы, свои брейкпоинты, своё представление о том, где
 * заканчивается карта. Здесь она одна, и вместе с ней один ответ на главный
 * вопрос — СКОЛЬКО МЕСТА НА ЭКРАНЕ СВОБОДНО.
 *
 * ★★ СЛОТ КАРТЫ И ЕСТЬ СВОБОДНОЕ ОКНО. Панель и шит не лежат поверх карты —
 * они её ГРАНИЦА: слот сжимается на ширину панели (десктоп) и на высоту шита
 * (телефон). Отсюда у карты нет ни одного собственного представления о том,
 * что закрыто: она рисует ровно тот прямоугольник, который ей дали.
 *
 * ★★ ПОЧЕМУ НЕ ОТСТУП ВЬЮПОРТА. Соблазн — оставить канвас во весь экран и
 * увести кадр `padding`-ом; на плоской карте это работает, на ГЛОБУСЕ нет.
 * Диаметр шара Mapbox считает от размеров КАНВАСА, а не от свободной части:
 * канвас во весь экран телефона даёт шар меньше свободного окна, и вокруг него
 * видно дымку и космос — «глобус в круге на сером фоне». Замерено по пикселям
 * снимка (430×900, шит 612): канвас во весь экран — 22.9 % дымки в свободном
 * окне и все четыре угла вне планеты; слот, равный свободному окну, — все
 * четыре угла карта, ровно как на `dev`, где карта была отдельной полосой.
 *
 * Размер слота меняется на ОСАДКЕ детента, не покадрово: высоту шит сообщает
 * зафиксированную, а `useMapSurface` уже держит ResizeObserver и зовёт
 * `map.resize()` — камере ничего доопределять не нужно.
 *
 * Телефон — панель уезжает в `<PeekSheet>` с детентами; десктоп — плавающая
 * колонка слева, которую можно свернуть (кнопка на шве панели и карты).
 *
 *   <MapShell
 *     map={<MapView … />}
 *     panel={<RoutePanel/>} panelLabel="Маршрут"
 *     detents={[0.15, 0.68, 1]} detent={i} onDetentChange={setI}
 *   />
 */

/**
 * `map` — узел ИЛИ функция `(camera) => node`. Функция нужна там, где закрытая
 * площадь режет ШИРИНУ: канвас остаётся во всю площадь (карта видна под
 * виджетом), а кадр уводится отступом камеры — эти отступы и приезжают
 * аргументом. Разбор, почему не всегда так, — в `mapSlotInsets`.
 *
 * @param {{
 *   map: any,
 *   panel?: any,
 *   panelHeader?: any,
 *   panelFooter?: any,
 *   panelLabel: string,
 *   panelOverlay?: any,
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
  //
  // Воздух вокруг шапки даёт ШЕЛЛ (`.mapshell__head`), а не экран: это геометрия
  // его коробки, и экран, повторяющий её у себя, разъезжается с ней на первой же
  // правке — ровно так у редактора шапка и оказалась прижатой к краю карточки,
  // когда своё правило пришлось снять как «дотягивание в примитив».
  panelHeader = null,
  // Панель действий (кнопки шага): на виду при любом скролле тела, поэтому
  // слот отдельный, а не «последний ребёнок» содержимого.
  panelFooter = null,
  panelLabel,
  // Слой ПОВЕРХ панели во всю её высоту — ящик города/события у редактора.
  // Живёт здесь, а не в `children`: `children` лежат поверх ВСЕГО шелла (карты
  // в том числе), а ящик обязан закрывать ровно панель и не трогать карту —
  // по ней в этот момент продолжают кликать.
  //
  // Коробку слою даёт ШЕЛЛ (`.mapshell__overlay`), а не экран: воздух вокруг
  // панели — свойство раскладки, и экран, повторяющий его у себя, разъезжается
  // с ней на первой же правке. Без этого ящик ложился по краю шелла, а виджет
  // под ним стоял с отступом — два разных прямоугольника у одного объекта.
  panelOverlay = null,
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

  // Свободное окно едет в CSS-переменных НА КОРНЕ шелла: к нему обязаны
  // дотягиваться и слот карты, и всё, что экран кладёт поверх карты (плавающие
  // кнопки), иначе каждый такой элемент заведёт своё представление о том, где
  // кончается свободное место — то самое, ради чего шелл и заведён. Сам расчёт — чистая функция `mapSlotInsets` (закрыта тестами):
  // у правила «слот равен свободному окну» нет скриншота, а его поломка не
  // роняет ни экран, ни гарды.
  const box = useMemo(
    () => mapSlotInsets({ phone: isPhone, sheetPx, panelPx, collapsed }),
    [isPhone, sheetPx, collapsed, panelPx],
  );
  const slotStyle = useMemo(
    () => ({ '--mapshell-bottom': `${box.slot.bottom}px`, '--mapshell-left': `${box.slot.left}px` }),
    [box],
  );

  // Шит живёт в портале на <body>: пока экран смонтирован, он сообщает свою
  // высоту, на выходе площадь обязана обнулиться.
  useEffect(() => () => setSheetPx(0), []);

  return (
    <div className={['mapshell', className].filter(Boolean).join(' ')} ref={rootRef} style={slotStyle}>
      <div className="mapshell__map">{typeof map === 'function' ? map(box.camera) : map}</div>

      {panel && (isPhone ? (
        <PeekSheet
          detents={detents}
          detent={detent}
          onDetentChange={onDetentChange}
          onHeightChange={setSheetPx}
          header={panelHeader ? <div className="mapshell__head">{panelHeader}</div> : null}
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
              {panelHeader ? <div className="mapshell__head">{panelHeader}</div> : null}
              <div className="mapshell__body scrollbar-thin">{panel}</div>
              {panelFooter}
            </Card>
            {panelOverlay ? <div className="mapshell__overlay">{panelOverlay}</div> : null}
          </aside>
          {/* Шов панели и карты — место, где живёт «свернуть/раскрыть»: он
              принадлежит ГРАНИЦЕ между ними, а не содержимому панели, поэтому
              кнопку рисует шелл, а не экран. Свёрнутая панель уезжает влево, и
              та же кнопка остаётся у края карты. */}
          {onCollapsedChange && (
            <IconBtn
              className="mapshell__toggle"
              icon={collapsed ? 'chev' : 'chevL'}
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
