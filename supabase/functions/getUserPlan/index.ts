/**
 * getUserPlan
 *
 * GET/POST — no body required.
 *
 * Returns the caller's subscription plan and metadata.
 */

import { corsHeaders } from '../_shared/cors.ts';
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

    const now = new Date();

    // recompute-on-read (Ф3): cache says pro but the date looks stale (a lost
    // webhook?) → one throttled reconcile from Stripe, then re-read. Cheap in the
    // common case (only fires for an expired/missing end on a 'pro' row).
    const looksStale =
      userData?.subscription_status === 'pro' &&
      (!userData?.subscription_end_date || new Date(userData.subscription_end_date) <= now);
    if (looksStale && await reconcileEntitlement(supabaseAdmin, user.id)) {
      ({ data: userData } = await supabaseAdmin
        .from('users')
        .select('subscription_status, subscription_end_date, email')
        .eq('id', user.id)
        .single());
    }

    const hasProSubscription =
      userData?.subscription_status === 'pro' &&
      userData?.subscription_end_date &&
      new Date(userData.subscription_end_date) > now;

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
        subscriptionEnd: userData.subscription_end_date,
        subscriptionType: latest?.type || null,
        cancelled: latest?.status === 'cancelled',
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
