/**
 * Характеризационные тесты buildSubscriptionUpsertRow.
 *
 * Каждый ожидаемый объект выведен НАПРЯМУЮ из инлайн-кода stripe-webhook (ссылки на
 * строки — на момент написания). Пинят набор ключей (присутствует/отсутствует) и
 * `provider_meta` (null vs нет) для всех 4 рекуррентных UPSERT-веток.
 *
 * ЕДИНСТВЕННОЕ намеренное отличие от старого инлайна: `current_period_end` теперь
 * НИКОГДА не пишется null'ом (checkout-new/invoice.paid-new раньше писали его
 * безусловно). Гармонизировано с reconcile/payment_failed/invoice.updated — null'ом
 * нельзя затирать «оплачено до», его читает recompute как границу права.
 *
 * Запуск: deno test supabase/functions/_shared/payments/subscriptionRow_test.ts
 */

import { assert, assertEquals } from 'jsr:@std/assert@^1.0.8';
import { buildSubscriptionUpsertRow } from './subscriptionRow.ts';

const PERIOD = '2026-07-15T00:00:00.000Z';
const NEXT = '2026-07-20T00:00:00.000Z';

// ---------------------------------------------------------------------------
// Ветка B — checkout.session.completed, новая подписка (index.ts:236–243)
//   { user_id, product_code, provider, provider_subscription_id, provider_ref,
//     status: isDup?'duplicate':status, needs_review: isDup, current_period_end,
//     cancel_at_period_end, amount, currency, billing_interval }
//   ⤷ provider_meta ОТСУТСТВУЕТ; current_period_end — только при непустой дате.
// ---------------------------------------------------------------------------
Deno.test('B checkout-new: healthy row matches inline shape', () => {
  const row = buildSubscriptionUpsertRow({
    userId: 'u1',
    productCode: 'account_pro_monthly',
    providerSubscriptionId: 'sub_1',
    providerRef: 'cs_1',
    amount: 999,
    status: 'active',
    needsReview: false,
    cancelAtPeriodEnd: false,
    currentPeriodEnd: PERIOD,
    currency: 'usd',
    billingInterval: 'month',
    providerMeta: { mode: 'leave' },
  });
  assertEquals(row, {
    user_id: 'u1',
    product_code: 'account_pro_monthly',
    provider: 'stripe',
    provider_subscription_id: 'sub_1',
    status: 'active',
    cancel_at_period_end: false,
    currency: 'usd',
    billing_interval: 'month',
    current_period_end: PERIOD,
    needs_review: false,
    provider_ref: 'cs_1',
    amount: 999,
  });
  assert(!('provider_meta' in row));
});

Deno.test('B checkout-new: duplicate → status=duplicate, needs_review=true', () => {
  const row = buildSubscriptionUpsertRow({
    userId: 'u1',
    productCode: 'account_pro_yearly',
    providerSubscriptionId: 'sub_1',
    providerRef: 'cs_1',
    amount: 9999,
    status: 'duplicate', // caller passes isDup ? 'duplicate' : status
    needsReview: true,
    cancelAtPeriodEnd: false,
    currentPeriodEnd: PERIOD,
    currency: 'usd',
    billingInterval: 'year',
    providerMeta: { mode: 'leave' },
  });
  assertEquals(row.status, 'duplicate');
  assertEquals(row.needs_review, true);
  assertEquals(row.billing_interval, 'year');
});

Deno.test('B checkout-new: null period OMITTED (never null-clobbers a known date)', () => {
  const row = buildSubscriptionUpsertRow({
    userId: 'u1',
    productCode: 'account_pro_monthly',
    providerSubscriptionId: 'sub_1',
    providerRef: 'cs_1',
    amount: null,
    status: 'active',
    needsReview: false,
    cancelAtPeriodEnd: false,
    currentPeriodEnd: null,
    currency: 'usd',
    billingInterval: 'month',
    providerMeta: { mode: 'leave' },
  });
  assert(!('current_period_end' in row)); // null period → ключ не пишется (см. recompute-границу)
  assertEquals(row.amount, null); // amount key present even when null (was passed)
});

// ---------------------------------------------------------------------------
// Ветка D — invoice.paid, новая строка (index.ts:281–287)
//   { user_id, product_code, provider, provider_subscription_id,
//     status: isDup?'duplicate':sub.status, needs_review, current_period_end,
//     cancel_at_period_end, currency, billing_interval }
//   ⤷ НЕТ provider_ref, НЕТ amount, НЕТ provider_meta.
// ---------------------------------------------------------------------------
Deno.test('D invoice.paid-new: no provider_ref / amount / provider_meta', () => {
  const row = buildSubscriptionUpsertRow({
    userId: 'u2',
    productCode: 'account_pro_monthly',
    providerSubscriptionId: 'sub_2',
    status: 'active',
    needsReview: false,
    cancelAtPeriodEnd: false,
    currentPeriodEnd: PERIOD,
    currency: 'eur',
    billingInterval: 'month',
    providerMeta: { mode: 'leave' },
  });
  assertEquals(row, {
    user_id: 'u2',
    product_code: 'account_pro_monthly',
    provider: 'stripe',
    provider_subscription_id: 'sub_2',
    status: 'active',
    cancel_at_period_end: false,
    currency: 'eur',
    billing_interval: 'month',
    current_period_end: PERIOD,
    needs_review: false,
  });
  assert(!('provider_ref' in row));
  assert(!('amount' in row));
  assert(!('provider_meta' in row));
});

