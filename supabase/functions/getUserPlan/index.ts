/**
 * getUserPlan
 *
 * GET/POST — no body required.
 *
 * Returns the caller's subscription plan and metadata.
 */

import { withHandler } from '../_shared/http.ts';
import { supabaseAdmin, getRequestUser } from '../_shared/supabaseAdmin.ts';
import type Stripe from 'npm:stripe@17.0.0';
import { reconcileEntitlement, needsEntitlementReconcile } from '../_shared/reconcileEntitlement.ts';
import { StripeAdapter } from '../_shared/payments/stripeAdapter.ts';
import { stripeEnv, ENTITLING_STATUSES, isPriceCacheFresh } from '../_shared/payments/catalog.ts';

interface SubPriceRow {
  provider_subscription_id: string | null;
  amount: number | null;
  currency: string | null;
  billing_interval: string | null;
  price_synced_at: string | null;
}

// Плоское представление цены из кэшированной строки подписки.
function cachedPrice(sub: SubPriceRow) {
  return sub.amount == null ? null : {
    amount: Number(sub.amount),                        // minor units (cents)
    currency: (sub.currency || 'usd').toUpperCase(),
    interval: sub.billing_interval,                    // 'month' | 'year' | null
  };
}

// Возвращает ТОЧНУЮ цену, которую платит юзер (легаси/промо/скидка) — из строки
// подписки. Lazy-TTL кэш: свежая метка price_synced_at → отдаём из БД без Stripe;
// протухла/пуста → один живой fetch подписки + write-back кэша. Best-effort: любая
// ошибка Stripe откатывается на кэш (пусть слегка устаревший) либо null → UI на каталог.
async function readActualPrice(sub: SubPriceRow | null) {
  if (!sub) return null;
  if (isPriceCacheFresh(sub.price_synced_at) && sub.amount != null) return cachedPrice(sub);

  const subId = sub.provider_subscription_id;
  const key = Deno.env.get('STRIPE_SECRET_KEY');
  if (!subId || !key) return cachedPrice(sub);
  try {
    const adapter = new StripeAdapter(key, stripeEnv(key));
    const live = await adapter.fetchSubscription(subId, { expand: ['items.data.price'] });
    const price = live.items?.data?.[0]?.price as Stripe.Price | undefined;
    if (!price || price.unit_amount == null) return cachedPrice(sub);
    const interval = price.recurring?.interval ?? null;
    const currency = (price.currency || 'usd').toUpperCase();
    const { error } = await supabaseAdmin.from('subscription').update({
      amount: price.unit_amount,
      currency,
      ...(interval === 'month' || interval === 'year' ? { billing_interval: interval } : {}),
      price_synced_at: new Date().toISOString(),
    }).eq('provider_subscription_id', subId);
    if (error) console.error('getUserPlan: price cache write-back failed', error.message);
    return {
      amount: price.unit_amount,
      currency,
      interval,
    };
  } catch (e) {
    console.error('getUserPlan: failed to read Stripe price', e);
    return cachedPrice(sub);
  }
}

Deno.serve(withHandler('getUserPlan', async (req, corsHeaders) => {
    const user = await getRequestUser(req);
    if (!user) return Response.json({ error: 'Unauthorized' }, { status: 401, headers: corsHeaders });

    // Read subscription fields from users table
    let { data: userData } = await supabaseAdmin
      .from('users')
      .select('subscription_status, subscription_end_date, email')
      .eq('id', user.id)
      .single();

    // recompute-on-read (Ф3): self-heal a wrong cache via a throttled reconcile
    // (stuck-PRO / stuck-FREE). Cheap in the common case: never fires for a
    // never-paid free user (no customer id) or a healthy pro row (future end).
    // Throttled to ≤1 Stripe call / 10 min. Предикат — единый (O1).
    const needsReconcile = await needsEntitlementReconcile(
      supabaseAdmin, user.id, userData?.subscription_status, userData?.subscription_end_date);
    if (needsReconcile && await reconcileEntitlement(supabaseAdmin, user.id)) {
      ({ data: userData } = await supabaseAdmin
        .from('users')
        .select('subscription_status, subscription_end_date, email')
        .eq('id', user.id)
        .single());
    }

    // Pro verdict from the single SQL source (is_user_pro, migration 0055). The raw
    // columns above are still read for the reconcile trigger + the response
    // (subscriptionEnd / email); this is one extra indexed read, negligible next to
    // the Stripe call in readActualPrice.
    const { data: isProRpc, error: isProErr } = await supabaseAdmin.rpc('is_user_pro', { p_uid: user.id });
    // A failed verdict must NOT silently downgrade a paying user to Free.
    // Fail LOUD → 5xx; the client keeps its cached plan and retries. TRIP-208.
    if (isProErr) throw isProErr;
    const hasProSubscription = isProRpc === true;

    if (hasProSubscription) {
      // Активная подписка из реестра — отдаёт тип плана и состояние отмены.
      const { data: subs } = await supabaseAdmin
        .from('subscription')
        .select('product_code, provider_subscription_id, cancel_at_period_end, status, created_at, amount, currency, billing_interval, price_synced_at')
        .eq('user_id', user.id)
        .in('product_code', ['account_pro_monthly', 'account_pro_yearly'])
        .in('status', [...ENTITLING_STATUSES])
        .order('created_at', { ascending: false });

      const latest = (subs ?? [])[0] || null;
      // Единый вокабуляр: фронт получает product_code напрямую (без plan_type-моста).
      const productCode = latest ? (latest.product_code as string) : null;

      const actualPrice = await readActualPrice(latest);

      return Response.json({
        plan: 'pro',
        subscriptionEnd: userData?.subscription_end_date ?? null,
        productCode,
        // Scheduled cancellation (UI "won't renew"). Status stays verbatim; flag in cancel_at_period_end.
        cancelled: latest?.cancel_at_period_end === true,
        stripeSubscriptionId: latest?.provider_subscription_id || null,
        actualPrice,
        email: user.email,
      }, { headers: corsHeaders });
    }

    return Response.json({ plan: 'free', email: user.email }, { headers: corsHeaders });

}));
