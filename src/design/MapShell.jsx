// @ts-check
import React, { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
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
 *     panelLabel="Маршрут" onSlot={registerSlot}
 *     detents={[0.15, 0.68, 1]} detent={i} onDetentChange={setI}
 *   />
 *   …и экран: <ShellSlot name="panelBody"><RoutePanel/></ShellSlot>
 */

/**
 * `map` — узел ИЛИ функция `(view) => node`, где `view` = `{ camera, fit }`; пока
 * поверхность не измерена, обе коробки — `null` (разбор — у `panelPx` ниже):
 * «не измерено» карта отличает от «отступов нет» (`undefined`, карта без шелла).
 * ДВЕ коробки, по одной на роль: `camera` — чем сдвигаем камеру, `fit` — во что
 * вписываем маршрут. На телефоне первая нулевая (вид уводит сдвиг холста), и
 * без второй фит вписывал бы маршрут во весь холст, то есть наполовину под шит.
 * Одним объектом, а не двумя аргументами: позиционные уже стоили дефекта —
 * экран forwardил первый и молча терял второй, и ни один гард этого не видит.
 *
 * ★ СЛОТЫ (TRIP-520). Содержимое панели шелл больше не получает пропами: он
 * держит УЗЛЫ (шапка панели, тело, футер, слой над панелью, статус-полоса,
 * площадь над картой) и отдаёт их хосту через `onSlot(name, el)`, а экран
 * рендерит в них порталом (`ShellSlot`). Так шелл живёт дольше экрана: на
 * переходе визард → маршрут узлы те же, меняется только их содержимое.
 *
 * @param {{
 *   map: any,
 *   panelLabel: string,
 *   onSlot?: (name: string, el: HTMLElement | null) => void,
 *   insetTop?: number,
 *   overlayActive?: boolean,
 *   detents?: number[],
 *   detent?: number,
 *   onDetentChange?: (i: number) => void,
 *   collapsed?: boolean,
 *   onCollapsedChange?: (v: boolean) => void,
 *   collapseLabel?: string,
 *   expandLabel?: string,
 *   className?: string,
 * }} p
 */
/** Воздух между атрибуцией mapbox и кромкой шита (px). */
const ATTRIB_AIR = 10;

export function MapShell({
  map,
  panelLabel,
  // Слоты (см. шапку файла):
  //   panelHead    — шапка панели: то, что видно, когда шит опущен на нижний
  //                  детент (и что на десктопе стоит над телом). Опущенный шит
  //                  без шапки — безымянная полоска. Воздух вокруг шапки даёт
  //                  ШЕЛЛ (`.mapshell__head`), а не экран: это геометрия его
  //                  коробки, и экран, повторяющий её, разъезжается с ней на
  //                  первой же правке.
  //   panelBody    — скроллящееся тело панели.
  //   panelFoot    — панель действий (кнопки шага): на виду при любом скролле
  //                  тела, поэтому слот отдельный, а не «последний ребёнок».
  //   panelOverlay — слой ПОВЕРХ панели во всю её высоту (ящик города/события у
  //                  редактора). Закрывает ровно панель и не трогает карту — по
  //                  ней в этот момент продолжают кликать. Соседствует с
  //                  колонкой панели, а не лежит в ней: сворачивание маршрута
  //                  (`transform`/`inert` на колонке) его не прячет.
  //   status       — полоса статуса у низа свободного окна (пилюля «N городов ·
  //                  M ночей»). Шелл МЕРЯЕТ её и отдаёт кадру как закрытое
  //                  снизу: раньше карта мерила пилюлю сама, дотягиваясь в
  //                  чужой класс, и нижний город кадра уезжал под неё, пока
  //                  замер не поставили (393×852: пин 225..254 против пилюли
  //                  248..279).
  //   mapOverlay   — площадь над картой для плавающих контролов экрана (круглая
  //                  «назад» на телефоне).
  onSlot,
  // Полоса, закрытая над холстом СВЕРХУ хостом (шапка трипа на телефоне лежит
  // над картой — холст одной высоты в визарде и в трипе). Числом от хоста, а не
  // чтением CSS: одна величина ставится и камере, и CSS-переменной раскладки
  // (`--mapshell-inset-top`), второго источника нет.
  insetTop = 0,
  // ЛОГИЧЕСКОЕ «слой открыт» для КАМЕРЫ — отдельно от слоя (рендера).
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
}) {
  const isPhone = useIsPhone();
  const rootRef = useRef(/** @type {HTMLDivElement | null} */ (null));
  const panelRef = useRef(/** @type {HTMLElement | null} */ (null));
  const statusRef = useRef(/** @type {HTMLElement | null} */ (null));
  const [sheetPx, setSheetPx] = useState(0);
  const [capPx, setCapPx] = useState(0);
  // Высота полосы статуса — замером (ResizeObserver), а не числом: она сложена
  // из строки и её отступа в CSS, и переписанная сюда константа разъехалась бы с
  // ними молча на первой же правке типографики.
  const [statusPx, setStatusPx] = useState(0);
  // Слот-узлы отдаём хосту callback-ref'ами. Рефы стабильны на имя: новая
  // функция на каждый рендер заставила бы React снимать и ставить узел заново.
  const slotRefs = useRef(/** @type {Record<string, (el: HTMLElement | null) => void>} */ ({}));
  const onSlotRef = useRef(onSlot);
  onSlotRef.current = onSlot;
  const slot = (name) => {
    if (!slotRefs.current[name]) slotRefs.current[name] = (el) => onSlotRef.current?.(name, el);
    return slotRefs.current[name];
  };
  // Слот статуса меряется здесь же — ссылка одна, стабильная (см. `slot`).
  const statusSlot = useCallback((/** @type {HTMLElement | null} */ el) => { statusRef.current = el; onSlotRef.current?.('status', el); }, []);
  const insetTopRef = useRef(insetTop);
  insetTopRef.current = insetTop;
  // ★ «НЕ ИЗМЕРЕНО» ≠ «НОЛЬ». Ширина панели известна только после раскладки
  // (`useLayoutEffect` ниже), а первый рендер шелла идёт до неё. Пока здесь стоял
  // ноль, карта на первом же кадре получала отступ 0 (маршрут центрировался ПОД
  // панелью), а через кадр — измеренные ~620 px, и `useMapInsets` честно ЕХАЛ из
  // одного в другое: 700 мс пана по незагруженным тайлам на каждом входе в
  // редактор («карта дёргается, справа пустая полоса»). Замер: pad 620 → 0 → 48 →
  // 406 → 599 → 620, tiles:false всю дорогу. До замера отступ НЕИЗВЕСТЕН, и карте
  // это отдаётся коробками `null` в `view` — она ничего не трогает; замер приезжает
  // синхронным ре-рендером ДО отрисовки кадра, и первая настоящая величина
  // ставится без движения.
  const [panelPx, setPanelPx] = useState(/** @type {number | null} */ (null));
  // Левый край панели от края холста: всё левее неё закрыто НЕ панелью (рейл
  // трипа лежит над холстом в секциях с картой) и остаётся закрытым, когда
  // панель свёрнута. Меряется вместе с правым краем, одной функцией.
  const [panelOffsetPx, setPanelOffsetPx] = useState(0);

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
    const { shift } = mapShellInsets({ phone: true, sheetPx: px, capPx: cap, topPx: insetTopRef.current });
    root.style.setProperty('--mapshell-shift', `${shift}px`);
    root.style.setProperty('--mapshell-attrib', `${shift + ATTRIB_AIR}px`);
  }, []);

  const measurePanel = useCallback(() => {
    const root = rootRef.current, el = panelRef.current;
    if (!root || !el) { setPanelPx(0); setPanelOffsetPx(0); return; }
    const r = el.getBoundingClientRect(), b = root.getBoundingClientRect();
    setPanelPx(Math.max(0, Math.round(r.right - b.left)));
    setPanelOffsetPx(Math.max(0, Math.round(r.left - b.left)));
  }, []);

  useLayoutEffect(() => {
    if (isPhone) { setPanelPx(0); setPanelOffsetPx(0); return undefined; }
    measurePanel();
    const ro = typeof ResizeObserver !== 'undefined' ? new ResizeObserver(measurePanel) : null;
    if (ro && panelRef.current) ro.observe(panelRef.current);
    window.addEventListener('resize', measurePanel);
    return () => { if (ro) ro.disconnect(); window.removeEventListener('resize', measurePanel); };
  }, [isPhone, measurePanel]);

  // Полоса статуса: ноль, пока слот пуст (пилюли нет, ноль ночей).
  useLayoutEffect(() => {
    const el = statusRef.current;
    if (!el) return undefined;
    const measure = () => setStatusPx(Math.round(el.getBoundingClientRect().height));
    measure();
    const ro = typeof ResizeObserver !== 'undefined' ? new ResizeObserver(measure) : null;
    if (ro) ro.observe(el);
    return () => { if (ro) ro.disconnect(); };
  }, []);

  // Закрытая площадь — чистая функция (закрыта тестами): у правила «карта
  // кадрируется по свободному окну» нет скриншота, а его поломка не роняет ни
  // экран, ни гарды.
  //
  // ★ ЗАМЕР ПАНЕЛИ НЕ ЗАВИСИТ ОТ СВЁРНУТОСТИ, И ЭТО НАМЕРЕННО. Свёрнутая панель
  // уезжает `transform`-ом — её ширина не меняется, и «померить свёрнутую» дало
  // бы правильный ответ по случайности. Про свёрнутость знает правило.
  const box = useMemo(
    () => mapShellInsets({ phone: isPhone, sheetPx, capPx, panelPx: panelPx ?? 0, offsetPx: panelOffsetPx, topPx: insetTop, statusPx, overlayOpen: overlayActive, collapsed }),
    [isPhone, sheetPx, capPx, panelPx, panelOffsetPx, insetTop, statusPx, overlayActive, collapsed],
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
  // До замера панели коробки НЕИЗВЕСТНЫ (`null`), а не нулевые — см. `panelPx`.
  // `null` (не измерено) и `undefined` (у поверхности отступов нет вовсе, как у
  // карты без шелла) карта различает: первое ждёт, второе — честный ноль.
  const view = useMemo(() => (panelPx === null ? { camera: null, fit: null } : { camera: box.camera, fit: box.fit }), [box, panelPx]);

  const rootStyle = useMemo(() => ({
    '--mapshell-bottom': `${box.slotBottom}px`,
    // Закрытая сверху полоса — раскладке (контролы над картой встают под ней).
    '--mapshell-inset-top': `${insetTop}px`,
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
  }), [box, insetTop]);

  // Шапка панели — узел ШЕЛЛА и на десктопе, и в шите: ссылка на слот у него.
  const head = <div className="mapshell__head" ref={slot('panelHead')} />;
  const foot = <div ref={slot('panelFoot')} />;

  return (
    <div className={['mapshell', className].filter(Boolean).join(' ')} ref={rootRef} style={rootStyle}>
      {/* Слот карты — и площадь для плавающих контролов экрана: они лежат в нём
          соседями узла карты, поверх неё. */}
      <div className="mapshell__map" ref={slot('mapOverlay')}>{typeof map === 'function' ? map(view) : map}</div>

      {isPhone ? (
        <PeekSheet
          detents={detents}
          detent={detent}
          onDetentChange={onDetentChange}
          onHeightChange={applySheetPx}
          onHeightLive={onSheetLive}
          onBodyRef={slot('panelBody')}
          header={head}
          footer={foot}
          label={panelLabel}
        />
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
              {head}
              <div className="mapshell__body scrollbar-thin" ref={slot('panelBody')} />
              {foot}
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
              из таба. Коробка та же (левый столбец шелла). Пустой слот раскладка
              не показывает (`:empty`), чтобы он не ловил клики над панелью. */}
          <div className="mapshell__overlay" ref={slot('panelOverlay')} />
        </>
      )}

      {/* Полоса статуса у низа свободного окна — над шитом на телефоне, у низа
          холста на десктопе. Меряется в закрытое кадру (см. `statusPx`). */}
      <div className="mapshell__status t-meta" ref={statusSlot} />
    </div>
  );
}

export default MapShell;
