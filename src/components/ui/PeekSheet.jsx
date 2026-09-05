import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { SHEET_CONTROL_SELECTOR, gestureOwner, nearestDetent, resolveDetents, tapSettles } from '@/lib/sheetDetents';
import { SURFACE_EASE_CSS, SURFACE_SETTLE_MS } from '@/lib/surfaceMotion';
import { cssPx } from '@/lib/cssPx';
import { focusInside, useKeyboardMine } from '@/lib/keyboardOpen';
import { SHEET_SCROLLER_SEL } from '@/components/ui/sheetShell';

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

// ★ ВЫСОТУ НИЖНЕГО НАВА ЗАДАЁТ ЭКРАН, А НЕ ПРИМИТИВ. Зашитая константа здесь
// была прямой ошибкой: под линзами трипа нав есть, а в планировщике его нет
// вовсе — и эти «60px на всякий случай» превращались в пустую полосу под
// футером. Примитив знает только про домашнюю полоску (она есть везде), про
// чужой нав ему обязан сказать вызыватель.
const FLICK_VELOCITY = 0.3; // px/мс на отпускании, выше которого бросок решает направление

// Инсет домашней полоски в px (env() из JS не прочитать).
/**
 * ★ ВЫСОТА ВЬЮПОРТА — ЭТО `visualViewport`, А НЕ `window.innerHeight`.
 * Клавиатура на мобиле сжимает ИМЕННО визуальный вьюпорт, и весь проект уже
 * считает истиной его (`src/lib/keyboardOpen.js` ловит клавиатуру по нему же).
 * `innerHeight` при этом может не измениться вовсе — тогда шит остаётся
 * рассчитанным на полный экран, его нижняя часть уходит под клавиатуру, а
 * видимая полоса оказывается пустой. Ровно этот дефект и приехал со скрина.
 */
function viewportH() {
  if (typeof window === 'undefined') return 0;
  return Math.round(window.visualViewport?.height || window.innerHeight || 0);
}

/**
 * Насколько визуальный вьюпорт СМЕЩЁН вниз относительно раскладочного. На
 * Chrome раскладка сжимается вместе с видимой областью и смещение там ноль; где
 * браузер вместо сжатия СДВИГАЕТ окно (iOS-движок), без этого слагаемого низ
 * шита оказался бы под клавиатурой.
 * ⚠️ Замер на устройстве: `offsetTop` держался нулём весь сеанс — слагаемое это
 * защита ценой в ноль, а не измеренная необходимость.
 */
function viewportTop() {
  if (typeof window === 'undefined') return 0;
  return Math.round(window.visualViewport?.offsetTop || 0);
}

/* «Чья клавиатура» живёт в доме клавиатуры (`lib/keyboardOpen`): тот же вопрос
   решает и полноростная поверхность, дорастая до экрана, — а два предиката
   «мой ли это фокус» разъехались бы на первой же правке. */

/**
 * `header` — то, что видно на САМОМ НИЖНЕМ детенте (и зона перетаскивания):
 * шапка обязана читаться, когда шит опущен, иначе опущенный шит превращается в
 * безымянную полоску. `children` — тело, оно скроллится. `footer` — панель
 * действий: она обязана оставаться на виду при любом скролле тела, поэтому
 * стоит СНАРУЖИ скролл-области, а не в её конце.
 *
 * @param {{
 *   header?: any,
 *   footer?: any,
 *   children?: any,
 *   detent?: number,
 *   onDetentChange?: (i: number) => void,
 *   detents?: number[],
 *   onHeightChange?: (px: number, capPx: number) => void,
 *   onHeightLive?: (px: number, phase: 'move' | 'end', capPx: number) => void,
 *   label: string,
 *   className?: string,
 *   layer?: boolean,
 * }} p
 */
