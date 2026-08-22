// @ts-check

/**
 * Отступы камеры карты — ЧИСТАЯ арифметика (TRIP-422).
 *
 * ★ ЗАЧЕМ ЭТО ОТДЕЛЬНО И ПОЧЕМУ С ТЕСТОМ. `fitBounds` с отступом, который не
 * помещается в канвас, не ошибается и не ругается: он молча отъезжает на
 * минимальный зум. При проекции `globe` это выглядит как ШАР В ЧЁРНОМ КОСМОСЕ —
 * тот самый «чёрный круг вокруг глобуса», за который обычно принимают баг
 * рендера. Стоит появиться боттом-шиту, и нижний отступ становится больше
 * половины экрана на любом телефоне, поэтому кламп — не перестраховка, а
 * условие работоспособности.
 *
 * ★ ПОЧЕМУ ПО ОСЯМ, А НЕ ОДНИМ ЧИСЛОМ. Прошлая редакция клампила только
 * скаляр (`typeof padding !== 'number'` → возврат как есть), то есть ровно
 * асимметричный отступ — единственный, который шит и порождает, — проходил
 * мимо защиты. Ось независима от оси: шит съедает низ, панель — лево.
 *
 * Инвариант: по каждой оси на карту остаётся не меньше `MIN_CANVAS` пикселей.
 * Если запрошенные отступы шире оси — они ужимаются ПРОПОРЦИОНАЛЬНО, чтобы
 * сохранить смысл композиции (низ съеден вдвое сильнее верха — так и останется),
 * а не обнуляются: обнуление вернуло бы точку под шит.
 */

/** Сколько пикселей канваса обязано остаться по каждой оси. */
export const MIN_CANVAS = 16;

/** @typedef {{ top: number, right: number, bottom: number, left: number }} PaddingBox */

/**
 * @param {unknown} padding число (одинаково со всех сторон) или частичный бокс
 * @returns {PaddingBox}
 */
export function toPaddingBox(padding) {
  if (typeof padding === 'number' && Number.isFinite(padding)) {
    const v = Math.max(0, padding);
    return { top: v, right: v, bottom: v, left: v };
  }
  const p = /** @type {Record<string, unknown>} */ (padding || {});
  const side = (v) => (typeof v === 'number' && Number.isFinite(v) ? Math.max(0, v) : 0);
  return { top: side(p.top), right: side(p.right), bottom: side(p.bottom), left: side(p.left) };
}

/**
 * Ужать отступы так, чтобы по каждой оси осталось ≥ MIN_CANVAS канваса.
 * Нулевой (ещё не измеренный) размер оси — отступы этой оси не трогаем: врать
 * про размер хуже, чем пропустить кадр, а показ камеры и так ждёт `canFit`.
 *
 * @param {{ width?: number, height?: number }} size размер канваса в px
 * @param {unknown} padding
 * @returns {PaddingBox}
 */
export function clampPaddingBox(size, padding) {
  const box = toPaddingBox(padding);
  const axis = (extent, a, b) => {
    if (!(extent > 0)) return [a, b];
    const room = Math.max(0, extent - MIN_CANVAS);
    const want = a + b;
    if (want <= room) return [a, b];
    if (want === 0) return [0, 0];
    const k = room / want;
    return [Math.floor(a * k), Math.floor(b * k)];
  };
  const [top, bottom] = axis(size.height ?? 0, box.top, box.bottom);
  const [left, right] = axis(size.width ?? 0, box.left, box.right);
  return { top, right, bottom, left };
}

/**
 * Есть ли у бокса хоть один ненулевой отступ (нужно, чтобы не гонять камеру
 * через объектный путь там, где отступов нет вовсе).
 * @param {PaddingBox} box
 */
export const hasPadding = (box) => box.top > 0 || box.right > 0 || box.bottom > 0 || box.left > 0;

/**
 * Сложить два бокса — например «дизайнерский воздух вокруг маршрута» и «место,
 * занятое панелью/шитом». Складываются ДО клампа: кламп судит о результате.
 * @param {unknown} a
 * @param {unknown} b
 * @returns {PaddingBox}
 */
export function addPadding(a, b) {
  const x = toPaddingBox(a); const y = toPaddingBox(b);
  return { top: x.top + y.top, right: x.right + y.right, bottom: x.bottom + y.bottom, left: x.left + y.left };
}
