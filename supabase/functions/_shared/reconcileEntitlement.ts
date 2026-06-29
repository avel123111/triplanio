/**
 * reconcileEntitlement — ленивый "recompute-on-read" reconcile (Ф2b: реестр subscription).
 *
 * recompute_user_entitlement() дешёвый (DB). Это ДОРОГОЙ путь: тянет состояние
 * подписки из Stripe, обновляет/создаёт строку subscription, зовёт recompute.
 * Само-лечит потерянный вебхук при открытии экрана, не долбя Stripe на каждое чтение.
 *
 * Два направления (оба throttled через users.entitlement_synced_at):
 *   • stuck-PRO  — кэш pro, но период протух (потерянное продление): по строкам с
 *     provider_subscription_id retrieve+refresh.
 *   • stuck-FREE — кэш free, но есть Stripe customer (потерянная активация): list
 *     подписок клиента и материализуем строку, чтобы recompute вернул Pro.
 */

import type { SupabaseClient } from 'npm:@supabase/supabase-js@2';
import type Stripe from 'npm:stripe@17.0.0';
import { getPeriodEndUnix, unixToIso } from './getPeriodEnd.ts';
import { PLAN_TO_PRODUCT, PRODUCT_TO_PLAN, stripeEnv, getActiveProviderProducts, billingIntervalForProduct, ENTITLING_STATUSES, type ProductCode } from './payments/catalog.ts';
import { StripeAdapter } from './payments/stripeAdapter.ts';
import { getProviderCustomerId } from './payments/customer.ts';
import { reportPaymentAnomaly } from './sentry.ts';
import { revokeLostProFeaturesForUser, revokeLostProFeaturesForTrip } from './revokeLostProFeatures.ts';

const THROTTLE_MIN = 10;

/**
 * Нужен ли recompute-on-read для юзера (единый предикат, O1 — был продублирован в
 * getUserPlan + checkSubscriptionStatus ×2). Два перекоса:
 *   • stuck-PRO  — кэш 'pro', но end протух/пуст (потерянное продление);
 *   • stuck-FREE — кэш не 'pro', но есть provider_customer (потерянная активация).
 * Проверку наличия customer делаем ТОЛЬКО в ветке не-pro (иначе она не нужна).
 */
export async function needsEntitlementReconcile(
  admin: SupabaseClient,
  userId: string,
  status: string | null | undefined,
  endDate: string | null | undefined,
): Promise<boolean> {
  if (status === 'pro') return !endDate || new Date(endDate) <= new Date();
  return (await getProviderCustomerId(admin, userId)) !== null;
}

export async function reconcileEntitlement(admin: SupabaseClient, userId: string): Promise<boolean> {
  if (!userId) return false;

  // ---- Throttle ----
  const { data: u } = await admin
    .from('users').select('entitlement_synced_at').eq('id', userId).single();
  const last = u?.entitlement_synced_at ? new Date(u.entitlement_synced_at).getTime() : 0;
  if (Number.isFinite(last) && Date.now() - last < THROTTLE_MIN * 60 * 1000) return false;

  const key = Deno.env.get('STRIPE_SECRET_KEY');
  if (!key) return false;

  // Платёжная идентичность — из provider_customer (колонка users.stripe_customer_id дропнута).
  const customerId = await getProviderCustomerId(admin, userId);

  // Помечаем синк сразу — медленный/падающий Stripe всё равно троттлит следующее чтение.
  await admin.from('users').update({ entitlement_synced_at: new Date().toISOString() }).eq('id', userId);

  const adapter = new StripeAdapter(key, stripeEnv(key));

  const { data: rows } = await admin
    .from('subscription')
    .select('id, provider_subscription_id')
    .eq('user_id', userId)
    .in('product_code', ['account_pro_monthly', 'account_pro_yearly'])
    .not('provider_subscription_id', 'is', null);

  if (rows && rows.length > 0) {
    // stuck-PRO: освежаем статус/период имеющихся строк.
    for (const r of rows) {
      try {
        const sub = await adapter.fetchSubscription(r.provider_subscription_id as string);
        const iso = unixToIso(getPeriodEndUnix(sub));
        await admin.from('subscription').update({
          status: sub.status,
          cancel_at_period_end: sub.cancel_at_period_end === true,
          ...(iso ? { current_period_end: iso } : {}),
        }).eq('id', r.id);
      } catch (e) {
        console.error('reconcileEntitlement: retrieve failed', r.provider_subscription_id, (e as Error).message);
      }
    }
  } else if (customerId) {
    // stuck-FREE: строк нет, но есть customer → потерянная активация. Находим живые
    // подписки и материализуем строку (bounded throttle выше).
    try {
      // product_id → product_code из каталога БД (один запрос на весь список).
      const codeByProduct = new Map<string, ProductCode>(
        (await getActiveProviderProducts('stripe', adapter.env)).map((r) => [r.provider_product_id, r.product_code] as [string, ProductCode]),
      );
      const subs = await adapter.listSubscriptionsByCustomer(customerId, 10);
      const recovered: string[] = [];
      for (const sub of subs) {
        const price = sub.items?.data?.[0]?.price as Stripe.Price | undefined;
        const productId = typeof price?.product === 'string'
          ? price.product : ((price?.product as { id?: string } | undefined)?.id ?? null);
        const code = productId ? codeByProduct.get(productId) ?? null : null;
        const planType = (code ? PRODUCT_TO_PLAN[code] : null)
          ?? ((sub.metadata?.plan_type as string | undefined) ?? null);
        if (planType !== 'pro_monthly' && planType !== 'pro_yearly') continue;
        const productCode = PLAN_TO_PRODUCT[planType];
        const iso = unixToIso(getPeriodEndUnix(sub));

        // Уже есть строка по этому sub id? Обновляем; иначе вставляем (партиал-уник
        // на provider_subscription_id плохо годится как onConflict-таргет, поэтому явно).
        const { data: ex } = await admin
          .from('subscription').select('id').eq('provider_subscription_id', sub.id).limit(1);
        if (ex && ex.length > 0) {
          await admin.from('subscription').update({
            status: sub.status, cancel_at_period_end: sub.cancel_at_period_end === true,
            ...(iso ? { current_period_end: iso } : {}),
          }).eq('id', ex[0].id);
        } else {
          // Дубль-гард: не плодим вторую энтайтлинг-строку юзеру.
          const { data: live } = await admin
            .from('subscription').select('id').eq('user_id', userId).in('status', [...ENTITLING_STATUSES]).limit(1);
          const isDup = live && live.length > 0 && (ENTITLING_STATUSES as readonly string[]).includes(sub.status);
          await admin.from('subscription').insert({
            user_id: userId, product_code: productCode, provider: 'stripe',
            provider_subscription_id: sub.id, status: isDup ? 'duplicate' : sub.status, needs_review: !!isDup,
            cancel_at_period_end: sub.cancel_at_period_end === true,
            billing_interval: billingIntervalForProduct(productCode),
            ...(iso ? { current_period_end: iso } : {}),
          });
        }
        recovered.push(sub.id);
      }
      if (recovered.length > 0) {
        await reportPaymentAnomaly('reconcile_recovered_sub', { user_id: userId, sub_ids: recovered }, 'warning');
      }
    } catch (e) {
      console.error('reconcileEntitlement: list-by-customer failed', (e as Error).message);
    }
  }

  await admin.rpc('recompute_user_entitlement', { p_user_id: userId });
  await revokeLostProFeaturesForUser(admin, userId);
  return true;
}

