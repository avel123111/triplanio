/**
 * Характеризационные тесты isFullyRefunded — предикат «полный возврат» (частичный
 * рефанд Pro НЕ снимает). Раньше был инлайн-скопирован в stripe-webhook и
 * reconcileTripEntitlement; тесты пинят все ветки предиката.
 *
 * Запуск: deno test supabase/functions/_shared/payments/refund_test.ts
 */

import { assertEquals } from 'jsr:@std/assert@^1.0.8';
import type Stripe from 'npm:stripe@17.0.0';
import { isFullyRefunded } from './refund.ts';

// Минимальная форма charge под предикат (только читаемые им поля).
function charge(over: { refunded?: boolean; amount?: number; amount_refunded?: number }): Stripe.Charge {
  return over as unknown as Stripe.Charge;
}

Deno.test('refunded flag true → полный', () => {
  assertEquals(isFullyRefunded(charge({ refunded: true })), true);
});

Deno.test('частичный (amount_refunded < amount) → НЕ полный', () => {
  assertEquals(isFullyRefunded(charge({ refunded: false, amount: 1000, amount_refunded: 400 })), false);
});

Deno.test('полный по сумме (amount_refunded >= amount) → полный', () => {
  assertEquals(isFullyRefunded(charge({ refunded: false, amount: 1000, amount_refunded: 1000 })), true);
});

Deno.test('over-refund (amount_refunded > amount) → полный', () => {
  assertEquals(isFullyRefunded(charge({ refunded: false, amount: 1000, amount_refunded: 1500 })), true);
});

Deno.test('нулевой amount (amount=0, refunded=0) → НЕ полный (amount>0 не выполнен)', () => {
  assertEquals(isFullyRefunded(charge({ refunded: false, amount: 0, amount_refunded: 0 })), false);
});

Deno.test('нет сумм и refunded=false → НЕ полный', () => {
  assertEquals(isFullyRefunded(charge({ refunded: false })), false);
});
