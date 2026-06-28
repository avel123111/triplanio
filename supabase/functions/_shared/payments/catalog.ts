/**
 * catalog — чтение внутреннего каталога продуктов из БД (таблицы product /
 * provider_price). Заменяет хардкод product-id из stripeCatalog.ts.
 *
 * Каталог провайдер-нейтрален. Различие test/live несёт колонка provider_env;
 * рантайм выбирает строки по режиму секретного ключа (stripeEnv).
 */

import { supabaseAdmin } from '../supabaseAdmin.ts';
import { isTestStripeKey } from '../stripeCatalog.ts';
import type { ProviderEnv } from './types.ts';

export type ProductCode = 'trip_pro_lifetime' | 'account_pro_monthly' | 'account_pro_yearly';
export type PlanType = 'pro_trip' | 'pro_monthly' | 'pro_yearly';

// Переходный мост: фронт/edge ещё говорят на plan_type, каталог — на product_code.
// Уйдёт в Ф5, когда все перейдут на product_code.
export const PLAN_TO_PRODUCT: Record<PlanType, ProductCode> = {
  pro_trip: 'trip_pro_lifetime',
  pro_monthly: 'account_pro_monthly',
  pro_yearly: 'account_pro_yearly',
};
export const PRODUCT_TO_PLAN: Record<ProductCode, PlanType> = {
  trip_pro_lifetime: 'pro_trip',
  account_pro_monthly: 'pro_monthly',
  account_pro_yearly: 'pro_yearly',
};

export function stripeEnv(stripeKey: string): ProviderEnv {
  return isTestStripeKey(stripeKey) ? 'test' : 'live';
}

export interface ProviderProductRow {
  product_code: ProductCode;
  provider_product_id: string;
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
    .select('product_code, provider_product_id')
    .eq('provider', provider)
    .eq('provider_env', env)
    .eq('active', true);
  if (error) {
    console.error('getActiveProviderProducts failed:', error.message);
    return [];
  }
  return (data ?? []) as ProviderProductRow[];
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
