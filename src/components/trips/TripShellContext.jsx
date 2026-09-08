import { createContext, useContext, useLayoutEffect, useSyncExternalStore } from 'react';
import { createPortal } from 'react-dom';

/**
 * КОНТРАКТ ОБОЛОЧКИ ТРИПА — одна поверхность на визард и трип (TRIP-520).
 *
 * ★ ЗАЧЕМ. Визард создания и экран трипа были ДВУМЯ деревьями роутера: на
 * переходе «успех → маршрут» одно размонтировалось, второе монтировалось, и всё,
 * что у них общего — шапка, рейл, панель над картой, сама карта, — собиралось
 * заново. Инстанс карты переживал это (синглтон), а раскладка — нет: панель
 * прыгала на ширину рейла, шапка и панель меняли содержимое одним кадром, и
 * никакая анимация поверх этого не делала переход плавным, потому что
 * анимировать было нечего — старого элемента уже не было.
 *
 * Теперь оболочка (`TripShell`) — ОДИН элемент раскладки роутера на три адреса
 * (`/new-trip`, `/plan-trip-ai`, `/trip/:id`). Экран под ней не рисует ни
 * шапки, ни рейла, ни шелла карты — он ПУБЛИКУЕТ факты, а оболочка рисует. На
 * переходе меняются факты у живых элементов, и каждое изменение едет тем
 * движением, которое у элемента уже есть (транзишн панели, въезд рейла, доезд
 * камеры).
 *
 * Три канала, по частоте изменения:
 *   • факты оболочки (`useShellFacts`)     — шапка и рейл: заголовок, секция,
 *     аддоны, ступень, режим. Меняются редко → состояние оболочки.
 *   • поверхность карты (`useShellSurface`) — конфиг шелла карты (детент,
 *     свёрнутость, подписи) → состояние оболочки; пропы самой карты (ховер,
 *     выбор, пины, фокус) → ОТДЕЛЬНЫЙ стор, на который подписан только хост
 *     карты: наведение на ряд маршрута не должно перерисовывать рейл и шапку.
 *   • слоты (`ShellSlot`)                  — содержимое панели, шапки панели,
 *     футера, слоя над панелью, плавающих контролов над картой, ящика и
 *     оверлеев. Экран рендерит его ПОРТАЛОМ в узел, который держит оболочка:
 *     дерево React остаётся деревом экрана (контекст, границы ошибок, один
 *     рендер), а DOM ложится туда, где его место в раскладке.
 *
 * ★★ ПОЧЕМУ ПУБЛИКАЦИЯ ИДЁТ В `useLayoutEffect`, А НЕ В `useEffect`. Оболочка
 * ре-рендерится синхронно ДО отрисовки кадра: экран, смонтировавшийся в этом
 * коммите, виден уже с правильной шапкой. `useEffect` дал бы кадр со старыми
 * фактами. Уборка эффекта публикует «пусто»: уходящий экран снимает свои
 * факты, приходящий ставит свои — оба в одном коммите, промежуточное «пусто»
 * не рисуется никогда (React сводит обновления фазы layout в один ре-рендер).
 *
 * Колбэки (переход между секциями, «назад», конфирм ухода) едут НЕ состоянием,
 * а ссылкой, обновляемой на каждом коммите экрана: они у экрана свежие на каждый
 * рендер, и как зависимость эффекта перерисовывали бы оболочку каждый раз.
 */

/**
 * @typedef {{
 *   mode: 'create' | 'trip',
 *   tripId?: string | null,
 *   addons?: any,
 *   section?: string | null,
 *   step?: any,
 *   isPro?: boolean,
 *   proResolved?: boolean,
 *   title?: any,
 *   meta?: any,
 *   loading?: boolean,
 *   backTitle?: string,
 * }} ShellFacts
 *
 * @typedef {{
 *   onNavigate?: (id: string) => void,
 *   onShare?: () => void,
 *   onProUpsell?: () => void,
 *   onBack?: () => void,
 *   confirmLeave?: () => Promise<boolean>,
 * }} ShellCallbacks
 *
 * @typedef {{
 *   panelLabel: string,
 *   detents?: number[],
 *   detent?: number,
 *   onDetentChange?: (i: number) => void,
 *   collapsed?: boolean,
 *   onCollapsedChange?: (v: boolean) => void,
 *   collapseLabel?: string,
 *   expandLabel?: string,
 *   overlayActive?: boolean,
 *   sideOpen?: boolean,
 * }} SurfaceConfig
 */

// Ключи фактов — ФИКСИРОВАННЫЙ список: он же список зависимостей эффекта
// публикации. Объект фактов у экрана новый на каждый рендер, а публиковать надо
// на смену ЗНАЧЕНИЙ.
const FACT_KEYS = /** @type {const} */ (['mode', 'tripId', 'addons', 'section', 'step', 'isPro', 'proResolved', 'title', 'meta', 'loading', 'backTitle']);
const SURFACE_KEYS = /** @type {const} */ (['panelLabel', 'detents', 'detent', 'onDetentChange', 'collapsed', 'onCollapsedChange', 'collapseLabel', 'expandLabel', 'overlayActive', 'sideOpen']);

