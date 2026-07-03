/**
 * purchaseRow — единый конструктор строки INSERT'а в таблицу `purchase` для
 * разовой покупки Trip Pro. Симметрия subscriptionRow (подписки).
 *
 * Зачем: строка purchase собиралась ИНЛАЙНОМ прямо в stripe-webhook
 * (checkout.session.completed, ветка pro_trip), тогда как подписочная ось уже
 * имела аккуратный билдер (buildSubscriptionUpsertRow). Эта функция закрывает
 * асимметрию и вместе с единым типом «нашего формата» (см. format.ts) кладёт
 * фундамент под второй провайдер (RevenueCat/IAP): «перевод» формата провайдера
 * в наш делается ОДНИМ билдером на входе, за входом Stripe уже не видно.
 *
 * Чистая функция: только примитивы на вход, объект на выход. `purchasedAt`
 * ИНЖЕКТИТСЯ вызывающим (не `new Date()` внутри) — иначе билдер недетерминирован
 * и характеризационный тест невозможен. Никаких импортов рантайма (Stripe /
 * supabaseAdmin) — покрывается обычным `deno test`.
 *
 * Операция (.insert) и идемпотентность по `provider_ref` (id чек-сессии) —
 * решение вызывающего, не форма строки. Здесь только форма.
 */

import type { ProductCode } from './catalog.ts';

export interface PurchaseInsertInput {
  userId: string;
  tripId: string;
  /** Разовый продукт покупки трипа (сейчас всегда 'trip_pro_lifetime'). */
  productCode: ProductCode;
  /** id чек-сессии провайдера — держит идемпотентность вставки. */
  providerRef: string;
  /** payment_intent провайдера (для последующего резолва рефанда/диспута). */
  providerChargeId: string | null;
  /** Статус: 'active' или 'duplicate' при детекте второй оплаты того же трипа. */
  status: string;
  needsReview: boolean;
  amount: number | null;
  currency: string;
  /** Момент покупки ISO — инжектится вызывающим ради чистоты билдера. */
  purchasedAt: string;
}

/**
 * Собирает объект строки для `.from('purchase').insert(row)`. Набор ключей
 * фиксирован (в отличие от подписки условных полей нет — разовая покупка пишется
 * целиком за один INSERT).
 */
export function buildPurchaseRow(input: PurchaseInsertInput): Record<string, unknown> {
  return {
    user_id: input.userId,
    trip_id: input.tripId,
    product_code: input.productCode,
    provider: 'stripe',
    provider_charge_id: input.providerChargeId,
    provider_ref: input.providerRef,
    status: input.status,
    needs_review: input.needsReview,
    amount: input.amount,
    currency: input.currency,
    purchased_at: input.purchasedAt,
  };
}