/**
 * Ленивый reconcile разовой Trip Pro (симметрия подписочному выше). Закрывает
 * асимметрию: для подписок потерянный вебхук само-лечился, а для pro_trip —
 * нет, и потерянный refund/dispute оставлял трип Pro навсегда.
 *
 * Направление одно — stuck-PRO: trips.is_pro_trip=true, но активная покупка трипа
 * по факту зарефанжена/диспутнута в Stripe (вебхук потерялся). stuck-FREE для
 * pro_trip не делаем: после оплаты фронт сам поллит is_pro_trip, повторная покупка
 * — отдельный платёж, материализовать «потерянную» покупку без checkout-id нечем.
 *
 * Троттл — purchase.synced_at (10 мин на трип, как users.entitlement_synced_at);
 * общий ресурс: все участники, открывшие трип, делят одну сверку.
 * Зовётся ТОЛЬКО когда is_pro_trip=true (иначе сверять нечего). Возвращает true,
 * если реально сходил в Stripe (вызывающий перечитает is_pro_trip).
 */
export async function reconcileTripEntitlement(admin: SupabaseClient, tripId: string): Promise<boolean> {
  if (!tripId) return false;

  const { data: rows } = await admin
    .from('purchase')
    .select('id, provider_charge_id, synced_at')
    .eq('trip_id', tripId)
    .eq('product_code', 'trip_pro_lifetime')
    .eq('status', 'active')
    .limit(1);
  const p = rows && rows.length > 0 ? rows[0] : null;
  if (!p || !p.provider_charge_id) return false; // нечего/нечем сверять

  // ---- Throttle ----
  const last = p.synced_at ? new Date(p.synced_at as string).getTime() : 0;
  if (Number.isFinite(last) && Date.now() - last < THROTTLE_MIN * 60 * 1000) return false;

  const key = Deno.env.get('STRIPE_SECRET_KEY');
  if (!key) return false;

  // Помечаем синк сразу — медленный/падающий Stripe всё равно троттлит следующее чтение.
  await admin.from('purchase').update({ synced_at: new Date().toISOString() }).eq('id', p.id);

  const adapter = new StripeAdapter(key, stripeEnv(key));
  try {
    // provider_charge_id у pro_trip — payment_intent. Тянем его charge и смотрим
    // полный рефанд / диспут (как вебхук: частичный рефанд Pro НЕ снимает).
    const pi = await adapter.fetchPaymentIntent(p.provider_charge_id as string, { expand: ['latest_charge'] });
    const charge = (typeof pi.latest_charge === 'object' ? pi.latest_charge : null) as Stripe.Charge | null;
    if (!charge) return true;
    const fullyRefunded = charge.refunded === true
      || (typeof charge.amount === 'number' && typeof charge.amount_refunded === 'number'
          && charge.amount > 0 && charge.amount_refunded >= charge.amount);
    const disputed = charge.disputed === true;
    if (fullyRefunded || disputed) {
      await admin.from('purchase').update({
        status: fullyRefunded ? 'refunded' : 'disputed',
        ...(fullyRefunded ? { refunded_at: new Date().toISOString() } : {}),
      }).eq('id', p.id);
      await admin.rpc('recompute_trip_entitlement', { p_trip_id: tripId });
      await revokeLostProFeaturesForTrip(admin, tripId);
      await reportPaymentAnomaly('reconcile_revoked_trip', { trip_id: tripId, payment_intent: p.provider_charge_id }, 'warning');
    }
  } catch (e) {
    console.error('reconcileTripEntitlement: payment_intent lookup failed', p.provider_charge_id, (e as Error).message);
  }
  return true;
}
