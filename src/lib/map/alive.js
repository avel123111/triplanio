// @ts-check

/**
 * ЖИВА ЛИ КАРТА — ОДИН ПРЕДИКАТ НА ВСЕ ПОВЕРХНОСТИ.
 *
 * Инстанс mapbox один на всё приложение (MapProvider) и живёт дольше экранов, а
 * при полном teardown / dev hot-reload его `remove()` СНОСИТ `map.style`. После
 * этого ЛЮБОЙ `map.getSource()` / `map.getLayer()` падает изнутри —
 * `this.style.getOwnSource(…)` читает свойство у `undefined` — и это не ловится
 * снаружи проверкой `!map` (ссылка-то жива). Диагноз повторялся дважды: TRIP-195
 * (`getOwnLayer`) и TRIPLANIO-A (`getOwnSource`, необработанный reject в
 * `routeLines`). До этого каждое место чинили своей копией `!map || !map.style`
 * — теперь один предикат, который зовут ПЕРЕД сырым `getSource`/`getLayer`.
 *
 * @param {any} map инстанс общего синглтона (или что угодно)
 * @returns {boolean} true, если у карты жив стиль и по ней безопасно читать слои
 */
export function isMapAlive(map) {
  return !!(map && map.style);
}
