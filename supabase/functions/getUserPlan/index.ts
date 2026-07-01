/**
 * getUserPlan
 *
 * GET/POST — no body required.
 *
 * Returns the caller's subscription plan and metadata.
 */

import { corsFor } from '../_shared/cors.ts';
import { supabaseAdmin, getRequestUser } from '../_shared/supabaseAdmin.ts';
import type Stripe from 'npm:stripe@17.0.0';
import { captureEdgeError } from '../_shared/sentry.ts';
import { reconcileEntitlement, needsEntitlementReconcile } from '../_shared/reconcileEntitlement.ts';
import { StripeAdapter } from '../_shared/payments/stripeAdapter.ts';
import { stripeEnv, ENTITLING_STATUSES } from '../_shared/payments/catalog.ts';

// Reads the EXACT amount the caller is billed from their live Stripe subscription
// (the price line item), not the public catalog price — so a user on a legacy /
// promo / discounted price sees what they actually pay. Best-effort: any Stripe
// error just leaves the price fields null and the UI falls back to the catalog.
async function readActualPrice(stripeSubscriptionId: string | null) {
  if (!stripeSubscriptionId) return null;
  const key = Deno.env.get('STRIPE_SECRET_KEY');
  if (!key) return null;
  try {
    const adapter = new StripeAdapter(key, stripeEnv(key));
    const sub = await adapter.fetchSubscription(stripeSubscriptionId, { expand: ['items.data.price'] });
    const price = sub.items?.data?.[0]?.price as Stripe.Price | undefined;
    if (!price || price.unit_amount == null) return null;
    return {
      amount: price.unit_amount,                 // minor units (cents)
      currency: (price.currency || 'usd').toUpperCase(),
      interval: price.recurring?.interval || null, // 'month' | 'year'
    };
  } catch (e) {
    console.error('getUserPlan: failed to read Stripe price', e);
    return null;
  }
}

Deno.serve(async (req) => {
  const corsHeaders = corsFor(req);
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });

  try {
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
    const { data: isProRpc } = await supabaseAdmin.rpc('is_user_pro', { p_uid: user.id });
    const hasProSubscription = isProRpc === true;

    if (hasProSubscription) {
      // Активная подписка из реестра — отдаёт тип плана и состояние отмены.
      const { data: subs } = await supabaseAdmin
        .from('subscription')
        .select('product_code, provider_subscription_id, cancel_at_period_end, status, created_at')
        .eq('user_id', user.id)
        .in('product_code', ['account_pro_monthly', 'account_pro_yearly'])
        .in('status', [...ENTITLING_STATUSES])
        .order('created_at', { ascending: false });

      const latest = (subs ?? [])[0] || null;
      // Единый вокабуляр: фронт получает product_code напрямую (без plan_type-моста).
      const productCode = latest ? (latest.product_code as string) : null;

      const actualPrice = await readActualPrice(latest?.provider_subscription_id || null);

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

  } catch (error) {
    await captureEdgeError(error, 'getUserPlan');
    console.error('getUserPlan error:', error);
    return Response.json(
      { error: error instanceof Error ? error.message : 'Internal error' },
      { status: 500, headers: corsHeaders },
    );
  }
});
