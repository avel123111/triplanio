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

/** Сумма коробок — «воздух кадра плюс закрытая площадь». @param {Box} a @param {Box} b @returns {Box} */
export function addBox(a, b) {
  return { top: a.top + b.top, right: a.right + b.right, bottom: a.bottom + b.bottom, left: a.left + b.left };
}

/** @param {any} a @param {any} b */
function sameBox(a, b) {
  return a.top === b.top && a.right === b.right && a.bottom === b.bottom && a.left === b.left;
}

/** Объявить закрытую площадь инстанса; `null` — снять. @param {any} map @param {any} box @returns {Box} */
export function setMapInsets(map, box, fitBox) {
  const next = toBox(box);
  const fit = toBox(fitBox === undefined ? box : fitBox);
  if (map) {
    if (sameBox(next, NO_INSETS) && sameBox(fit, NO_INSETS)) store.delete(map);
    else store.set(map, { camera: next, fit });
  }
  return next;
}

/** @param {any} map @returns {Box} */
export function getMapInsets(map) {
  return (map && store.get(map)?.camera) || NO_INSETS;
}

/**
 * Коробка для РАСЧЁТА кадра — «во что вписываем». Отличается от камерной там,
 * где вид уводит не камера, а сам холст (телефон): камере отступ не нужен, а
 * вписывать всё равно надо в видимую полосу. Разбор — `lib/mapShellInsets.js`.
 * @param {any} map @returns {Box}
 */
export function getFitInsets(map) {
  return (map && store.get(map)?.fit) || NO_INSETS;
}

/**
 * Полоса канваса, ниже которой кадрировать бессмысленно (px, по каждой оси).
 * ОДНО объявление на проект: тем же числом кламп отступа в `mapbox.js` не даёт
 * отступу съесть канвас — это один и тот же закон, записанный один раз.
 */
/**
 * ОТСТУП КАМЕРЫ УЖЕ ТАКОЙ — ЕХАТЬ НЕЧЕМ, И ПОСЫЛАТЬ КОМАНДУ НЕЛЬЗЯ.
 *
 * ★ Любая команда камере ОБРЫВАЕТ летящую: `easeTo`, который никуда не двигает,
 * всё равно убивает чужой `flyTo`. А отступ поверхности меняется РЕЖЕ, чем
 * свободное окно (на телефоне вид уводит сам холст, и коробка камеры там всегда
 * нулевая) — то есть «применить отступ» сплошь и рядом значит «отменить чужой
 * перелёт ни за что». Поэтому сравнение с ТЕКУЩИМ состоянием карты, а не с
 * прошлым намерением: намерение врёт, если камерой ходил кто-то ещё.
 *
 * Библиотека без `getPadding` (или упавшая на нём) читается как «не знаем» →
 * `false`, то есть прежнее поведение: лучше лишняя команда, чем несделанная.
 *
 * @param {any} map инстанс карты
 * @param {any} want целевая коробка
 * @returns {boolean}
 */
export function padUnchanged(map, want) {
  let cur = null;
  try { cur = map && map.getPadding ? map.getPadding() : null; } catch { cur = null; }
  if (!cur || !want) return false;
  return ['top', 'right', 'bottom', 'left']
    .every((k) => Math.round(cur[k] || 0) === Math.round(want[k] || 0));
}

/**
 * ПОДПИСЬ ВЫСОТЫ СВОБОДНОГО ОКНА — ТОЛЬКО ВЕРТИКАЛЬ, И ЭТО НЕ ЭКОНОМИЯ.
 *
 * ★ Ось решает, кто чинит окно (та же развилка, на которой стоит весь
 * `mapShellInsets`): ШИРИНУ закрывает панель — её отбирает отступ КАМЕРЫ, то
 * есть вид просто переезжает, зум остаётся верным. ВЫСОТУ закрывает шит — а его
 * на телефоне отступом камеры не выразить (`transform.padding` рисует на глобусе
 * диск), там окно уводит сдвиг холста, и он тоже только ПЕРЕНОСИТ. Значит при
 * смене высоты окна прежний зум становится неверным: маршрут, вписанный в
 * большое окно, в маленьком вылезает под шапку и под шит.
 *
 * Отсюда правило: изменилась ВЫСОТА окна — маршрут вписываем заново; изменилась
 * ШИРИНА — не трогаем, её доводит отступ. На десктопе `top`/`bottom` всегда
 * нули, поэтому подпись там постоянна и перекадрирования не бывает вовсе.
 *
 * @param {any} box коробка «во что вписываем»
 * @returns {string}
 */
export function fitHeightSig(box) {
  return `${Math.round(box?.top || 0)}|${Math.round(box?.bottom || 0)}`;
}

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
