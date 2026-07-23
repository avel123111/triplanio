/**
 * Тесты единого резолва личности подписки (identity.ts).
 *
 * Пинят водопад приоритетов:
 *   user_id      — existing → metadata → provider_customer (обратный lookup);
 *   product_code — existing → каталог по ТЕКУЩЕМУ price.product → metadata-фолбэк;
 *   каталог попал → metadata игнорируется (смена плана не откатывается на снапшот);
 *   metadataFallback:false (ветка .updated) → catalog-miss даёт null, не stale-код.
 *
 * Живой каталожный путь (без codeByProduct-map) ходит в БД и юнитом не покрыт —
 * его закрывает dev-смоук (acceptance-гейт PR). Sentry-репорт в негативных кейсах
 * no-op без SENTRY_DSN.
 *
 * Запуск: deno test -A supabase/functions/_shared/payments/identity_test.ts
 */

import { assertEquals } from 'jsr:@std/assert@^1.0.8';
import type Stripe from 'npm:stripe@17.0.0';
import type { SupabaseClient } from 'npm:@supabase/supabase-js@2';
import { resolveProductCodeFromSub, resolveUserIdFromSub, resolveSubscriptionIdentity } from './identity.ts';
import type { ProductCode } from './productCodes.ts';

// ---------------------------------------------------------------------------
// Стабы
// ---------------------------------------------------------------------------

function fakeSub(over: Record<string, unknown> = {}): Stripe.Subscription {
  return {
    id: 'sub_1',
    customer: 'cus_1',
    metadata: {},
    items: { data: [{ price: { product: 'prod_yearly' } }] },
    ...over,
  } as unknown as Stripe.Subscription;
}

/** Адаптер: каталог как словарь id→code (null = catalog-miss). */
function fakeAdapter(catalog: Record<string, ProductCode> = {}) {
  return {
    productCodeForProviderProduct: (id: string) => Promise.resolve(catalog[id] ?? null),
  };
}

/** Админ-клиент: provider_customer.select(user_id) отдаёт заданные строки. */
function fakeAdmin(rows: Array<{ user_id: string }>): SupabaseClient {
  const builder = {
    select: () => builder,
    eq: () => builder,
    limit: () => Promise.resolve({ data: rows }),
  };
  return { from: () => builder } as unknown as SupabaseClient;
}

const MAP = new Map<string, ProductCode>([['prod_yearly', 'account_pro_yearly']]);

/** Шпион репортера аномалий (инжектится в оркестратор). */
function spyReporter() {
  const calls: Array<{ tag: string; extra: Record<string, unknown> }> = [];
  const report = (tag: string, extra: Record<string, unknown>, _level: 'error') => {
    calls.push({ tag, extra });
    return Promise.resolve();
  };
  return { calls, report };
}

// ---------------------------------------------------------------------------
// resolveProductCodeFromSub
// ---------------------------------------------------------------------------

Deno.test('product: каталог по map, metadata не нужна', async () => {
  const code = await resolveProductCodeFromSub(fakeSub(), fakeAdapter(), { codeByProduct: MAP });
  assertEquals(code, 'account_pro_yearly');
});

Deno.test('product: каталог через адаптер (без map)', async () => {
  const code = await resolveProductCodeFromSub(fakeSub(), fakeAdapter({ prod_yearly: 'account_pro_yearly' }));
  assertEquals(code, 'account_pro_yearly');
});

Deno.test('product: каталог побеждает stale-metadata (смена плана)', async () => {
  const sub = fakeSub({ metadata: { product_code: 'account_pro_monthly' } });
  const code = await resolveProductCodeFromSub(sub, fakeAdapter({ prod_yearly: 'account_pro_yearly' }));
  assertEquals(code, 'account_pro_yearly');
});

Deno.test('product: metadata-фолбэк при catalog-miss', async () => {
  const sub = fakeSub({ metadata: { product_code: 'account_pro_monthly' } });
  const code = await resolveProductCodeFromSub(sub, fakeAdapter());
  assertEquals(code, 'account_pro_monthly');
});

Deno.test('product: metadataFallback:false — catalog-miss даёт null, не stale-код', async () => {
  const sub = fakeSub({ metadata: { product_code: 'account_pro_monthly' } });
  const code = await resolveProductCodeFromSub(sub, fakeAdapter(), { metadataFallback: false });
  assertEquals(code, null);
});

