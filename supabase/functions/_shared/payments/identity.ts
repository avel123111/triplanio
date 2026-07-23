/**
 * identity — единый резолв личности подписки: (user_id, product_code).
 *
 * Схлопывает три расходившихся копии одной логики (webhook resolveRecurringUser —
 * metadata-only; customer.subscription.updated — catalog-only; reconcile —
 * catalog-first + metadata-фолбэк) в один водопад «от самого надёжного источника»:
 *
 *   user_id      — existing-строка → sub.metadata.user_id → обратный lookup
 *                  provider_customer. Metadata-first: владелец подписки иммутабелен,
 *                  metadata ставит наш checkout при создании. metadata.user_id на
 *                  Dashboard-подписке — осознанный операционный люк владельца
 *                  Stripe-аккаунта (читается из refetch'нутого объекта, не из тела
 *                  события).
 *   product_code — existing-строка → каталог по ТЕКУЩЕМУ price.product →
 *                  metadata-фолбэк. Catalog-first: смена плана заменяет price, а
 *                  metadata Stripe не переписывает — она навсегда снапшот момента
 *                  покупки, поэтому расхождение с каталогом = штатная смена плана,
 *                  не аномалия (и не репортится).
 */

import type { SupabaseClient } from 'npm:@supabase/supabase-js@2';
import type Stripe from 'npm:stripe@17.0.0';
import { isProductCode, type ProductCode } from './productCodes.ts';
import { getUserIdForProviderCustomer } from './customer.ts';

/** Минимальный контракт адаптера: product id провайдера → наш product_code. */
interface CatalogAdapter {
  productCodeForProviderProduct(providerProductId: string): Promise<ProductCode | null>;
}

/** Репортер аномалии (инжектится — модуль остаётся чистым для CI-шага deno test,
 *  паттерн как `resolve` в getCatalogPricesCached). Вебхук передаёт reportPaymentAnomaly. */
type AnomalyReporter = (tag: string, extra: Record<string, unknown>, level: 'error') => Promise<void>;

/**
 * product_code подписки. Каталог попал → немедленный return, metadata не читается.
 * `codeByProduct` — предзагруженный map каталога (батч-цикл reconcile, 0 запросов);
 * без него — один запрос каталога через адаптер.
 * `metadataFallback: false` — ветка customer.subscription.updated: при catalog-miss
 * вернуть null и СОХРАНИТЬ прежний код строки; откат на stale-снапшот покупки в
 * хендлере смены плана был бы задом-наперёд.
 */
export async function resolveProductCodeFromSub(
  sub: Stripe.Subscription,
  adapter: CatalogAdapter,
  opts: { codeByProduct?: Map<string, ProductCode>; metadataFallback?: boolean } = {},
): Promise<ProductCode | null> {
  const price = sub.items?.data?.[0]?.price as Stripe.Price | undefined;
  const productId = typeof price?.product === 'string'
    ? price.product : ((price?.product as { id?: string } | undefined)?.id ?? null);
  if (productId) {
    const catalogCode = opts.codeByProduct
      ? opts.codeByProduct.get(productId) ?? null
      : await adapter.productCodeForProviderProduct(productId);
    if (catalogCode) return catalogCode;
  }
  if (opts.metadataFallback === false) return null;
  const metaCode = sub.metadata?.product_code;
  return isProductCode(metaCode) ? metaCode : null;
}

/** user_id владельца: metadata → обратный lookup provider_customer. */
export async function resolveUserIdFromSub(
  admin: SupabaseClient,
  sub: Stripe.Subscription,
): Promise<string | null> {
  const metaUser = sub.metadata?.user_id;
  if (typeof metaUser === 'string' && metaUser) return metaUser;
  const customerId = typeof sub.customer === 'string' ? sub.customer : (sub.customer?.id ?? null);
  return await getUserIdForProviderCustomer(admin, customerId);
}

/**
 * Оркестратор для вебхука: existing-строка тотальна (обе колонки NOT NULL),
 * иначе водопады выше. Только подписочные account_pro_*. Провал →
 * sub_unresolved_user (теперь строго: не в строке, не в metadata, не по
 * provider_customer, не в каталоге) → null, вызывающий делает break.
 * Hit-путь сознательно НЕ освежает product_code из sub — смену плана ведёт
 * хендлер customer.subscription.updated.
 */
export async function resolveSubscriptionIdentity(
  admin: SupabaseClient,
  adapter: CatalogAdapter,
  sub: Stripe.Subscription,
  ctx: string,
  existing: { user_id?: string; product_code?: string } | null | undefined,
  reportAnomaly: AnomalyReporter,
): Promise<{ userId: string; productCode: ProductCode } | null> {
  const userId = existing?.user_id ?? await resolveUserIdFromSub(admin, sub);
  const productCode = (existing?.product_code as ProductCode | undefined)
    ?? await resolveProductCodeFromSub(sub, adapter);
  if (!userId || (productCode !== 'account_pro_monthly' && productCode !== 'account_pro_yearly')) {
    await reportAnomaly('sub_unresolved_user', { ctx, sub_id: sub.id }, 'error');
    return null;
  }
  return { userId, productCode };
}
