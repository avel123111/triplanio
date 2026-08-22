// @ts-check
import { toPaddingBox } from './padding.js';

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
 * ★★ ЗАКРЫТАЯ ПЛОЩАДЬ ВЫРАЖАЕТСЯ СДВИГОМ КАМЕРЫ, А НЕ ОТСТУПОМ ВЬЮПОРТА.
 * Это не стилистика, это замер (снимки в PR): на проекции `globe` большой
 * `padding` у `fitBounds` делает ДВЕ вещи разом — роняет зум (шит в 500px из
 * 620 дал zoom 0.41, планета схлопнулась в точку) и рассинхронивает лимб
 * атмосферы с тайлами, отчего вокруг планеты появляется тёмная окружность,
 * меняющая размер при зуме. Ровно это и видно на экране как «круг вокруг
 * глобуса» и «пятно». Тот же кадр со СДВИГОМ вместо отступа: zoom 2.34, кольца
 * нет, цель уехала из-под шита.
 *
 * Поэтому `padding` остаётся тем, чем был — ВОЗДУХОМ вокруг объекта (десятки
 * пикселей), а место, занятое панелью или шитом, двигает камеру.
 *
 * Половина разницы противоположных сторон — это и есть центр свободного окна.
 *
 * @param {import('./padding.js').PaddingBox} box
 * @returns {[number, number]}
 */
export function offsetForInsets(box) {
  const b = toPaddingBox(box);
  return [(b.left - b.right) / 2, (b.top - b.bottom) / 2];
}
