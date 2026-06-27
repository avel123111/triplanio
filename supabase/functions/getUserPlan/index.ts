/**
 * getUserPlan
 *
 * GET/POST — no body required.
 *
 * Returns the caller's subscription plan and metadata.
 */

import { corsFor } from '../_shared/cors.ts';
import { supabaseAdmin, getRequestUser } from '../_shared/supabaseAdmin.ts';
import Stripe from 'npm:stripe@17.0.0';
import { captureEdgeError } from '../_shared/sentry.ts';
import { reconcileEntitlement } from '../_shared/reconcileEntitlement.ts';

// Reads the EXACT amount the caller is billed from their live Stripe subscription
// (the price line item), not the public catalog price — so a user on a legacy /
// promo / discounted price sees what they actually pay. Best-effort: any Stripe
// error just leaves the price fields null and the UI falls back to the catalog.
async function readActualPrice(stripeSubscriptionId: string | null) {
  if (!stripeSubscriptionId) return null;
  const key = Deno.env.get('STRIPE_SECRET_KEY');
  if (!key) return null;
  try {
    const stripe = new Stripe(key);
    const sub = await stripe.subscriptions.retrieve(stripeSubscriptionId, { expand: ['items.data.price'] });
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
      .select('subscription_status, subscription_end_date, email, stripe_customer_id')
      .eq('id', user.id)
      .single();

    const now = new Date();

    // recompute-on-read (Ф3): self-heal a wrong cache via a throttled reconcile.
    //  • stuck-PRO  — cache says pro but the end date is past/missing (lost renewal).
    //  • stuck-FREE — cache says free but the user has a Stripe customer id (a lost
    //    ACTIVATION webhook); reconcile discovers the live sub and restores Pro.
    // Cheap in the common case: never fires for a never-paid free user (no customer
    // id) or a healthy pro row (future end). Throttled to ≤1 Stripe call / 10 min.
    const endPast =
      !userData?.subscription_end_date || new Date(userData.subscription_end_date) <= now;
    const needsReconcile =
      (userData?.subscription_status === 'pro' && endPast) ||
      (userData?.subscription_status !== 'pro' && !!userData?.stripe_customer_id);
    if (needsReconcile && await reconcileEntitlement(supabaseAdmin, user.id)) {
      ({ data: userData } = await supabaseAdmin
        .from('users')
        .select('subscription_status, subscription_end_date, email, stripe_customer_id')
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
      // Find active TripSubscription record — surfaces plan type & cancellation state
      const { data: subs } = await supabaseAdmin
        .from('trip_subscriptions')
        .select('*')
        .eq('user_id', user.id);

      const recurring = (subs ?? [])
        .filter((s) => s.type === 'pro_monthly' || s.type === 'pro_yearly')
        .sort((a, b) =>
          new Date(b.start_date || 0).getTime() - new Date(a.start_date || 0).getTime()
        );
      const latest = recurring[0] || null;

      const actualPrice = await readActualPrice(latest?.stripe_subscription_id || null);

      return Response.json({
        plan: 'pro',
        subscriptionEnd: userData?.subscription_end_date ?? null,
        subscriptionType: latest?.type || null,
        // Scheduled cancellation (UI "won't renew" state). Status stays 'active'
        // verbatim; the flag lives in cancel_at_period_end (set by the webhook).
        cancelled: latest?.cancel_at_period_end === true,
        stripeSubscriptionId: latest?.stripe_subscription_id || null,
        // Exact billed amount from Stripe (minor units), e.g. { amount: 500, currency: 'EUR', interval: 'month' }.
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
