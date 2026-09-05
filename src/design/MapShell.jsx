// @ts-check
import React, { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { Card } from './index.jsx';
import { Tooltip } from './Tooltip';
import { IconBtn } from './IconBtn';
import { PeekSheet } from '@/components/ui/PeekSheet';
import { ScreenRiseProvider, useScreenRiseHost } from '@/components/ui/sheetShell';
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
 * ★★ ЧТО ЗАКРЫТО — РЕШАЕТ ОСЬ, А НЕ ПЛАТФОРМА. Панель режет ШИРИНУ: кадр
 * уводится отступом КАМЕРЫ, карта видна и под виджетом. Шит режет ВЫСОТУ: кадр
 * уводит СДВИГ холста, а отступ камеры остаётся нулевым — `transform.padding`
 * на проекции `globe` рисует планету диском. Разбор — `lib/mapShellInsets.js`.
 *
 * ★★★ РАЗМЕР ХОЛСТА НЕ МЕНЯЕТСЯ НИКОГДА — ХОЛСТ УЕЗЖАЕТ. Ресайз двигает мир на
 * половину дельты и роняет шар (вид пришпилен к центру холста), а каждый его
 * кадр — переаллокация GL-буфера. Сдвиг не делает ни того, ни другого: размер
 * постоянен, а центр холста при сдвиге на половину шита встаёт ровно в центр
 * СВОБОДНОГО окна. Низ холста при этом всегда под шитом, поэтому полосы фона
 * между картой и шитом не бывает ни на одном кадре жеста.
 *
 * ★★★ ВСЁ, ЧТО ЕДЕТ, ЕДЕТ ОДНИМ ТЕМПОМ: шит и панель (CSS transform) приезжают
 * за `SURFACE_SETTLE_MS` по одной кривой. Шелл публикует темп переменными на
 * своём корне, CSS их читает — тем же приёмом, каким нижний нав публикует свою
 * высоту. Камеры в этом перечне БОЛЬШЕ НЕТ: смена свободного окна её не двигает
 * (разбор — `lib/map/useMapInsets.js`), поэтому и ехать ей не с чем.
 *
 * Телефон — панель уезжает в `<PeekSheet>` с детентами; десктоп — плавающая
 * колонка слева, которую можно свернуть (кнопка на шве панели и карты).
 *
 *   <MapShell
 *     map={(view) => <MapView view={view} … />}
 *     panel={<RoutePanel/>} panelLabel="Маршрут"
 *     detents={[0.15, 0.68, 1]} detent={i} onDetentChange={setI}
 *   />
 */

/** Воздух между атрибуцией mapbox и кромкой шита (px). */
const ATTRIB_AIR = 10;

/**
 * `map` — узел ИЛИ функция `(view) => node`, где `view` = `{ camera, fit }`.
 * ДВЕ коробки, по одной на роль: `camera` — чем сдвигаем камеру, `fit` — во что
 * вписываем маршрут. На телефоне первая нулевая (вид уводит сдвиг холста), и
 * без второй фит вписывал бы маршрут во весь холст, то есть наполовину под шит.
 * Одним объектом, а не двумя аргументами: позиционные уже стоили дефекта —
 * экран forwardил первый и молча терял второй, и ни один гард этого не видит.
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
  //
  // ★★ НА ТЕЛЕФОНЕ ЭТОТ СЛОЙ — СОДЕРЖИМОЕ ТОГО ЖЕ ШИТА, А НЕ ВТОРАЯ ПОВЕРХНОСТЬ
  // ПОВЕРХ НЕГО. Панель города/события открывается ПОДРОБНОСТЬЮ того, на что
  // смотрят, поэтому у экрана остаётся ОДИН шит, а панель — его слой: рост берётся
  // сам собой (тот же детент), поднять её до полного экрана можно тем же жестом,
  // карта под ней остаётся живой (шит немодален), а скролл идёт по тому же
  // правилу, что и у списка маршрута.
  // ⚠️ ВТОРАЯ ПОВЕРХНОСТЬ ЗДЕСЬ УЖЕ БЫЛА, И ОНА ПРОИГРЫВАЕТ ПО ПОСТРОЕНИЮ:
  // модальная шторка vaul гасит карту скримом, лочит страницу, не умеет
  // детентов — и не отдаёт свою коробку: после любого касания она ставит инлайн
  // `transition: transform`, так что любая наша анимация её высоты играет ровно
  // до первого касания пальцем.
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
  // Слой открыт — факт от экрана (`overlayActive`), а не «отрисован ли узел»:
  // рендер живёт дольше (уходящий слой доигрывает анимацию), и шит на телефоне
  // менял бы состав на 240 мс позже закрытия.
  const layerOpen = isPhone && overlayActive && !!panelOverlay;

  // ★★ «МНЕ НУЖЕН ВЕСЬ ЭКРАН» ИСПОЛНЯЕТ ТОТ, КТО ВЛАДЕЕТ ВЫСОТОЙ. Форма внутри
  // панели (`EventEditDialog` → `useScreenRise`) заявляет потребность; для шита
  // «весь экран» — это верхний детент, то есть его штатное движение, тем же
  // темпом и той же кривой, что и любое другое. Закрылась форма — шит вернулся
  // туда, где стоял: детент экрана принадлежит человеку, а не панели.
  const { screenAsked, claimScreen } = useScreenRiseHost();
  const beforeRise = useRef(/** @type {number | null} */ (null));
  useEffect(() => {
    if (!isPhone || !onDetentChange) return;
    if (screenAsked) {
      const top = Math.max(0, detents.length - 1);
      if (beforeRise.current == null) beforeRise.current = detent;
      if (detent !== top) onDetentChange(top);
      return;
    }
    const back = beforeRise.current;
    beforeRise.current = null;
    if (back != null && back !== detent) onDetentChange(back);
    // Зависимость намеренно ОДНА: реагируем на смену ЗАЯВКИ, а не на каждое
    // движение шита. Иначе человек, опустивший шит при открытой форме, тут же
    // получал бы его обратно наверх — то есть жест переставал бы работать.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [screenAsked, isPhone]);
  const rootRef = useRef(/** @type {HTMLDivElement | null} */ (null));
  const panelRef = useRef(/** @type {HTMLElement | null} */ (null));
  const [sheetPx, setSheetPx] = useState(0);
  const [capPx, setCapPx] = useState(0);
  const [panelPx, setPanelPx] = useState(0);

  // ★ ОСЕВШАЯ ВЫСОТА ШИТА ПРИМЕНЯЕТСЯ СРАЗУ, БЕЗ ОТКЛАДЫВАНИЯ. Задержка здесь
  // была, пока слот карты РЕЗАЛСЯ шитом: обрежь холст раньше, чем шит доедет, и
  // между ними откроется полоса фона (замер: до 351 px на 160 мс). Холст больше
  // не режется — он во всю площадь и уезжает целиком, его низ всегда под шитом,
  // полосе взяться неоткуда. Задержка вместе с её правилом снята: механизм без
  // причины следующий читатель принял бы за работающий.
  const applySheetPx = useCallback((next, cap) => { setCapPx(cap || 0); setSheetPx(next); }, []);

  // Ширину панели МЕРЯЕМ, а не берём из константы: она задана в CSS
  // (`--mapshell-panel-w`, там `min()` от вьюпорта), и продублированное в JS
  // число разъехалось бы с ней на первой же правке раскладки.
  // Живой сдвиг холста — мимо React (разбор у пропа `onHeightLive` шита).
  // Пока идёт жест, темп нулевой: холст уже там, где палец. На осадке темп
  // возвращается, и остаток пути доезжает той же кривой, что и шит.
  const onSheetLive = useCallback((px, phase, cap) => {
    const root = rootRef.current;
    if (!root) return;
    root.style.setProperty('--surface-settle', phase === 'end' ? `${SURFACE_SETTLE_MS}ms` : '0ms');
    // Тем же правилом, что и на осадке: одна формула на оба пути, иначе они
    // разъедутся на первой же правке (`mapShellInsets`).
    const { shift } = mapShellInsets({ phone: true, sheetPx: px, capPx: cap });
    root.style.setProperty('--mapshell-shift', `${shift}px`);
    root.style.setProperty('--mapshell-attrib', `${shift + ATTRIB_AIR}px`);
  }, []);

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
    () => mapShellInsets({ phone: isPhone, sheetPx, capPx, panelPx, overlayOpen: overlayActive, collapsed }),
    [isPhone, sheetPx, capPx, panelPx, overlayActive, collapsed],
  );

  // Нижняя граница свободного окна едет в CSS-переменной НА КОРНЕ шелла: одно
  // объявление на всех, кому нужно знать, где кончается свободное место, —
  // иначе каждый читатель заведёт своё представление, то самое, ради чего шелл и
  // заведён. Сегодня её читает САМ СЛОТ (`.mapshell__map`); плавающих кнопок,
  // читавших её, не осталось (последняя — виджет проблем редактора — снята).
  //
  // Левой границы здесь нет НАМЕРЕННО: её сейчас не читает никто (панель на
  // десктопе, а плавающие контролы там либо справа, либо скрыты), а переменная
  // без читателя — мёртвый механизм, который следующий разработчик примет за
  // работающий. Появится читатель — появится и она.
  // ★ КАРТЕ ОТДАЁМ ОДИН ОБЪЕКТ, А НЕ НЕСКОЛЬКО АРГУМЕНТОВ. Позиционные уже
  // стоили дефекта: экран forwardил первый и молча терял второй (коробку «во что
  // вписывать») — маршрут вписывался во весь холст, и обе точки оказывались за
  // кромкой шита. Ни один гард такого не видит: пропа нет, значение просто
  // `null`. Один объект делает пропуск невозможным.
  const view = useMemo(() => ({ camera: box.camera, fit: box.fit }), [box]);

  const rootStyle = useMemo(() => ({
    '--mapshell-bottom': `${box.slotBottom}px`,
    // ★ СКОЛЬКО ХОЛСТ УЕЗЖАЕТ ВВЕРХ. Половина закрытой шитом высоты: тогда центр
    // ХОЛСТА (а к нему пришпилен вид) встаёт ровно в центр СВОБОДНОГО окна, а
    // низ холста остаётся под шитом — полосе фона взяться неоткуда. Размер
    // холста при этом не меняется ВООБЩЕ, а только он и двигает шар.
    '--mapshell-shift': `${box.shift}px`,
    // Где обязана стоять атрибуция mapbox: она лежит на дне КАНВАСА, а канвас
    // уехал вверх — поднимаем на ту же величину плюс воздух. Отдельной
    // переменной, а не `calc` у читателя: вне шелла её нет, и правило там
    // вырождается в прежнее положение.
    '--mapshell-attrib': `${box.shift + ATTRIB_AIR}px`,
    '--surface-settle': `${SURFACE_SETTLE_MS}ms`,
    '--surface-ease': SURFACE_EASE_CSS,
  }), [box]);

  // Воздух вокруг шапки — геометрия ШЕЛЛА, и узел у неё один на обе раскладки:
  // второй такой же в соседней ветке разъехался бы с этой на первой же правке.
  const headEl = panelHeader ? <div className="mapshell__head">{panelHeader}</div> : null;

  return (
    <div className={['mapshell', className].filter(Boolean).join(' ')} ref={rootRef} style={rootStyle}>
      <div className="mapshell__map">{typeof map === 'function' ? map(view) : map}</div>

      {panel && (isPhone ? (
        <PeekSheet
          detents={detents}
          detent={detent}
          onDetentChange={onDetentChange}
          onHeightChange={applySheetPx}
          onHeightLive={onSheetLive}
          /* Слой несёт СВОЮ шапку и свой футер (`.lp-h` / `.lp-f`), поэтому
             шапка и действия маршрута на это время уходят: две шапки подряд —
             это не «богато», это непонятно, чей заголовок читаешь. */
          header={layerOpen ? null : headEl}
          footer={layerOpen ? null : panelFooter}
          label={panelLabel}
          layer={layerOpen}
        >
          <ScreenRiseProvider claim={claimScreen}>
            {layerOpen ? panelOverlay : panel}
          </ScreenRiseProvider>
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
              {headEl}
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
