// @ts-check

/**
 * ОТСТУПЫ КАМЕРЫ — СОСТОЯНИЕ ПОВЕРХНОСТИ, А НЕ АРГУМЕНТ ВЫЗОВА (TRIP-422).
 *
 * ★ Кадрируют камеру полтора десятка мест (семь только в `MapView`). Пока это
 * аргумент, достаточно одного забытого вызова, чтобы карта уехала под панель —
 * молча, без падения и без красных гардов. Здесь величина объявлена один раз на
 * инстанс, и обе двери кадрирования читают её сами. WeakMap, а не модульная
 * переменная: карта — синглтон, живущий дольше экранов.
 *
 * ★★ ДВА ОТСТУПА mapbox, И ПУТАТЬ ИХ НЕЛЬЗЯ:
 *   ФИТА (`cameraForBounds({padding})`) = ВОЗДУХ кадра + закрытая площадь.
 *     mapbox его СИММЕТРИЗУЕТ (`_extendAABB`), то есть кадр он не сдвигает —
 *     только уменьшает коробку.
 *   ПОВЕРХНОСТИ (`transform.padding` = `easeTo({padding})`) = ТОЛЬКО закрытая
 *     площадь. Именно он сдвигает центр вида в свободное окно.
 *
 * Отсюда правило: в фит — сумма, в поверхность — отступ. Тогда маршрут встаёт по
 * центру свободного окна с полями ровно в воздух (арифметика — в тестах).
 *
 * ⚠️ `map.fitBounds()` использовать нельзя: он кладёт отступ фита (с воздухом) и
 * в расчёт, И в состояние карты, то есть портит `transform.padding` при каждом
 * кадрировании. Проверено по исходнику 3.24 (`_fitInternal`).
 */

const store = new WeakMap();

/** @typedef {{ top: number, right: number, bottom: number, left: number }} Box */

/** @type {Box} */
export const NO_INSETS = Object.freeze({ top: 0, right: 0, bottom: 0, left: 0 });

/** Привести что угодно к коробке в px. Число — во все четыре стороны. @param {any} v @returns {Box} */
export function toBox(v) {
  const n = (x) => (Number.isFinite(x) && x > 0 ? Math.round(x) : 0);
  if (typeof v === 'number') { const a = n(v); return { top: a, right: a, bottom: a, left: a }; }
  if (!v || typeof v !== 'object') return { ...NO_INSETS };
  return { top: n(v.top), right: n(v.right), bottom: n(v.bottom), left: n(v.left) };
}

/**
 * ★★★ ЗАКРЫТАЯ ПЛОЩАДЬ КАМЕРЕ ПЕРЕДАЁТСЯ СДВИГОМ ЦЕНТРА, А НЕ `transform.padding`.
 *
 * ⚠️ `transform.padding` НА ПРОЕКЦИИ `globe` ЛОМАЕТ РЕНДЕР. Замер (реальный
 * mapbox 3.24, холст 446x600, зум 4, отступ снизу 456): движок рисует ПЛАНЕТУ
 * ДИСКОМ и оставляет остальную площадь канваса ПРОЗРАЧНОЙ — сквозь неё видна
 * подложка элемента, то есть заливка цветом темы приложения с круглым вырезом.
 * Диаметр диска растёт с зумом (зум 5 — заметно больше зума 4), на `mercator`
 * дефекта нет вовсе. Это ровно те «круги и заливки», на которые жаловались.
 *
 * Сдвиг центра даёт тот же кадр без единого артефакта: канвас залит от края до
 * края, вид стоит в центре СВОБОДНОГО окна. Проверено тем же замером.
 *
 * Знак: свободное окно смещено ОТ закрытой стороны, поэтому цель уезжает в
 * противоположную ей сторону — панель слева даёт `+x`, шит снизу даёт `−y`.
 *
 * @param {Box} box @returns {[number, number]} `offset` для `easeTo`/`flyTo`
 */
export function offsetFor(box) {
  const b = toBox(box);
  return [(b.left - b.right) / 2, (b.top - b.bottom) / 2];
}

/**
 * Географическая точка, стоящая в центре СВОБОДНОГО окна. Нужна, когда окно
 * меняет размер: «оставить вид на месте» значит оставить на месте ЕЁ, а не
 * центр холста (тот вообще может оказаться под шитом).
 * @param {any} map @param {Box} box
 */
export function freeWindowCenter(map, box) {
  try {
    const el = map.getContainer();
    const [ox, oy] = offsetFor(box);
    const p = map.unproject([el.clientWidth / 2 + ox, el.clientHeight / 2 + oy]);
    return [p.lng, p.lat];
  } catch { return null; }
}

/** Сумма коробок — «воздух кадра плюс закрытая площадь». @param {Box} a @param {Box} b @returns {Box} */
export function addBox(a, b) {
  return { top: a.top + b.top, right: a.right + b.right, bottom: a.bottom + b.bottom, left: a.left + b.left };
}

/** @param {any} a @param {any} b */
function sameBox(a, b) {
  return a.top === b.top && a.right === b.right && a.bottom === b.bottom && a.left === b.left;
}

/** Объявить закрытую площадь инстанса; `null` — снять. @param {any} map @param {any} box @returns {Box} */
export function setMapInsets(map, box) {
  const next = toBox(box);
  if (map) {
    if (sameBox(next, NO_INSETS)) store.delete(map);
    else store.set(map, next);
  }
  return next;
}

/** @param {any} map @returns {Box} */
export function getMapInsets(map) {
  return (map && store.get(map)) || NO_INSETS;
}

/**
 * Полоса канваса, ниже которой кадрировать бессмысленно (px, по каждой оси).
 * ОДНО объявление на проект: тем же числом кламп отступа в `mapbox.js` не даёт
 * отступу съесть канвас — это один и тот же закон, записанный один раз.
 */
export const MIN_FREE_WINDOW = 80;

/** Свободное окно в px — остаток канваса после закрытой площади. @param {number} W @param {number} H @param {Box} insets */
function freeWindow(W, H, insets) {
  return { w: (W || 0) - insets.left - insets.right, h: (H || 0) - insets.top - insets.bottom };
}

/**
 * Есть ли куда кадрировать. Верхний детент закрывает экран целиком: вписаться
 * формально можно (кламп оставит полоску), но на обратном ходе шита камеру
 * пришлось бы тащить из предельного зума — то есть рывок. Невидимая карта
 * обязана дождаться своего окна как есть.
 * @param {number} W @param {number} H @param {Box} insets
 */
export function canFrame(W, H, insets) {
  const f = freeWindow(W, H, insets);
  return f.w >= MIN_FREE_WINDOW && f.h >= MIN_FREE_WINDOW;
}
