// Персональные скрытия варнингов таймлайна («нет переезда» / «нет отеля»).
//
// Хранение — localStorage (решение Pavel 2026-08-26: память «этого устройства»,
// не аккаунта; куки/consent не при чём — за пределы браузера значение не уходит,
// та же категория функционального хранения, что `trips:viewMode`). Одна запись
// на трип: JSON-массив строк-ключей.
//
// Ключ варнинга живёт и умирает вместе со СМЫСЛОМ варнинга: он собран из id
// city_visit'ов (стабильны при правках дат/порядка), поэтому удаление и
// пересоздание города даёт новый id — и варнинг честно возвращается.
//
// Модуль намеренно ЧИСТЫЙ (без DOM/React) — гоняется в `node --test`, как
// trip-cities.js; сам localStorage трогает только хук на экране.

export const DISMISSED_CAP = 100;

export const storageKey = (tripId) => `trip:dismissed-warnings:${tripId}`;

// «Нет переезда» — стык двух визитов (для хвоста в финиш toVisitId = id end-якоря).
export const transferWarnKey = (fromVisitId, toVisitId) => `t:${fromVisitId}:${toVisitId}`;
// «Нет отеля» — один на город.
export const hotelWarnKey = (visitId) => `h:${visitId}`;

/** Сырое значение из storage → Set валидных ключей. Мусор (не-JSON, не массив,
 *  не-строки) молча превращается в пустой набор — деградация к поведению
 *  «ничего не скрыто», а не краш экрана. */
export function loadDismissed(raw) {
  try {
    const parsed = JSON.parse(raw);
    return new Set(Array.isArray(parsed) ? parsed.filter((k) => typeof k === 'string') : []);
  } catch {
    return new Set();
  }
}

/** Набор ключей → массив на запись: прюнинг мёртвых (каждый id ключа обязан
 *  существовать среди живых визитов трипа) + кэп, чтобы запись не росла вечно.
 *  Кэп срезает СТАРЕЙШИЕ (голова массива): свежие скрытия дороже. */
export function serializeDismissed(dismissed, aliveVisitIds, cap = DISMISSED_CAP) {
  const alive = new Set(aliveVisitIds);
  const keys = [...dismissed].filter((k) => {
    const [kind, ...ids] = String(k).split(':');
    return (kind === 't' || kind === 'h') && ids.length > 0 && ids.every((id) => alive.has(id));
  });
  return keys.slice(-cap);
}
