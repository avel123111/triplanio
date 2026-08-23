// @ts-check

/**
 * ЗАКРЫТАЯ ПЛОЩАДЬ ШЕЛЛА — ЧИСТАЯ ФУНКЦИЯ (TRIP-422).
 *
 * ★ ЧТО ЗАКРЫТО — РЕШАЕТ ОСЬ, потому что размер глобуса mapbox считает от высоты
 * ХОЛСТА:
 *   панель режет ШИРИНУ → холст целый, кадр уводит отступ камеры;
 *   шит режет ВЫСОТУ    → её забирает СЛОТ (холст = свободное окно).
 *
 * ⚠️ Развязывать холст и свободное окно нельзя — так ломали глобус дважды:
 * высоты расходятся втрое, шар считается от одной и показывается в другой.
 *
 * @param {{ phone?: boolean, sheetPx?: number, panelPx?: number, collapsed?: boolean, cornerPx?: number }} [p]
 *   `cornerPx` — радиус скруглений шита (`--r-xl`): на столько слот заходит под
 *   него, иначе в вырезах углов виден фон страницы. Значение ЧИТАЕТСЯ ИЗ CSS
 *   вызывателем — второй записи этого числа в JS быть не должно.
 * @returns {{ slotBottom: number, camera: { top: number, right: number, bottom: number, left: number } }}
 */
export function mapShellInsets({ phone = false, sheetPx = 0, panelPx = 0, collapsed = false, cornerPx = 0 } = {}) {
  // Из DOM приходят 0, NaN и отрицательные (первый кадр, размонтирование) —
  // такое обязано выродиться в «карта во всю площадь», а не в отрицательный слот.
  const px = (v) => (Number.isFinite(v) && v > 0 ? Math.round(/** @type {number} */ (v)) : 0);
  const none = { top: 0, right: 0, bottom: 0, left: 0 };
  // Режимы не смешиваются: шит живёт в портале и на переходе десктоп↔телефон
  // успевает подержать прошлое значение — прочитать его значит отрезать полосу
  // по призраку.
  if (phone) return { slotBottom: Math.max(0, px(sheetPx) - px(cornerPx)), camera: none };
  return { slotBottom: 0, camera: { ...none, left: collapsed ? 0 : px(panelPx) } };
}

/**
 * КОГДА применять новый размер слота — задержка в мс.
 *
 * ★ Размер холста анимировать нельзя (каждый кадр = переаллокация GL-буфера),
 * значит он меняется скачком и единственная ручка — МОМЕНТ. Правило
 * несимметрично: карта РАСТЁТ сразу (шит съезжает по ней), СЖИМАЕТСЯ после
 * приезда шита (её низ всё это время закрыт им самим). Иначе между ними
 * открывается полоса фона — замерено до 351 px на 160 мс.
 *
 * @param {{ prev?: number, next?: number, settleMs?: number }} [p] отступ слота снизу
 * @returns {number}
 */
export function slotChangeDelay({ prev = 0, next = 0, settleMs = 0 } = {}) {
  if (!(next > prev)) return 0;
  return Math.max(0, Math.round(settleMs));
}

export default mapShellInsets;