// ---------------------------------------------------------------------------
// Ветка E — invoice.payment_failed (index.ts:309–317)
//   { user_id, product_code, provider, provider_subscription_id, status,
//     cancel_at_period_end, ...(periodEndIso ? {current_period_end} : {}),
//     currency, billing_interval,
//     ...(nextAttemptIso ? {provider_meta:{next_payment_attempt}} : {}) }
//   ⤷ НЕТ needs_review; current_period_end и provider_meta — УСЛОВНЫЕ.
// ---------------------------------------------------------------------------
Deno.test('E payment_failed: with next attempt → provider_meta set', () => {
  const row = buildSubscriptionUpsertRow({
    userId: 'u3',
    productCode: 'account_pro_yearly',
    providerSubscriptionId: 'sub_3',
    status: 'past_due',
    cancelAtPeriodEnd: false,
    currentPeriodEnd: PERIOD,
    currency: 'usd',
    billingInterval: 'year',
    providerMeta: { mode: 'set', nextPaymentAttempt: NEXT },
  });
  assertEquals(row, {
    user_id: 'u3',
    product_code: 'account_pro_yearly',
    provider: 'stripe',
    provider_subscription_id: 'sub_3',
    status: 'past_due',
    cancel_at_period_end: false,
    currency: 'usd',
    billing_interval: 'year',
    current_period_end: PERIOD,
    provider_meta: { next_payment_attempt: NEXT },
  });
  assert(!('needs_review' in row));
});

Deno.test('E payment_failed: no next attempt → provider_meta omitted', () => {
  const row = buildSubscriptionUpsertRow({
    userId: 'u3',
    productCode: 'account_pro_yearly',
    providerSubscriptionId: 'sub_3',
    status: 'past_due',
    cancelAtPeriodEnd: false,
    currentPeriodEnd: PERIOD,
    currency: 'usd',
    billingInterval: 'year',
    providerMeta: { mode: 'leave' },
  });
  assert(!('provider_meta' in row));
});

Deno.test('E payment_failed: null period → current_period_end omitted', () => {
  const row = buildSubscriptionUpsertRow({
    userId: 'u3',
    productCode: 'account_pro_yearly',
    providerSubscriptionId: 'sub_3',
    status: 'past_due',
    cancelAtPeriodEnd: false,
    currentPeriodEnd: null,
    currency: 'usd',
    billingInterval: 'year',
    providerMeta: { mode: 'leave' },
  });
  assert(!('current_period_end' in row));
});

// ---------------------------------------------------------------------------
// Ветка F — invoice.updated (index.ts:345–353)
//   как E, но provider_meta выставляется ВСЕГДА (nextAttemptIso гарантирован
//   ранним break при отсутствии).
// ---------------------------------------------------------------------------
Deno.test('F invoice.updated: provider_meta always set, period conditional', () => {
  const row = buildSubscriptionUpsertRow({
    userId: 'u4',
    productCode: 'account_pro_monthly',
    providerSubscriptionId: 'sub_4',
    status: 'active',
    cancelAtPeriodEnd: true,
    currentPeriodEnd: null,
    currency: 'usd',
    billingInterval: 'month',
    providerMeta: { mode: 'set', nextPaymentAttempt: NEXT },
  });
  assertEquals(row, {
    user_id: 'u4',
    product_code: 'account_pro_monthly',
    provider: 'stripe',
    provider_subscription_id: 'sub_4',
    status: 'active',
    cancel_at_period_end: true,
    currency: 'usd',
    billing_interval: 'month',
    provider_meta: { next_payment_attempt: NEXT },
  });
  assert(!('current_period_end' in row));
});

// ---------------------------------------------------------------------------
// Прямые юнит-тесты на сам дискриминатор provider_meta (анти-footgun).
// ---------------------------------------------------------------------------
Deno.test('provider_meta directive: leave omits the key', () => {
  const row = base({ providerMeta: { mode: 'leave' } });
  assert(!('provider_meta' in row));
});

Deno.test('provider_meta directive: clear writes null (grace reset)', () => {
  const row = base({ providerMeta: { mode: 'clear' } });
  assert('provider_meta' in row);
  assertEquals(row.provider_meta, null);
});

Deno.test('provider_meta directive: set writes { next_payment_attempt }', () => {
  const row = base({ providerMeta: { mode: 'set', nextPaymentAttempt: NEXT } });
  assertEquals(row.provider_meta, { next_payment_attempt: NEXT });
});

// Маленький хелпер: общий каркас + переопределение поля под конкретный кейс.
function base(over: Partial<Parameters<typeof buildSubscriptionUpsertRow>[0]>) {
  return buildSubscriptionUpsertRow({
    userId: 'u',
    productCode: 'account_pro_monthly',
    providerSubscriptionId: 'sub',
    status: 'active',
    cancelAtPeriodEnd: false,
    currentPeriodEnd: PERIOD,
    currency: 'usd',
    billingInterval: 'month',
    providerMeta: { mode: 'leave' },
    ...over,
  });
}
