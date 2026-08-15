/**
 * Реестр кодов ошибок edge-контракта (TRIP-394, эпик TRIP-374).
 *
 * Коды ошибок = API. Edge отдаёт `{ error, code }`; клиент (и Flutter в сторе,
 * который обновляется НЕ мгновенно) ветвится по `code`. Раньше договорённость
 * держалась тем, что обе стороны набирали одну строку руками — опечатка тиха.
 * Этот файл — единый СЛОВАРЬ кодов; CI-гард 2v (`check-error-codes.mjs`) держит
 * две гарантии:
 *   (a) любой код, который edge ЭМИТИТ, обязан быть здесь;
 *   (b) append-only — код нельзя удалить/переименовать (он живёт в сторе дольше
 *       нашего релиза; переименование = молчаливый разрыв контракта).
 *
 * Scope v1 = канон `UPPER_SNAKE`. В edge есть и легаси-семья в нижнем регистре
 * (`rate_limited`, `email_exists`, …) + продуктовые план-коды в успешных ответах
 * (`account_pro_monthly`) — они НЕ здесь (отдельная конвенция, см. шапку гарда).
 *
 * v1 — ТОЛЬКО словарь: коды в старых местах остаются строковыми литералами,
 * импорт символа во все точки едет доменным свипом. Новый код добавляй СЮДА
 * (в алфавит) — иначе гард 2v красный.
 *
 * Зеркало для клиента (Vite/JS) — `src/lib/errorCodes.js`: edge не импортирует
 * из `src/`, разные рантаймы. `src/lib/errorCodes.test.js` читает ЭТОТ файл как
 * текст и падает при расхождении наборов (приём `viralLink.js/.ts`).
 */

export const ERROR_CODES = [
  'ALREADY_HANDLED',
  'ALREADY_MEMBER',
  'ALREADY_RESPONDED',
  'AUTH_UNAVAILABLE',
  'BAD_REQUEST',
  'CATEGORY_SYSTEM',
  'DOC_PRIVATE_NOT_OWNER',
  'EXPENSE_NOT_MANUAL',
  'FORBIDDEN',
  'INTERNAL',
  'INVALID_BODY',
  'INVALID_INPUT',
  'INVITE_OWNER',
  'INVITE_SELF',
  'NOT_AN_AI_MESSAGE',
  'NOT_FOUND',
  'NOT_PENDING',
  'OWNER_IMMUTABLE',
  'PRO_REQUIRED',
  'RATE_LIMITED',
  'REMOVE_SELF',
  'SUBSCRIPTION_ALREADY_ACTIVE',
  'TRIP_ALREADY_PRO',
  'TRIP_ID_REQUIRED',
  'TRIP_LIMIT_REACHED',
  'UNAUTHENTICATED',
  'UNAUTHORIZED',
  'UNKNOWN_ACTION',
] as const;

export type ErrorCode = typeof ERROR_CODES[number];

/** Быстрая проверка членства (для рантайм-веток, где нужен `is a known code`). */
export const ERROR_CODE_SET: ReadonlySet<string> = new Set(ERROR_CODES);
