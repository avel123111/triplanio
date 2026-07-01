/**
 * catalog — чтение внутреннего каталога продуктов из БД (таблицы product /
 * provider_price). ЕДИНСТВЕННЫЙ источник каталога (хардкод product-id из
 * stripeCatalog.ts удалён — он дублировал эти же строки).
 *
 * Каталог провайдер-нейтрален. Различие test/live несёт колонка provider_env;
 * рантайм выбирает строки по режиму секретного ключа (stripeEnv).
 */

import { supabaseAdmin } from '../supabaseAdmin.ts';
import type { ProviderEnv, ResolvedPrice } from './types.ts';

// Единый вокабуляр продукта — product_code (фронт, metadata провайдера, каталог и
// реестр говорят на нём же; переходный plan_type и мосты PLAN_TO_PRODUCT/
// PRODUCT_TO_PLAN выпилены — одна сущность, одно имя).
export type ProductCode = 'trip_pro_lifetime' | 'account_pro_monthly' | 'account_pro_yearly';
export const VALID_PRODUCTS = ['trip_pro_lifetime', 'account_pro_monthly', 'account_pro_yearly'] as const;

/** Является ли строка валидным product_code (для проверки входа/metadata). */
export function isProductCode(value: unknown): value is ProductCode {
  return typeof value === 'string' && (VALID_PRODUCTS as readonly string[]).includes(value);
}

/** True когда секретный ключ Stripe — тестовый (`sk_test_…`). */
export function isTestStripeKey(key: string): boolean {
  return key.includes('_test_');
}

export function stripeEnv(stripeKey: string): ProviderEnv {
  return isTestStripeKey(stripeKey) ? 'test' : 'live';
}

// Энтайтлинг-статусы подписки (держат Pro): active/trialing + грейс past_due.
// Единый источник — был продублирован константой ENTITLING в webhook / reconcile /
// createStripeCheckout и инлайном в getUserPlan. Меняешь набор грейс-статусов —
// меняешь ЗДЕСЬ, а не в 4 файлах.
export const ENTITLING_STATUSES = ['active', 'trialing', 'past_due'] as const;

// billing_interval подписочного продукта. Тернарник был размазан по ~6 местам
// (webhook ×5 + reconcile). Для trip_pro_lifetime поле не используется (разовая
// покупка), поэтому ветка else безопасна.
export function billingIntervalForProduct(code: ProductCode): 'month' | 'year' {
  return code === 'account_pro_monthly' ? 'month' : 'year';
}

export interface ProviderProductRow {
  product_code: ProductCode;
  provider_product_id: string;
  // Кэш каталожной цены (lazy TTL, TRIP-155). null у строки, ещё не синхронизированной.
  provider_price_id: string | null;
  unit_amount: number | null;
  currency: string | null;
  recurring_interval: string | null;
  price_synced_at: string | null;
}

/**
 * Активные маппинги продукт→объект провайдера для (provider, env). Возвращает []
 * если каталог ещё не наполнен (вызывающий делает переходный фолбэк до Ф5).
 */
export async function getActiveProviderProducts(
  provider: string,
  env: ProviderEnv,
): Promise<ProviderProductRow[]> {
  const { data, error } = await supabaseAdmin
    .from('provider_price')
    .select('product_code, provider_product_id, provider_price_id, unit_amount, currency, recurring_interval, price_synced_at')
    .eq('provider', provider)
    .eq('provider_env', env)
    .eq('active', true);
  if (error) {
    console.error('getActiveProviderProducts failed:', error.message);
    return [];
  }
  return (data ?? []) as ProviderProductRow[];
}

/** TTL кэша цен (lazy refresh на чтении). Цены меняются редко — часа с запасом. */
export const PRICE_CACHE_TTL_MS = 60 * 60 * 1000;

/** Свежесть price_synced_at относительно TTL. null/битая дата/просрочено → false. */
export function isPriceCacheFresh(syncedAt: string | null | undefined): boolean {
  if (!syncedAt) return false;
  const t = Date.parse(syncedAt);
  return Number.isFinite(t) && (Date.now() - t) < PRICE_CACHE_TTL_MS;
}

export interface CatalogPrice {
  product_code: ProductCode;
  price_id: string | null;
  product_id: string;
  unit_amount: number | null;
  currency: string | null;
  recurring_interval: string | null;
}

/**
 * Каталожные цены с lazy-TTL кэшем в provider_price. Свежая строка → отдаём из БД
 * без Stripe; протухшая/пустая → один resolve() + write-back свежих значений.
 * `resolve` инжектится (адаптер провайдера), чтобы модуль остался провайдер-нейтральным.
 * Write-back best-effort: сбой записи не роняет чтение цены.
 */
export async function getCatalogPricesCached(
  resolve: (providerProductId: string) => Promise<ResolvedPrice>,
  provider: string,
  env: ProviderEnv,
): Promise<CatalogPrice[]> {
  const rows = await getActiveProviderProducts(provider, env);
  return Promise.all(rows.map(async (row): Promise<CatalogPrice> => {
    if (isPriceCacheFresh(row.price_synced_at) && row.unit_amount != null) {
      return {
        product_code: row.product_code,
        price_id: row.provider_price_id,
        product_id: row.provider_product_id,
        unit_amount: row.unit_amount,
        currency: row.currency,
        recurring_interval: row.recurring_interval,
      };
    }
    const p = await resolve(row.provider_product_id);
    const { error } = await supabaseAdmin.from('provider_price').update({
      provider_price_id: p.price_id,
      unit_amount: p.unit_amount,
      currency: p.currency,
      recurring_interval: p.recurring_interval,
      price_synced_at: new Date().toISOString(),
    }).eq('provider', provider).eq('provider_env', env).eq('product_code', row.product_code).eq('active', true);
    if (error) console.error('getCatalogPricesCached write-back failed:', error.message);
    return {
      product_code: row.product_code,
      price_id: p.price_id,
      product_id: row.provider_product_id,
      unit_amount: p.unit_amount,
      currency: p.currency,
      recurring_interval: p.recurring_interval,
    };
  }));
}

/** product_code → id продукта провайдера для текущего env (или null). */
export async function providerProductIdForCode(
  provider: string,
  env: ProviderEnv,
  code: ProductCode,
): Promise<string | null> {
  const rows = await getActiveProviderProducts(provider, env);
  return rows.find((r) => r.product_code === code)?.provider_product_id ?? null;
}

/** id продукта провайдера → наш product_code для текущего env (или null). */
export async function productCodeForProviderProductId(
  provider: string,
  env: ProviderEnv,
  providerProductId: string,
): Promise<ProductCode | null> {
  const rows = await getActiveProviderProducts(provider, env);
  return rows.find((r) => r.provider_product_id === providerProductId)?.product_code ?? null;
}
