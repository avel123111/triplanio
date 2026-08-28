// @ts-check
import React, { useCallback, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { Card } from './index.jsx';
import { Tooltip } from './Tooltip';
import { IconBtn } from './IconBtn';
import { PeekSheet } from '@/components/ui/PeekSheet';
import { useIsPhone } from '@/hooks/use-mobile';
import { mapShellInsets } from '@/lib/mapShellInsets';
import { SURFACE_EASE_CSS, SURFACE_SETTLE_MS } from '@/lib/surfaceMotion';

/**
 * MapShell — раскладка «карта во всю площадь + панель над ней» (TRIP-422).
 *
 * ★ ЗАЧЕМ ПРИМИТИВ, А НЕ ВЁРСТКА ЭКРАНА. Такая раскладка уже в третьем месте
 * (планировщик, линза карты, редактор маршрута), и все три написали её
 * по-своему: свои классы, свои брейкпоинты, своё представление о том, где
 * заканчивается карта. Здесь она одна, и вместе с ней один ответ на главный
 * вопрос — СКОЛЬКО МЕСТА НА ЭКРАНЕ СВОБОДНО.
 *
 * ★★ ЗАКРЫТАЯ ПЛОЩАДЬ — ВСЕГДА ОТСТУП КАМЕРЫ, НА ОБЕИХ ОСЯХ И ОБЕИХ ПЛАТФОРМАХ.
 * Холст остаётся во всю площадь шелла и НЕ МЕНЯЕТ РАЗМЕР: панель режет ширину
 * (`camera.left`), шит режет высоту (`camera.bottom`), карта лежит под ними
 * обоими. Прежде высоту забирал сам слот — разбор, чем это стоило, в
 * `lib/mapShellInsets.js`; коротко: холст нельзя менять плавно, а шит едет за
 * пальцем, и между ними открывалась полоса фона.
 *
 * ★★★ ВСЁ, ЧТО ЕДЕТ, ЕДЕТ ОДНИМ ТЕМПОМ: шит и панель (CSS transform) и камера
 * карты (`easeTo`) приезжают за `SURFACE_SETTLE_MS` по одной кривой. Шелл
 * публикует темп переменными на своём корне, CSS их читает — тем же приёмом,
 * каким нижний нав публикует свою высоту.
 *
 * Телефон — панель уезжает в `<PeekSheet>` с детентами; десктоп — плавающая
 * колонка слева, которую можно свернуть (кнопка на шве панели и карты).
 *
 *   <MapShell
 *     map={(camera) => <MapView camera={camera} … />}
 *     panel={<RoutePanel/>} panelLabel="Маршрут"
 *     detents={[0.15, 0.68, 1]} detent={i} onDetentChange={setI}
 *   />
 */

/**
 * `map` — узел ИЛИ функция `(camera) => node`. Аргумент ОДИН, и это главное
 * следствие модели: свободное окно целиком выражено отступом камеры, обе оси
 * одной величиной, а слот карты равен шеллу всегда.
 *
 * @param {{
 *   map: any,
 *   panel?: any,
 *   panelHeader?: any,
 *   panelFooter?: any,
 *   panelLabel: string,
 *   panelOverlay?: any,
 *   overlayActive?: boolean,
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
  // ЛОГИЧЕСКОЕ «слой открыт» для КАМЕРЫ — отдельно от `panelOverlay` (рендера).
  // Рендер живёт дольше: уходящий слой доигрывает анимацию ещё ~240 мс, и если бы
  // камера читала `!!panelOverlay`, отступ менялся бы на 240 мс ПОЗЖЕ закрытия —
  // уже после окна focus-driven — и обрывал бы летящий `calmFit`. Экран отдаёт
  // сюда факт открытости (сразу), а не присутствие узла.
  overlayActive = false,
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

  // ★ ЖИВОЙ КАНАЛ ЗАКРЫТОЙ ПЛОЩАДИ — МИМО REACT, И ЭТО НЕСУЩЕЕ. Пока палец ведёт
  // шит, свободное окно меняется каждый кадр. Состояние на кадр жеста стоило бы
  // перекладки всей панели, поэтому живая величина идёт подпиской: карта на неё
  // подписывается и двигает камеру сама (`lib/map/useMapInsets.js`), а шелл тем
  // же кадром обновляет свою переменную для того, что лежит поверх карты.
  // Зафиксированная высота по-прежнему едет состоянием — она и остаётся истиной.
  const subsRef = useRef(/** @type {Set<(px: number, phase: string) => void>} */ (new Set()));
  const live = useMemo(() => ({
    subscribe: (fn) => { subsRef.current.add(fn); return () => { subsRef.current.delete(fn); }; },
  }), []);
  const onSheetLive = useCallback((px, phase) => {
    const root = rootRef.current;
    const v = Math.round(px);
    if (root) {
      // Темп ставим ДО величины: на кадре жеста ехать нечему (всё уже там, где
      // палец), а на осадке — наоборот, оставшийся путь обязан доехать плавно,
      // и переключить темп нужно раньше, чем задать цель.
      root.style.setProperty('--surface-settle', phase === 'end' ? `${SURFACE_SETTLE_MS}ms` : '0ms');
      root.style.setProperty('--mapshell-bottom', `${v}px`);
    }
    subsRef.current.forEach((fn) => fn(v, phase));
  }, []);

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
  const box = useMemo(
    () => mapShellInsets({ phone: isPhone, sheetPx, panelPx, overlayOpen: overlayActive, collapsed }),
    [isPhone, sheetPx, panelPx, overlayActive, collapsed],
  );

  // Нижняя граница СВОБОДНОГО ОКНА едет в CSS-переменной НА КОРНЕ шелла: одно
  // объявление на всех, кому нужно знать, где кончается свободное место, —
  // иначе каждый читатель заведёт своё представление, то самое, ради чего шелл и
  // заведён. Холст её больше НЕ читает (он во всю площадь всегда); читают те,
  // кто лежит ПОВЕРХ карты и обязан остаться на виду: пилюля планировщика
  // (`.flow-map__stat`) и обязательная атрибуция mapbox.
  //
  // Левой границы здесь нет НАМЕРЕННО: её сейчас не читает никто (панель на
  // десктопе, а плавающие контролы там либо справа, либо скрыты), а переменная
  // без читателя — мёртвый механизм, который следующий разработчик примет за
  // работающий. Появится читатель — появится и она.
  const rootStyle = useMemo(() => ({
    '--mapshell-bottom': `${box.contentBottom}px`,
    '--surface-settle': `${SURFACE_SETTLE_MS}ms`,
    '--surface-ease': SURFACE_EASE_CSS,
  }), [box]);

  return (
    <div className={['mapshell', className].filter(Boolean).join(' ')} ref={rootRef} style={rootStyle}>
      <div className="mapshell__map">{typeof map === 'function' ? map(box.camera, live) : map}</div>

      {panel && (isPhone ? (
        <PeekSheet
          detents={detents}
          detent={detent}
          onDetentChange={onDetentChange}
          onHeightChange={setSheetPx}
          onHeightLive={onSheetLive}
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
          {/* Слой города/события — НЕЗАВИСИМ от колонки панели (TRIP-195 доводка):
              он сосед `.mapshell__panel`, а не её потомок, поэтому сворачивание
              маршрута (`transform`/`inert` на колонке) его НЕ прячет и НЕ выносит
              из таба. Открыт маршрут — слой ложится поверх него; свёрнут — тот же
              слой открывается сам по себе. Коробка та же (левый столбец шелла). */}
          {panelOverlay ? <div className="mapshell__overlay">{panelOverlay}</div> : null}
        </>
      ))}

      {children}
    </div>
  );
}

export default MapShell;
