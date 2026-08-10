// Реестр кодов ошибок edge-контракта — ЗЕРКАЛО для клиента (TRIP-394).
//
// Источник-близнец: supabase/functions/_shared/errorCodes.ts. Edge не может
// импортировать из src/ (разные рантаймы: Deno/TS ↔ Vite/JS), поэтому список
// продублирован. `errorCodes.test.js` читает серверный файл как ТЕКСТ и падает,
// когда два набора расходятся (тот же приём, что viralLink.js/.ts).
//
// v1 — ТОЛЬКО словарь: клиентские `code === 'X'` пока остаются литералами,
// перевод их на этот символ едет доменным свипом. Новый код добавляй в ОБА
// файла (в алфавит) — CI-гард 2v держит edge-сторону, этот тест держит зеркало.

export const ERROR_CODES = [
  'ALREADY_HANDLED',
  'AUTH_UNAVAILABLE',
  'BAD_REQUEST',
  'CATEGORY_SYSTEM',
  'DOC_PRIVATE_NOT_OWNER',
  'EXPENSE_NOT_MANUAL',
  'FORBIDDEN',
  'INTERNAL',
  'INVALID_BODY',
  'INVALID_INPUT',
  'NOT_AN_AI_MESSAGE',
  'NOT_FOUND',
  'PRO_REQUIRED',
  'RATE_LIMITED',
  'SUBSCRIPTION_ALREADY_ACTIVE',
  'TRIP_ALREADY_PRO',
  'TRIP_ID_REQUIRED',
  'TRIP_LIMIT_REACHED',
  'UNAUTHENTICATED',
  'UNAUTHORIZED',
  'UNKNOWN_ACTION',
];

/** Быстрая проверка членства. */
export const ERROR_CODE_SET = new Set(ERROR_CODES);
