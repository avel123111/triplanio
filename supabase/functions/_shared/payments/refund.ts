/**
 * refund — чистые предикаты формы Stripe.Charge для рефанд/диспут-логики.
 *
 * Дом отдельный (не в stripeAdapter.ts): адаптер тянет рантайм `import Stripe`,
 * а здесь только `import type` → предикат покрывается обычным `deno test` без
 * подтягивания Stripe SDK (как чистые билдеры subscriptionRow/purchaseRow).
 */

import type Stripe from 'npm:stripe@17.0.0';

/**
 * Полный ли возврат по charge. Частичный рефанд Pro НЕ снимает — снимает только
 * полный (или диспут, который проверяется отдельно). Единый источник для
 * stripe-webhook (charge.refunded) и reconcileTripEntitlement (само-лечение
 * потерянного refund/dispute) — раньше был скопирован слово-в-слово в обоих.
 */
export function isFullyRefunded(charge: Stripe.Charge): boolean {
  return charge.refunded === true
    || (typeof charge.amount === 'number' && typeof charge.amount_refunded === 'number'
        && charge.amount > 0 && charge.amount_refunded >= charge.amount);
}