export function PeekSheet({
  header,
  footer = null,
  children,
  detent = 0,
  onDetentChange,
  detents = [0.15, 1],
  onHeightChange,
  // ★ ВЫСОТА ВО ВРЕМЯ ЖЕСТА, КАДР В КАДР. `onHeightChange` отдаёт только
  // ЗАФИКСИРОВАННУЮ высоту детента — этого хватает списку, но не хватает карте:
  // пока палец ведёт шит, свободное окно меняется каждый кадр. Канал ОТДЕЛЬНЫЙ
  // и идёт МИМО React: состояние на кадр жеста стоило бы перекладки всего
  // содержимого шита. Читатель у него один — CSS-переменная сдвига холста, а
  // сдвиг это `transform`: ни ресайза, ни команд камере.
  onHeightLive,
  label,
  className = '',
  // ★ ВНУТРИ ЛЕЖИТ СЛОЙ, КОТОРЫЙ СКРОЛЛИТ СЕБЯ САМ (панель города/события у
  // редактора). Тогда тело шита — коробка, а не скроллер: два вложенных
  // скроллера дают жест, который «залипает» между ними, и футер панели уезжает
  // в прокрутку вместе с содержимым. Факт объявляет ВЛАДЕЛЕЦ шита признаком, а
  // не CSS-запрос по содержимому (`:has`): содержимое здесь сменяется на живом
  // экране — маршрут ↔ панель, — и вывод из него отвалился бы ровно в момент
  // смены (та же грабля, что стоила перезапуска въезда шторки).
  layer = false,
}) {
  const sheetRef = useRef(null);
  const headRef = useRef(null);
  const bodyRef = useRef(null);
  const footRef = useRef(null);
  const drag = useRef(null);
  // Полоса шапки (грип + header + док + safe-area) и высота вьюпорта — обе
  // измеряются, а не задаются числом: шапка у каждого экрана своя.
  const [headPx, setHeadPx] = useState(96);
  const [dockPx, setDockPx] = useState(0);
  const [footPx, setFootPx] = useState(0);
  const [vh, setVh] = useState(viewportH);
  const [vTop, setVTop] = useState(viewportTop);
  const [dragY, setDragY] = useState(null); // px, пока палец на экране; иначе null

  // Доли → пиксели: один расчёт на рендер, он же кормит жест и стили.
  // ★ НИЖНИЙ РЕЗЕРВ — ОДНА ВЕЛИЧИНА, А НЕ СУММА ДВУХ. Измеренная высота футера
  // УЖЕ включает его отступ под док (`padding-bottom: --nav-dock-h`), поэтому
  // складывать футер с доком значит вычесть док дважды — ровно из-за этого
  // содержимое кончалось на 120px выше дна, а футер повисал посреди шита.
  // Футера нет — резерв держит сам док, чтобы шапка не ушла под нижний нав.
  const reservePx = footPx > 0 ? footPx : dockPx;
  // Нижний детент обязан вмещать ВСЁ, что не скроллится: шапку и этот резерв.
  // Иначе «15%» показывает обрезанный заголовок — то есть выглядит как сломанный
  // шит, а не как маленький.
  const minPx = headPx + reservePx;
  const stops = useMemo(() => resolveDetents(detents, vh, minPx), [detents, vh, minPx]);
  // Потолок для того, кто двигает КАРТУ: второй сверху детент. Верхний закрывает
  // экран целиком, и двигать под ним нечего. Считается здесь, потому что детенты
  // считает шит — второй копии `resolveDetents` в проекте быть не должно.
  const capOf = (st) => (st.length ? st[Math.max(0, st.length - 2)] : 0);
  const capPx = capOf(stops);
  // ★ КЛАВИАТУРА ПОДНИМАЕТ ШИТ НА ВЕРХНИЙ ДЕТЕНТ — НО ТОЛЬКО СВОЯ.
  // Видимая область сжата, и «как было» в ней — это полоска с обрезанным
  // содержимым; поле, ради которого клавиатуру открыли, оказывается за кадром.
  // Детент ЭКРАНА при этом не трогаем: закрылась клавиатура — шит вернулся туда,
  // где его оставили.
  //
  // ⚠️ «СВОЯ» — НЕСУЩЕЕ СЛОВО, И ЕГО ТУТ НЕ БЫЛО. Правило писалось, когда поле
  // ввода жило ВНУТРИ этого шита, и тогда «клавиатура открыта» и «клавиатура
  // моя» совпадали. Сегодня поле уехало в шторку, которая ложится ПОВЕРХ шита
  // (пикер города в планировщике и в редакторе маршрута), и глобальный флаг стал
  // врать: клавиатуру поднимает ЧУЖАЯ поверхность, а прыгает — этот шит. Снаружи
  // это выглядит как «экран позади шторки раздёргивается и поднимается», причём
  // сама шторка ни при чём и её правки этого не лечат (проверено четырьмя
  // заходами, TRIP-484 §4).
  // Сам предикат (владение фокусом + подписка на `focusin`, а не чтение DOM в
  // рендере) живёт в доме клавиатуры — `lib/keyboardOpen`: тот же вопрос решает
  // полноростная поверхность, дорастая до экрана под ввод, и двух ответов на
  // него быть не должно.
  const keyboardMine = useKeyboardMine(sheetRef);
  const index = keyboardMine ? stops.length - 1 : Math.max(0, Math.min(stops.length - 1, detent));
  const sheetH = stops[index] ?? 0;
  const restY = Math.max(0, vh - sheetH) + vTop;

  // Свежие пропы для однажды навешанных нативных слушателей.
  const live = useRef();
  live.current = { index, stops, vh, onDetentChange, onHeightLive, capOf };

  // ★ ДОК СЧИТАЕТСЯ РОВНО ОДИН РАЗ. Полоса шапки — это ТОЛЬКО грип + header;
  // нижний нав и домашняя полоска сюда НЕ входят. Прошлая редакция добавляла их
  // и сюда (наследие двух-детентного peek'а), и в футере — экран терял 120px:
  // тело кончалось выше дна, а футер повисал посреди шита. Док нужен в ДВУХ
  // ролях, и они разные: он поднимает МИНИМАЛЬНЫЙ детент (чтобы заголовок не
  // ушёл под нав) и держит отступ ФУТЕРА. Высота тела к нему отношения не имеет.
  const measure = useCallback(() => {
    const sheet = sheetRef.current, head = headRef.current;
    if (!sheet || !head) return;
    const band = head.getBoundingClientRect().bottom - sheet.getBoundingClientRect().top;
    setHeadPx(Math.round(band));
    // Полосу нижнего нава публикует сам нав (`--nav-dock-h`, safe-area уже
    // внутри). Пропа `dock` не осталось: экран не обязан знать чужую высоту.
    setDockPx(Math.round(cssPx('var(--nav-dock-h, 0px)')));
    setFootPx(Math.round(footRef.current?.getBoundingClientRect().height || 0));
    // ⚠️ ЧУЖАЯ КЛАВИАТУРА — НЕ НАШ ОРИЕНТИР, И ЭТО ВТОРАЯ ПОЛОВИНА ТОГО ЖЕ
    // ПРАВИЛА. Детенты считаются долями от `vh`, поэтому одна усадка видимой
    // области пересчитывает ВСЕ ступени и заодно `restY` — то есть шит меняет и
    // высоту, и положение, даже не трогая детент. Под чужой шторкой он обязан
    // стоять там, где стоял: держим последние ЕГО значения.
    // Читаем DOM, а не состояние: `measure` навешан один раз и реактивных
    // значений не видит, а обе величины тут — свойства живого документа.
    if (!(document.documentElement.hasAttribute('data-keyboard') && !focusInside(sheetRef.current))) {
      setVh(viewportH());
      setVTop(viewportTop());
    }
  }, []);

  useLayoutEffect(() => {
    measure();
    const ro = typeof ResizeObserver !== 'undefined' ? new ResizeObserver(measure) : null;
    if (ro && headRef.current) ro.observe(headRef.current);
    if (ro && footRef.current) ro.observe(footRef.current);
    window.addEventListener('resize', measure);
    // Клавиатура двигает ТОЛЬКО визуальный вьюпорт: без этой подписки шит узнаёт
    // о ней в лучшем случае поздно, а на iOS не узнаёт вовсе.
    const vv = window.visualViewport;
    vv?.addEventListener('resize', measure);
    vv?.addEventListener('scroll', measure);
    return () => {
      if (ro) ro.disconnect();
      window.removeEventListener('resize', measure);
      vv?.removeEventListener('resize', measure);
      vv?.removeEventListener('scroll', measure);
    };
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
        startX: e.touches[0].clientX,
        base: Math.max(0, h - (st[i] ?? 0)),
        min: Math.max(0, h - (st[st.length - 1] ?? 0)), // самый высокий детент
        max: Math.max(0, h - (st[0] ?? 0)),             // самый низкий
        last: Math.max(0, h - (st[i] ?? 0)),
        lastY: e.touches[0].clientY, lastT: e.timeStamp, vy: 0,
        // Тянуть шит можно за грип И за шапку (это его ручка) — откуда угодно
        // в них, включая кнопку: палец уже поехал, намерение однозначно.
        onHandle: !!(e.target.closest && e.target.closest('[data-peek-grip],[data-peek-head]')),
        // А вот ТАП по кнопке принадлежит кнопке. Правило разведено в
        // `tapSettles` — разбор там же.
        onControl: !!(e.target.closest && e.target.closest(SHEET_CONTROL_SELECTOR)
          && !e.target.closest('[data-peek-grip]')),
        // ★ СКРОЛЛЕР — ТОТ, НА КОТОРОМ ПАЛЕЦ, А НЕ «ТЕЛО ШИТА». Пока содержимым
        // шита был только список маршрута, это совпадало. Слой панели приносит
        // СВОЙ скроллер (`.lp-b`), и правило, спрашивающее тело, отвечало бы про
        // чужую коробку: тело не скроллится — значит «жест наш» — значит список
        // внутри панели не скроллится ВООБЩЕ. Скроллер называет себя признаком
        // (`data-sheet-scroller`, шов `ui/sheetShell`), поэтому спрашивать его
        // умеет и шит, и полноростная поверхность — одним способом.
        scroller: (e.target.closest && e.target.closest(SHEET_SCROLLER_SEL)) || bodyRef.current,
        mode: 'idle',
      };
    };
    const onMove = (e) => {
      const d = drag.current; if (!d) return;
      const y = e.touches[0].clientY;
      const dy = y - d.startY; // + вниз, − вверх
      if (d.mode === 'idle') {
        if (Math.abs(dy) < 4) return; // ждём намерения
        const dx = e.touches[0].clientX - d.startX; // + вправо, − влево
        // Кому жест — решает чистое правило (закрыто тестами): грип и шапка
        // всегда двигают шит, тело скроллится на ЛЮБОМ детенте, а тяга вниз от
        // самого верха тела опускает шит.
        const body = d.scroller || bodyRef.current;
        d.mode = gestureOwner({
          onHandle: d.onHandle,
          // В содержимом уже тащат карточку (перестановка городов) — жест не наш.
          dragElsewhere: document.documentElement.hasAttribute('data-dragging'),
          // Осевой замок: горизонтальный свайп принадлежит содержимому (лента
          // обложек листается нативным scroll-snap'ом), а не шиту — разбор в
          // `gestureOwner`.
          dx,
          dy,
          scrollTop: body?.scrollTop ?? 0,
          scrollHeight: body?.scrollHeight ?? 0,
          clientHeight: body?.clientHeight ?? 0,
        });
      }
      // «Не наш» — отпускаем жест целиком: ни тянуть, ни гасить событие.
      if (d.mode === 'none') { drag.current = null; setDragY(null); return; }
      if (d.mode !== 'drag') return;
      e.preventDefault();
      const dt = e.timeStamp - d.lastT;
      if (dt > 0) d.vy = (y - d.lastY) / dt;
      d.lastY = y; d.lastT = e.timeStamp;
      const next = Math.max(d.min, Math.min(d.max, d.base + dy));
      d.last = next;
      setDragY(next);
      live.current.onHeightLive?.(Math.max(0, live.current.vh - next), 'move', live.current.capOf(live.current.stops));
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
        // Куда шит ПОЕДЕТ — знаем уже здесь: если детент не сменился, состояние
        // не обновится, и холст иначе остался бы там, куда его увёл палец.
        live.current.onHeightLive?.(st[next] ?? 0, 'end', live.current.capOf(st));
        if (next !== i) cb && cb(next);
      } else if (d.mode === 'idle' && tapSettles(d)) {
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

  // ★ ДВА КАНАЛА, И ЭТО НЕ ДУБЛЬ. Наверх идёт ЗАФИКСИРОВАННАЯ высота детента
  // (`onHeightChange`) — ею считается всё, что требует перекладки; и ЖИВАЯ,
  // кадр в кадр (`onHeightLive`) — её единственный читатель двигает холст
  // `transform`-ом, то есть не платит ни перекладкой, ни ресайзом. Слить их в
  // один канал значит либо потерять плавность, либо перекладывать список на
  // каждом кадре жеста.

  useEffect(() => { onHeightChange && onHeightChange(sheetH, capPx); }, [sheetH, capPx, onHeightChange]);


  const style = {
    '--sheet-y': (dragY ?? restY) + 'px',
    // ★ ВО ВРЕМЯ ЖЕСТА ТЕЛО РОСТОМ С САМЫЙ ВЫСОКИЙ ДЕТЕНТ. От `--sheet-h`
    // считается высота тела; пока она равна ЗАФИКСИРОВАННОМУ детенту,
    // содержимое, которое вот-вот покажется, ещё не существует — и появляется
    // рывком в момент осадки. Держать её по верхнему детенту стоит ОДНОЙ
    // перекладки на жест (а не одной на кадр), зато состав шита при движении
    // не меняется: он просто выезжает из-под края.
    '--sheet-h': (dragY != null ? (stops[stops.length - 1] ?? sheetH) : sheetH) + 'px',
    '--sheet-head': headPx + 'px',
    '--sheet-reserve': reservePx + 'px',
    // ★ ТЕМП ДВИЖЕНИЯ ПУБЛИКУЕТ САМ ШИТ, А CSS ЕГО ЧИТАЕТ. Вместе с шитом
    // обязаны доехать камера карты (JS) и плавающие контролы над ней (CSS) —
    // разными механизмами, но ОДНИМ временем и одной кривой, иначе «плавно» не
    // выйдет ни при каких значениях. Источник — `lib/surfaceMotion.js`; тем же
    // приёмом нижний нав публикует свою высоту (`--nav-dock-h`).
    '--surface-settle': SURFACE_SETTLE_MS + 'ms',
    '--surface-ease': SURFACE_EASE_CSS,
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
      data-layer={layer || undefined}
    >
      {/* Скин «брови» — канон `.sheet-grip`; свой класс несёт только то, чем
          ЭТОТ грип отличается: он функциональный (слайдер по детентам), а не
          декорация, и тянется во всю ширину шита. */}
      <div
        className="peek-sheet__grip sheet-grip"
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
      {/* Своей границы краха тут НЕТ намеренно (TRIP-515): PeekSheet живёт ТОЛЬКО
          внутри маршрута (MapShell на экранах карты), то есть под роутовой/линзовой
          `ErrorBoundary` — она уже изолирует краш этим экраном И восстанавливается
          (retry + сброс по навигации `key={path}`). Синглтон-граница без двери
          здесь только УХУДШИЛА бы восстановление (содержимое гасло бы до ухода с
          экрана). Листовые оверлеи выше маршрута (Toaster/ConsentBanner/Tooltip)
          такой границы не имеют — их и оборачиваем. */}
      <div ref={headRef} className="peek-sheet__head" data-peek-head>{header}</div>
      <div ref={bodyRef} className="peek-sheet__body">{children}</div>
      {footer && <div ref={footRef} className="peek-sheet__foot">{footer}</div>}
    </div>,
    document.body,
  );
}

export default PeekSheet;
