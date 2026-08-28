// Shared geometry constants for the route lines on every map surface (trip
// Overview / Map lens / Edit mode / public trip, and the create-flow planner).
//
// Colours are NOT here anymore: the line colour comes from the Lumo design token
// `--map-route` read at draw time (src/lib/map/mapTokens.js → routeColor()), so
// the lines follow the day/night theme. Markers are styled entirely by CSS
// (.tmk* in src/design/app.css). This module owns only the widths/opacity so a
// solid route line and a faded "no transport" dashed line read consistently
// across all maps.

export const SOLID_WIDTH = 3.5;
export const DASHED_WIDTH = 2;
export const DASHED_OPACITY = 0.4; // canonical faded look for "no transport" legs

/**
 * ОБЛИК ПЛЕЧА — единственное место, где он решается.
 *
 * Плечо без переезда рисуется приглушённым пунктиром НЕ потому, что «так
 * красивее», а потому что это ПРЕДУПРЕЖДЕНИЕ: в плане дыра, переезд между двумя
 * городами не заведён. На картах, где трип планируют и правят (линза «Маршрут»,
 * редактор, планировщик), такая дыра обязана быть заметна.
 *
 * Есть и поверхности, которые ничего не планируют: share-карточка — законченная
 * картинка, её показывают другим людям. Там пунктир не предупреждает никого, а
 * читается дефектом печати, поэтому маршрут рисуется целым: плечо без переезда
 * — такая же сплошная прямая, как любое другое (`markGaps: false`).
 *
 * Правило живёт ЗДЕСЬ, в модуле облика линий, и его зовут все три места, которые
 * рисуют плечи (базовая отрисовка, прогрессивное раскрытие публичного трипа и
 * подсветка выбранного сегмента). Иначе развилка `!kind` расползается копиями,
 * и поверхность чинится в одной из них, а в двух других остаётся как была.
 *
 * @param {string|undefined|null} kind — тип транспорта; пусто = переезда нет
 * @param {boolean} markGaps — показывает ли поверхность дыры в плане
 * @returns {'solid' | 'dashed'}
 */
export function legLook(kind, markGaps = true) {
  return kind || !markGaps ? 'solid' : 'dashed';
}
