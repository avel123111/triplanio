// @ts-check
import { addPadding, toPaddingBox } from './padding.js';

/**
 * «Какая часть канваса этой карты закрыта» — ОДИН владелец на приложение
 * (TRIP-422).
 *
 * ★ ЗАЧЕМ ХРАНИЛИЩЕ, А НЕ ПРОП. Панель/шит закрывают часть карты, и камера
 * обязана целиться в ОСТАТОК. Прокидывать это в каждый вызов `fitBounds`
 * значило бы менять семь мест в `MapView` и помнить про них в каждом
 * следующем экране — то есть правило жило бы в вызывающих, а не в предмете.
 * Закрытая площадь — свойство САМОЙ поверхности карты, поэтому она лежит рядом
 * с инстансом, а обе двери камеры (`fitToPoints`, `calmFit`) читают её сами.
 *
 * ★ WeakMap, А НЕ ПОЛЕ НА ИНСТАНСЕ: карта — синглтон, живущий дольше экранов;
 * поле пришлось бы чистить руками, а забытое поле — это чужие отступы на
 * следующем экране. WeakMap отпускает запись вместе с картой.
 */

/** @type {WeakMap<object, import('./padding.js').PaddingBox>} */
const INSETS = new WeakMap();

const ZERO = Object.freeze({ top: 0, right: 0, bottom: 0, left: 0 });

/**
 * Объявить закрытую площадь. `null` — снять (экран ушёл, карта свободна).
 * @param {object|null|undefined} map
 * @param {unknown} box
 */
export function setMapInsets(map, box) {
  if (!map) return;
  if (box == null) INSETS.delete(map);
  else INSETS.set(map, toPaddingBox(box));
}

/**
 * @param {object|null|undefined} map
 * @returns {import('./padding.js').PaddingBox}
 */
export function getMapInsets(map) {
  return (map && INSETS.get(map)) || ZERO;
}

/**
 * Отступ вызова + закрытая площадь этой карты. Ровно эту сумму и клампит
 * `clampPadding` — складывать надо ДО клампа, иначе кламп судит о половине.
 * @param {object|null|undefined} map
 * @param {unknown} padding
 */
export const withMapInsets = (map, padding) => addPadding(padding, getMapInsets(map));

/**
 * Сдвиг центра для ОДИНОЧНОЙ точки: у одной точки нет границ, вписывать нечего,
 * поэтому её просто уводят из-под панели. Половина разницы противоположных
 * сторон — это и есть центр свободного окна.
 *
 * @param {import('./padding.js').PaddingBox} box
 * @returns {[number, number]}
 */
export function offsetForInsets(box) {
  const b = toPaddingBox(box);
  return [(b.left - b.right) / 2, (b.top - b.bottom) / 2];
}