/** Минимальный внешний стор под `useSyncExternalStore`. */
export function createStore(initial) {
  let value = initial;
  const subs = new Set();
  return {
    get: () => value,
    set: (next) => { if (next === value) return; value = next; subs.forEach((f) => f()); },
    subscribe: (f) => { subs.add(f); return () => { subs.delete(f); }; },
  };
}

/**
 * Значение контекста собирает `TripShell`; экраны видят его целиком.
 * Объект СТАБИЛЕН на всё время жизни оболочки: всё, что меняется, лежит в нём
 * сторами/рефами, а не значениями, поэтому хуки экрана с `host` в зависимостях
 * не переигрываются от чужих событий (регистрация узла слота шеллом карты не
 * трогает публикацию фактов).
 * @typedef {{
 *   setFacts: (f: ShellFacts | null) => void,
 *   cbs: { current: ShellCallbacks },
 *   setSurface: (c: SurfaceConfig | null) => void,
 *   mapProps: ReturnType<typeof createStore>,
 *   slots: ReturnType<typeof createStore>,
 *   mainRef: { current: HTMLElement | null },
 * }} ShellHost
 */
const ShellCtx = createContext(/** @type {ShellHost | null} */ (null));
export const ShellProvider = ShellCtx.Provider;

/** Хост оболочки; `null` вне `TripShell` (тогда экран рисуется как есть). */
export function useShellHost() {
  return useContext(ShellCtx);
}

/**
 * Экран объявляет шапку и рейл оболочки.
 * @param {ShellFacts} facts
 * @param {ShellCallbacks} [cbs]
 */
export function useShellFacts(facts, cbs = {}) {
  const host = useShellHost();
  // Колбэки — в КОММИТЕ, а не в теле рендера: под транзишном роутера рендер
  // экрана прерываем и может быть выброшен, а записанная из него ссылка осталась
  // бы у оболочки. Без зависимостей: свежие на каждый зафиксированный рендер.
  useLayoutEffect(() => { if (host) host.cbs.current = cbs; });
  useLayoutEffect(() => {
    if (!host) return undefined;
    host.setFacts(facts);
    return () => host.setFacts(null);
    // Зависимости — ЗНАЧЕНИЯ фактов по фиксированному списку ключей.
  }, [host, ...FACT_KEYS.map((k) => facts[k])]);
}

/**
 * Экран объявляет поверхность карты: конфиг шелла (состояние оболочки) и пропы
 * `MapView` (стор хоста карты). `null` в первом аргументе снимает поверхность —
 * шелл карты и карта размонтируются (инстанс карты паркуется синглтоном).
 * @param {SurfaceConfig | null} config
 * @param {any} props пропы `MapView` без `view` (его даёт шелл карты)
 */
export function useShellSurface(config, props) {
  const host = useShellHost();
  // Экран без поверхности (встроенный режим редактора в ящике календаря, экран
  // лимита визарда) ничего не публикует и ничего не снимает: снимать он мог бы
  // только чужое.
  const active = !!host && !!config;
  useLayoutEffect(() => {
    if (!active) return undefined;
    host.setSurface(config);
    return () => host.setSurface(null);
  }, [host, active, ...SURFACE_KEYS.map((k) => config?.[k])]);
  // Пропы карты — на КАЖДЫЙ рендер: у них нет стабильной подписи (ховер, фокус,
  // пины), и сравнивать их поштучно дороже, чем перерисовать один хост карты.
  useLayoutEffect(() => { if (active) host.mapProps.set(props); });
  useLayoutEffect(() => (active ? () => host.mapProps.set(null) : undefined), [host, active]);
}

/** Пропы карты, опубликованные экраном (подписка хоста карты). */
export function useShellMapProps() {
  const host = useShellHost();
  return useSyncExternalStore(host.mapProps.subscribe, host.mapProps.get, host.mapProps.get);
}

/**
 * Слот оболочки: содержимое рендерится порталом в узел, который держит
 * `TripShell`/`MapShell`. Пока узла нет (шелл карты ещё не смонтирован),
 * не рендерится ничего — узел приезжает в том же коммите (ref ставится в фазе
 * мутации, стор оповещает слот синхронно, до отрисовки).
 *
 * Имена слотов: `panelHead` · `panelBody` · `panelFoot` · `panelOverlay` ·
 * `sideHead`/`sideBody` (вторая колонка шелла, живёт только под `sideOpen`) ·
 * `status` (полоса статуса над низом карты) · `mapOverlay` (плавающие контролы
 * над картой) · `content` (ящик у `.trip-content`) · `shell` (оверлеи у
 * `.trip-shell`). Скроллер тела секции — не слот, а реф `host.mainRef`.
 * @param {{ name: string, children?: any }} p
 */
export function ShellSlot({ name, children }) {
  const host = useShellHost();
  // Узлы слотов — стор: на регистрацию узла перерисовывается ТОЛЬКО слот, а не
  // оболочка и не экран.
  const slots = useSyncExternalStore(host.slots.subscribe, host.slots.get, host.slots.get);
  const el = slots[name] || null;
  return el ? createPortal(children, el) : null;
}
