/**
 * productCodes — единый вокабуляр продукта, ЧИСТЫЙ модуль (без env / БД / SDK).
 *
 * Вынесен из catalog.ts, чтобы модули, которым нужен только словарь кодов
 * (identity.ts и его юнит-тесты), не тянули модульный supabaseAdmin —
 * CI-шаг `deno test` гоняет чистые хелперы без env. catalog.ts ре-экспортирует
 * всё отсюда, потребители каталога не меняются.
 */

export type ProductCode = 'trip_pro_lifetime' | 'account_pro_monthly' | 'account_pro_yearly';
export const VALID_PRODUCTS = ['trip_pro_lifetime', 'account_pro_monthly', 'account_pro_yearly'] as const;

/** Является ли строка валидным product_code (для проверки входа/metadata). */
export function isProductCode(value: unknown): value is ProductCode {
  return typeof value === 'string' && (VALID_PRODUCTS as readonly string[]).includes(value);
}
