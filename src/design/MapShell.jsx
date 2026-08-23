// @ts-check
import React, { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { Card } from './index.jsx';
import { Tooltip } from './Tooltip';
import { IconBtn } from './IconBtn';
import { PeekSheet } from '@/components/ui/PeekSheet';
import { useIsPhone } from '@/hooks/use-mobile';
import { mapShellInsets, slotChangeDelay } from '@/lib/mapShellInsets';
import { SURFACE_EASE_CSS, SURFACE_SETTLE_MS } from '@/lib/surfaceMotion';
import { cssPx } from '@/lib/cssPx';

/**
 * MapShell — раскладка «карта во всю площадь + панель над ней» (TRIP-422).
 *
 * ★ ЗАЧЕМ ПРИМИТИВ, А НЕ ВЁРСТКА ЭКРАНА. Такая раскладка уже в третьем месте
 * (планировщик, линза карты, редактор маршрута), и все три написали её
 * по-своему: свои классы, свои брейкпоинты, своё представление о том, где
 * заканчивается карта. Здесь она одна, и вместе с ней один ответ на главный
 * вопрос — СКОЛЬКО МЕСТА НА ЭКРАНЕ СВОБОДНО.
 *
 * ★★ ЧТО ЗАКРЫТО — РЕШАЕТ ОСЬ, А НЕ ПЛАТФОРМА. Панель режет ШИРИНУ: холст
 * остаётся во всю площадь, кадр уводится отступом камеры, карта видна и под
 * виджетом. Шит режет ВЫСОТУ: её забирает САМ СЛОТ, потому что размер глобуса
 * mapbox считает от высоты ХОЛСТА — развяжи их, и шар начнёт то вылезать за
 * экран, то болтаться в пустоте. Разбор с замерами — `lib/mapShellInsets.js`.
 *
 * ★★★ РАЗМЕР СЛОТА МЕНЯЕТСЯ СКАЧКОМ, НО В ПРАВИЛЬНЫЙ МОМЕНТ. Анимировать его
 * нельзя (каждый кадр = переаллокация GL-буфера), поэтому единственная ручка —
 * КОГДА. Карта растёт сразу, сжимается после приезда шита (`slotChangeDelay`):
 * тогда она всегда занимает больший из двух размеров, и полоса фона между ней и
 * шитом не показывается ни разу. Без правила замер давал разрыв до 351 px.
 *
 * ★★★ ВСЁ, ЧТО ЕДЕТ, ЕДЕТ ОДНИМ ТЕМПОМ. Шит (CSS transform), камера (JS easeTo)
 * и плавающие контролы над картой (CSS bottom) приезжают за `SURFACE_SETTLE_MS`
 * по одной кривой. Шелл публикует темп переменными на своём корне, CSS их
 * читает — тем же приёмом, каким нижний нав публикует свою высоту.
 *
 * Телефон — панель уезжает в `<PeekSheet>` с детентами; десктоп — плавающая
 * колонка слева, которую можно свернуть (кнопка на шве панели и карты).
 *
 *   <MapShell
 *     map={(camera, slotPx) => <MapView camera={camera} slotPx={slotPx} … />}
 *     panel={<RoutePanel/>} panelLabel="Маршрут"
 *     detents={[0.15, 0.68, 1]} detent={i} onDetentChange={setI}
 *   />
 */

/**
 * `map` — узел ИЛИ функция `(camera, slotPx) => node`. Свободное окно меняют
 * ДВЕ вещи, по одной на ось: ширину — отступ камеры, высоту — размер слота.
 * Карте нужны обе: по первой она кадрирует, по второй понимает, что окно уехало.
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
  // правке.
  panelHeader = null,
  // Панель действий (кнопки шага): на виду при любом скролле тела, поэтому
  // слот отдельный, а не «последний ребёнок» содержимого.
  panelFooter = null,
  panelLabel,
  // Слой ПОВЕРХ панели во всю её высоту — ящик города/события у редактора.
  // Живёт здесь, а не в `children`: `children` лежат поверх ВСЕГО шелла (карты
  // в том числе), а ящик обязан закрывать ровно панель и не трогать карту —
  // по ней в этот момент продолжают кликать.
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

  // ★ ПРИМЕНЕНИЕ ВЫСОТЫ ШИТА ОТЛОЖЕНО ПО ПРАВИЛУ (`slotChangeDelay`): карта
  // растёт сразу, сжимается после приезда шита. Правило чистое и закрыто
  // тестами — у полосы фона между картой и шитом нет ни скриншота в CI, ни
  // гарда, а стоила она 351 px на 160 мс.
  const applyTimer = useRef(/** @type {any} */ (null));
  // Применённое значение зеркалим в ref: планировать нужно ДО рендера, а
  // обновлятель `setState` обязан быть чистым — React вправе позвать его
  // повторно, и таймер завёлся бы дважды.
  const appliedRef = useRef(0);
  const applySheetPx = useCallback((next) => {
    const prev = appliedRef.current;
    if (next === prev) return;
    clearTimeout(applyTimer.current);
    const commit = () => { appliedRef.current = next; setSheetPx(next); };
    const wait = slotChangeDelay({ prev, next, settleMs: SURFACE_SETTLE_MS });
    if (wait === 0) commit(); else applyTimer.current = setTimeout(commit, wait);
  }, []);
  useEffect(() => () => clearTimeout(applyTimer.current), []);

  // Ширину панели МЕРЯЕМ, а не берём из константы: она задана в CSS
  // (`--mapshell-panel-w`, там `min()` от вьюпорта), и продублированное в JS
  // число разъехалось бы с ней на первой же правке раскладки.
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
  }, [isPhone, measurePanel]);

  // Закрытая площадь — чистая функция (закрыта тестами): у правила «карта
  // кадрируется по свободному окну» нет скриншота, а его поломка не роняет ни
  // экран, ни гарды.
  //
  // ★ ЗАМЕР ПАНЕЛИ НЕ ЗАВИСИТ ОТ СВЁРНУТОСТИ, И ЭТО НАМЕРЕННО. Свёрнутая панель
  // уезжает `transform`-ом — её ширина не меняется, и «померить свёрнутую» дало
  // бы правильный ответ по случайности. Про свёрнутость знает правило.
  // Радиус скруглений шита объявлен в CSS (`--r-xl`) — здесь его МЕРЯЮТ, а не
  // повторяют числом: вторая запись разъехалась бы с токеном на первой правке.
  const [cornerPx, setCornerPx] = useState(0);
  useLayoutEffect(() => { setCornerPx(Math.round(cssPx('var(--r-xl, 0px)'))); }, []);

  const box = useMemo(
    () => mapShellInsets({ phone: isPhone, sheetPx, panelPx, collapsed, cornerPx }),
    [isPhone, sheetPx, panelPx, collapsed, cornerPx],
  );

  // Нижняя граница свободного окна едет в CSS-переменной НА КОРНЕ шелла — но
  // КАНВАСА она не касается. Её читает только то, что экран кладёт ПОВЕРХ карты
  // (плавающие кнопки): иначе каждая такая кнопка заведёт своё представление о
  // том, где кончается свободное место, — то самое, ради чего шелл и заведён.
  //
  // Левой границы здесь нет НАМЕРЕННО: её сейчас не читает никто (панель на
  // десктопе, а плавающие контролы там либо справа, либо скрыты), а переменная
  // без читателя — мёртвый механизм, который следующий разработчик примет за
  // работающий. Появится читатель — появится и она.
  const rootStyle = useMemo(() => ({
    '--mapshell-bottom': `${box.slotBottom}px`,
    '--surface-settle': `${SURFACE_SETTLE_MS}ms`,
    '--surface-ease': SURFACE_EASE_CSS,
  }), [box]);

  return (
    <div className={['mapshell', className].filter(Boolean).join(' ')} ref={rootRef} style={rootStyle}>
      <div className="mapshell__map">{typeof map === 'function' ? map(box.camera, box.slotBottom) : map}</div>

      {panel && (isPhone ? (
        <PeekSheet
          detents={detents}
          detent={detent}
          onDetentChange={onDetentChange}
          onHeightChange={applySheetPx}
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
            /* `inert` — единственное, что и прячет от скринридера, и ВЫНИМАЕТ ИЗ
               ТАБА. Одного `aria-hidden` мало: свёрнутая панель осталась бы
               проходимой с клавиатуры, а фокус внутри `aria-hidden`-предка
               браузер скрыть отказывается и пишет об этом в консоль.
               Каст — из-за React 18: атрибут он в DOM отдаёт (нераспознанные
               пропы проходят насквозь), а в его типах `inert` появился только в
               19-м. */
            {...(collapsed ? /** @type {any} */ ({ inert: '' }) : null)}
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
            /* ★ ПОЗИЦИЮ ДЕРЖИТ ОБЁРТКА, А НЕ КНОПКА, И ЭТО НЕ УКРАШЕНИЕ.
               Подсказка оборачивает триггер своим узлом `span.tt`, а тот объявлен
               `position: relative` НИЖЕ по таблице стилей — то есть перебил бы
               `absolute` у кнопки, и она уехала бы из шва в начало потока. Плюс
               сворачивание панели ловится СОСЕДНИМ селектором
               (`.mapshell__panel[data-collapsed] ~ .mapshell__toggle`), а сосед
               здесь — именно этот узел. Сторона `bottom`: кнопка стоит по центру
               шва, и пузырь снизу не накрывает карту, которую она открывает.
               Текст даёт ЭКРАН — у планировщика сворачивается шаг, у редактора
               маршрут, и примитив не вправе называть чужой предмет.
               ⚠️ Угловые скобки в этом комментарии писать НЕЛЬЗЯ: гард 2d читает
               НАПИСАНИЕ, и пара тегов с текстом между ними читается им как сырая
               JSX-строка — ровно на этом красный чек и приехал. */
            <div className="mapshell__toggle">
              <Tooltip content={collapsed ? expandLabel : collapseLabel} side="bottom">
                <IconBtn
                  icon={collapsed ? 'chev' : 'chevL'}
                  tone="outline"
                  ariaLabel={collapsed ? expandLabel : collapseLabel}
                  ariaExpanded={!collapsed}
                  onClick={() => onCollapsedChange(!collapsed)}
                />
              </Tooltip>
            </div>
          )}
        </>
      ))}

      {children}
    </div>
  );
}

export default MapShell;