Deno.test('product: мусор в metadata не проходит isProductCode', async () => {
  const sub = fakeSub({ metadata: { product_code: 'not_a_code' } });
  assertEquals(await resolveProductCodeFromSub(sub, fakeAdapter()), null);
});

// ---------------------------------------------------------------------------
// resolveUserIdFromSub
// ---------------------------------------------------------------------------

Deno.test('user: metadata-first', async () => {
  const sub = fakeSub({ metadata: { user_id: 'u_meta' } });
  assertEquals(await resolveUserIdFromSub(fakeAdmin([{ user_id: 'u_lookup' }]), sub), 'u_meta');
});

Deno.test('user: фолбэк по provider_customer при пустой metadata', async () => {
  assertEquals(await resolveUserIdFromSub(fakeAdmin([{ user_id: 'u_lookup' }]), fakeSub()), 'u_lookup');
});

Deno.test('user: customer-объект (expandable) тоже резолвится', async () => {
  const sub = fakeSub({ customer: { id: 'cus_1' } });
  assertEquals(await resolveUserIdFromSub(fakeAdmin([{ user_id: 'u_lookup' }]), sub), 'u_lookup');
});

Deno.test('user: нет ни metadata, ни строки provider_customer → null', async () => {
  assertEquals(await resolveUserIdFromSub(fakeAdmin([]), fakeSub()), null);
});

// ---------------------------------------------------------------------------
// resolveSubscriptionIdentity (оркестратор)
// ---------------------------------------------------------------------------

Deno.test('identity: existing-строка побеждает всё', async () => {
  const spy = spyReporter();
  const sub = fakeSub({ metadata: { user_id: 'u_meta', product_code: 'account_pro_monthly' } });
  const r = await resolveSubscriptionIdentity(
    fakeAdmin([]), fakeAdapter({ prod_yearly: 'account_pro_yearly' }), sub, 'test',
    { user_id: 'u_row', product_code: 'account_pro_yearly' }, spy.report);
  assertEquals(r, { userId: 'u_row', productCode: 'account_pro_yearly' });
  assertEquals(spy.calls.length, 0);
});

Deno.test('identity: miss-путь — metadata-user + каталожный product', async () => {
  const spy = spyReporter();
  const sub = fakeSub({ metadata: { user_id: 'u_meta' } });
  const r = await resolveSubscriptionIdentity(
    fakeAdmin([]), fakeAdapter({ prod_yearly: 'account_pro_yearly' }), sub, 'test', null, spy.report);
  assertEquals(r, { userId: 'u_meta', productCode: 'account_pro_yearly' });
  assertEquals(spy.calls.length, 0);
});

Deno.test('identity: Dashboard-подписка без metadata — user по provider_customer', async () => {
  const spy = spyReporter();
  const r = await resolveSubscriptionIdentity(
    fakeAdmin([{ user_id: 'u_lookup' }]), fakeAdapter({ prod_yearly: 'account_pro_yearly' }), fakeSub(), 'test', null, spy.report);
  assertEquals(r, { userId: 'u_lookup', productCode: 'account_pro_yearly' });
  assertEquals(spy.calls.length, 0);
});

Deno.test('identity: не-подписочный продукт (trip_pro_lifetime) → null + аномалия', async () => {
  const spy = spyReporter();
  const r = await resolveSubscriptionIdentity(
    fakeAdmin([{ user_id: 'u_lookup' }]), fakeAdapter({ prod_yearly: 'trip_pro_lifetime' }), fakeSub(), 'test', null, spy.report);
  assertEquals(r, null);
  assertEquals(spy.calls[0]?.tag, 'sub_unresolved_user');
});

Deno.test('identity: юзер не резолвится нигде → null + аномалия', async () => {
  const spy = spyReporter();
  const r = await resolveSubscriptionIdentity(
    fakeAdmin([]), fakeAdapter({ prod_yearly: 'account_pro_yearly' }), fakeSub(), 'test', null, spy.report);
  assertEquals(r, null);
  assertEquals(spy.calls[0]?.tag, 'sub_unresolved_user');
});
