/**
 * changeSubscriptionPlan
 *
 * Switches the CALLER's active recurring subscription to another plan
 * (e.g. monthly → yearly) via Stripe with proration. The webhook
 * (customer.subscription.updated) syncs subscription_end_date afterwards;
 * we also update trip_subscriptions.type here so the UI reflects it immediately.
 *
 * POST body: { targetPlan: 'pro_monthly' | 'pro_yearly' }
 * Returns 200 { ok:true } | { ok:false, code:'NO_SUBSCRIPTION' }.
 *
 * Stripe mode (test/live) auto-detected from STRIPE_SECRET_KEY (one per project).
 */
import { corsHeaders } from '../_shared/cors.ts';
import { supabaseAdmin, getRequestUser } from '../_shared/supabaseAdmin.ts';
import Stripe from 'npm:stripe@17.0.0';
import { captureEdgeError } from '../_shared/sentry.ts';

const VALID = ['pro_monthly', 'pro_yearly'];
const LIVE_PRODUCTS: Record<string, string> = {
  pro_monthly: 'prod_UYfZf8WvFNE3cI',
  pro_yearly: 'prod_UYfZBYzOWrKiLu',
};
const TEST_PRODUCTS: Record<string, string> = {
  pro_monthly: 'prod_UZnBPOlJL0xmue',
  pro_yearly: 'prod_UZnBUDGL1PuyEN',
};

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });

  try {
    const user = await getRequestUser(req);
    if (!user) return Response.json({ error: 'Unauthorized' }, { status: 401, headers: corsHeaders });

    const { targetPlan } = await req.json();
    if (!VALID.includes(targetPlan)) {
      return Response.json({ error: 'Invalid targetPlan' }, { status: 400, headers: corsHeaders });
    }

    const stripeKey = Deno.env.get('STRIPE_SECRET_KEY');
    if (!stripeKey) return Response.json({ error: 'Server misconfigured: Stripe key missing' }, { status: 500, headers: corsHeaders });
    const isTestEnv = stripeKey.includes('_test_');

    // Caller's latest active recurring subscription with a Stripe id.
    const { data: subs } = await supabaseAdmin
      .from('trip_subscriptions')
      .select('id, type, stripe_subscription_id, start_date')
      .eq('user_id', user.id)
      .in('type', ['pro_monthly', 'pro_yearly'])
      .eq('status', 'active')
      .not('stripe_subscription_id', 'is', null)
      .order('start_date', { ascending: false })
      .limit(5);

    const row = (subs ?? []).find((s) => s.stripe_subscription_id);
    if (!row?.stripe_subscription_id) {
      return Response.json({ ok: false, code: 'NO_SUBSCRIPTION' }, { headers: corsHeaders });
    }
    if (row.type === targetPlan) {
      return Response.json({ ok: true, already: true }, { headers: corsHeaders });
    }

    const stripe = new Stripe(stripeKey);

    // Resolve the target price via product.default_price (fallback: first active).
    const productId = (isTestEnv ? TEST_PRODUCTS : LIVE_PRODUCTS)[targetPlan];
    const product = await stripe.products.retrieve(productId, { expand: ['default_price'] });
    let price = product.default_price;
    if (!price || typeof price === 'string') {
      const list = await stripe.prices.list({ product: productId, active: true, limit: 1 });
      price = list.data[0];
    }
    if (!price) return Response.json({ error: `No active price for ${targetPlan}` }, { status: 500, headers: corsHeaders });

    const subscription = await stripe.subscriptions.retrieve(row.stripe_subscription_id);
    const itemId = subscription.items?.data?.[0]?.id;
    if (!itemId) return Response.json({ error: 'Subscription item not found' }, { status: 500, headers: corsHeaders });

    await stripe.subscriptions.update(row.stripe_subscription_id, {
      items: [{ id: itemId, price: (price as Stripe.Price).id }],
      proration_behavior: 'create_prorations',
      cancel_at_period_end: false,
    });

    // Reflect the new plan immediately; webhook will sync end_date.
    await supabaseAdmin.from('trip_subscriptions').update({ type: targetPlan }).eq('id', row.id);

    return Response.json({ ok: true }, { headers: corsHeaders });
  } catch (e) {
    await captureEdgeError(e, 'changeSubscriptionPlan');
    console.error('changeSubscriptionPlan error:', e);
    return Response.json({ error: e instanceof Error ? e.message : 'Internal error' }, { status: 500, headers: corsHeaders });
  }
});
