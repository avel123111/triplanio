// @ts-check
/**
 * Был ли жест ТАПОМ — по паре pointerdown/pointerup.
 *
 * Выбор строки в пикере снят с синтетического `click`: на iOS слово из подсказки
 * клавиатуры остаётся незакоммиченной композицией, первое касание вне поля
 * тратится на её коммит, и `click` до строки не доходит (лечили TRIP-484).
 * Отдельным модулем — чтобы правило можно было проверить тестом: `node --test`
 * JSX не грузит.
 *
 * Порог — тот же, что у «нажал / повёз» в `useRouteDnD`.
 */
export const TAP_SLOP = 9;

/**
 * @param {{ id: number, x: number, y: number, row: any }|null|undefined} down
 * @param {{ id: number, x: number, y: number }|null|undefined} up
 * @param {number} [slop]
 * @returns {any|null} строка из `down` (по чему нажали) или null, если не тап
 */
export function tapPick(down, up, slop = TAP_SLOP) {
  if (!down || !up) return null;
  if (down.id !== up.id) return null;                                  // чужой палец
  if (Math.hypot(up.x - down.x, up.y - down.y) > slop) return null;    // это скролл
  return down.row ?? null;
}

export default tapPick;
