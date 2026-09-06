// @ts-check
/**
 * Обернуть действие-уход гейтом подтверждения (TRIP-520).
 *
 * Единственная реализация правила «спросить перед уходом» для всех выходов из
 * флоу создания: знак бренда, «Профиль» / «Выйти», обе двери колокольчика. Без
 * гейта (`confirmLeave` не передан) возвращает само действие — на остальных
 * экранах поведение прежнее. С гейтом — сначала спрашивает, при отказе не идёт.
 *
 * Заведён вместо четырёх текстуально одинаковых копий по компонентам шапки:
 * копия соседа форкается при первой правке любой из них (правило #6).
 *
 * @template {(...args: any[]) => any} F
 * @param {(() => Promise<boolean>) | undefined} confirmLeave
 * @param {F} action
 * @returns {F | (() => Promise<void>)}
 */
export function withLeaveGuard(confirmLeave, action) {
  if (!confirmLeave) return action;
  return async () => { if (await confirmLeave()) action(); };
}
