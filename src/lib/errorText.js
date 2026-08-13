// Человеческий текст ошибки по машинному `code` edge-контракта (TRIP-400, 1а).
//
// Клиент НИКОГДА не показывает серверную прозу (`message` из тела ответа) — она
// не локализована, не вычитана и может утечь деталью реализации. Вместо этого
// каждый `code` (`FORBIDDEN`, `NOT_FOUND`, `INVALID_INPUT`…) переводится в строку
// из namespace `err.*` через обычный `t()`. Одна дверь на весь клиент, заводится
// в домене аккаунта (TRIP-400) и переиспользуется всеми доменами блока 3.
//
// Фолбэк — `err.temporary`: под него уходит `code === null` (сеть/relay-сбой, у
// него кода нет) И любой код, которому ещё не завели строку. Реестр
// `errorCodes.js` — источник набора кодов; `errorText.test.js` идёт по нему и
// падает, если у известного кода нет строки в `err.json` (DoD «errorText
// покрывает реестр»).

import { REFUSAL_CODES } from './errorCodes.js';

const FALLBACK_KEY = 'err.temporary';

/**
 * @param {(key: string, vars?: Record<string, any>) => string} t  из `useI18n()`
 * @param {string|null|undefined} code  машинный `code` из `invokeFn` (не `data.code`)
 * @returns {string} локализованная, безопасная для показа строка
 */
export function errorText(t, code) {
  if (code && typeof code === 'string') {
    const key = `err.${code}`;
    const msg = t(key);
    // `t()` возвращает сам адрес, когда строки нет (active → en-фолбэк → сырой
    // ключ). Совпадение = строки для кода нет → уводим в общий `err.temporary`,
    // а не показываем пользователю `err.SOME_CODE`.
    if (msg !== key) return msg;
  }
  return t(FALLBACK_KEY);
}

/**
 * Трактовка отказа для показа — ЕДИНСТВЕННАЯ карта код→трактовка на клиенте.
 * Потребитель ветвится по `kind`, а не по литералу кода: локальные карты
 * (`AI_ERROR_KEY`/`BUDGET_REFUSAL`/`REFUSAL_CLAUSE`) схлопнуты сюда.
 *   - `upsell`  — `PRO_REQUIRED`: открыть Pro-апселл (модалку), а не тост.
 *   - `refusal` — намеренное «нет» бизнес-логики (`REFUSAL_CODES`): показать текст.
 *   - `error`   — временный/неизвестный сбой: тот же безопасный текст, семантика
 *                 «повторяемо».
 * `text` ВСЕГДА через `errorText` — серверная проза пользователю не течёт.
 *
 * @param {(key: string, vars?: Record<string, any>) => string} t  из `useI18n()`
 * @param {string|null|undefined} code  машинный `code` из `invokeFn` (не `data.code`)
 * @returns {{ kind: 'upsell'|'refusal'|'error', text: string }}
 */
export function classifyError(t, code) {
  let kind = 'error';
  if (code === 'PRO_REQUIRED') kind = 'upsell';
  else if (code && REFUSAL_CODES.has(code)) kind = 'refusal';
  return { kind, text: errorText(t, code) };
}
