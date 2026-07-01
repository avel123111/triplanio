/**
 * Характеризационный тест buildPurchaseRow.
 *
 * Ожидаемый объект выведен НАПРЯМУЮ из инлайн-insert stripe-webhook
 * (checkout.session.completed, ветка pro_trip — index.ts на момент написания).
 * Пинит набор ключей и значения: перенос сборки в билдер обязан оставить строку
 * байт-в-байт (purchased_at инжектится → детерминирован). Симметрия
 * subscriptionRow_test.
 *
 * Запуск: deno test supabase/functions/_shared/payments/purchaseRow_test.ts
 */

import { assertEquals } from 'jsr:@std/assert@^1.0.8';
import { buildPurchaseRow } from './purchaseRow.ts';

const PURCHASED = '2026-07-01T12:00:00.000Z';

Deno.test('pro_trip: healthy purchase matches inline shape', () => {
  const row = buildPurchaseRow({
    userId: 'u1',
    tripId: 't1',
    productCode: 'trip_pro_lifetime',
    providerChargeId: 'pi_1',
    providerRef: 'cs_1',
    status: 'active',
    needsReview: false,
    amount: 4900,
    currency: 'usd',
    purchasedAt: PURCHASED,
  });
  assertEquals(row, {
    user_id: 'u1',
    trip_id: 't1',
    product_code: 'trip_pro_lifetime',
    provider: 'stripe',
    provider_charge_id: 'pi_1',
    provider_ref: 'cs_1',
    status: 'active',
    needs_review: false,
    amount: 4900,
    currency: 'usd',
    purchased_at: PURCHASED,
  });
});

Deno.test('pro_trip: duplicate → status=duplicate, needs_review=true', () => {
  const row = buildPurchaseRow({
    userId: 'u1',
    tripId: 't1',
    productCode: 'trip_pro_lifetime',
    providerChargeId: 'pi_2',
    providerRef: 'cs_2',
    status: 'duplicate', // caller passes isDup ? 'duplicate' : 'active'
    needsReview: true,
    amount: 4900,
    currency: 'usd',
    purchasedAt: PURCHASED,
  });
  assertEquals(row.status, 'duplicate');
  assertEquals(row.needs_review, true);
});

Deno.test('pro_trip: null charge id / amount pass through (never dropped)', () => {
  const row = buildPurchaseRow({
    userId: 'u1',
    tripId: 't1',
    productCode: 'trip_pro_lifetime',
    providerChargeId: null, // fresh.payment_intent not a string
    providerRef: 'cs_3',
    status: 'active',
    needsReview: false,
    amount: null, // fresh.amount_total absent
    currency: 'usd',
    purchasedAt: PURCHASED,
  });
  assertEquals(row.provider_charge_id, null);
  assertEquals(row.amount, null);
  assertEquals(row.currency, 'usd');
});
