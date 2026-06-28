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

import Stripe from 'npm:stripe@17.0.0';
import type { SupabaseClient } from 'npm:@supabase/supabase-js@2';
import { getPeriodEndUnix, unixToIso } from './getPeriodEnd.ts';
import { planTypeForProduct, isTestStripeKey } from './stripeCatalog.ts';
import { PLAN_TO_PRODUCT } from './payments/catalog.ts';
import { reportPaymentAnomaly } from './sentry.ts';
import { revokeLostProFeaturesForUser } from './revokeLostProFeatures.ts';

const THROTTLE_MIN = 10;
const ENTITLING = ['active', 'trialing', 'past_due'];

export async function reconcileEntitlement(admin: SupabaseClient, userId: string): Promise<boolean> {
  if (!userId) return false;

  // ---- Throttle ----
  const { data: u } = await admin
    .from('users').select('entitlement_synced_at, stripe_customer_id').eq('id', userId).single();
  const last = u?.entitlement_synced_at ? new Date(u.entitlement_synced_at).getTime() : 0;
  if (Number.isFinite(last) && Date.now() - last < THROTTLE_MIN * 60 * 1000) return false;

  const key = Deno.env.get('STRIPE_SECRET_KEY');
  if (!key) return false;

  // Помечаем синк сразу — медленный/падающий Stripe всё равно троттлит следующее чтение.
  await admin.from('users').update({ entitlement_synced_at: new Date().toISOString() }).eq('id', userId);

  const stripe = new Stripe(key);

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
        const sub = await stripe.subscriptions.retrieve(r.provider_subscription_id as string);
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
  } else if (u?.stripe_customer_id) {
    // stuck-FREE: строк нет, но есть customer → потерянная активация. Находим живые
    // подписки и материализуем строку (bounded throttle выше).
    try {
      const isTestEnv = isTestStripeKey(key);
      const subs = await stripe.subscriptions.list({ customer: u.stripe_customer_id as string, status: 'all', limit: 10 });
      const recovered: string[] = [];
      for (const sub of subs.data) {
        const price = sub.items?.data?.[0]?.price as Stripe.Price | undefined;
        const productId = typeof price?.product === 'string'
          ? price.product : ((price?.product as { id?: string } | undefined)?.id ?? null);
        const planType = (productId ? planTypeForProduct(productId, isTestEnv) : null)
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
            .from('subscription').select('id').eq('user_id', userId).in('status', ENTITLING).limit(1);
          const isDup = live && live.length > 0 && ENTITLING.includes(sub.status);
          await admin.from('subscription').insert({
            user_id: userId, product_code: productCode, provider: 'stripe',
            provider_subscription_id: sub.id, status: isDup ? 'duplicate' : sub.status, needs_review: !!isDup,
            cancel_at_period_end: sub.cancel_at_period_end === true,
            billing_interval: productCode === 'account_pro_monthly' ? 'month' : 'year',
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
