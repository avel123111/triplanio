// @ts-check
/**
 * ★ ПОЗИЦИЯ ВИЗАРДА = АДРЕС, А НЕ `useState` (TRIP-520).
 *
 * Раньше шаг жил `useState`, а браузер знал про весь флоу одну запись истории —
 * поэтому любой «назад» (кнопка, аппаратная, свайп) разрешался маршрутом, то
 * есть выходом на главную. Как только шаг переезжает в `?step=`, платформа сама
 * ходит по шагам, а своего кода перехвата истории нужно ноль.
 *
 * Эти две чистые функции — единственное, что в этом переезде нельзя увидеть на
 * экране без прогонки всех веток, поэтому они вынесены сюда и запинены тестом
 * (`stepUrl.test.js`).
 */

/** Канонические id шагов, в порядке флоу. */
export const STEP_IDS = /** @type {const} */ (['home', 'cities', 'return', 'review']);

/**
 * Адрес → id шага. URL — источник истины позиции, значит по нему приходят из
 * истории и по ссылке, где значение могло быть любым:
 *   · неизвестное / опечатка            → `home` (начало флоу);
 *   · `review` при невалидных городах   → `cities` (ревьюить нечего);
 *   · иначе — как есть.
 * @param {string | null | undefined} raw
 * @param {{ citiesValid?: boolean }} [opts]
 * @returns {'home' | 'cities' | 'return' | 'review'}
 */
export function normalizeStep(raw, { citiesValid = false } = {}) {
  if (!raw || !STEP_IDS.includes(/** @type {any} */ (raw))) return 'home';
  if (raw === 'review' && !citiesValid) return 'cities';
  return /** @type {any} */ (raw);
}

/**
 * Как попали на текущий шаг — для аналитики воронки (`from` в
 * `trip_creation_step_opened`).
 *
 *   · первый рендер            → `direct`;
 *   · `POP` (назад/вперёд)     → `back`;
 *   · `REPLACE`                → `restore` (восстановление черновика в адрес);
 *   · `PUSH`                   → намерение писателя (`next` / `jump`), иначе `direct`.
 *
 * ⚠️ НА `POP` НАМЕРЕНИЕ ИЗ `state` БРАТЬ НЕЛЬЗЯ. React Router отдаёт `state` ТОЙ
 * записи, куда вернулись: на возврате в `cities` там лежит `next`, с которым
 * туда пришли впервые. Возврат опознаётся только типом навигации, поэтому ветка
 * `POP` стоит ВЫШЕ чтения `intent`.
 *
 * @param {{ isFirst?: boolean, navType?: 'POP' | 'PUSH' | 'REPLACE', intent?: string }} [opts]
 * @returns {'direct' | 'next' | 'back' | 'jump' | 'restore'}
 */
export function stepEntryFrom({ isFirst = false, navType, intent } = {}) {
  if (isFirst) return 'direct';
  if (navType === 'POP') return 'back';
  if (navType === 'REPLACE') return 'restore';
  if (intent === 'next' || intent === 'jump') return intent;
  return 'direct';
}
