/**
 * getUserPlan
 *
 * GET/POST — no body required.
 *
 * Returns the caller's subscription plan and metadata.
 * Migrated from base44: replaces base44.auth.me() + TripSubscription entity
 * with direct Supabase queries.
 */

import { corsHeaders } from '../_shared/cors.ts';
import { supabaseAdmin, getRequestUser } from '../_shared/supabaseAdmin.ts';

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });

  try {
    const user = await getRequestUser(req);
    if (!user) return Response.json({ error: 'Unauthorized' }, { status: 401, headers: corsHeaders });

    // Read subscription fields from users table
    const { data: userData } = await supabaseAdmin
      .from('users')
      .select('subscription_status, subscription_end_date, email')
      .eq('id', user.id)
      .single();

    const now = new Date();
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

      return Response.json({
        plan: 'pro',
        subscriptionEnd: userData.subscription_end_date,
        subscriptionType: latest?.type || null,
        cancelled: latest?.status === 'cancelled',
        stripeSubscriptionId: latest?.stripe_subscription_id || null,
        email: user.email,
      }, { headers: corsHeaders });
    }

    return Response.json({ plan: 'free', email: user.email }, { headers: corsHeaders });

  } catch (error) {
    console.error('getUserPlan error:', error);
    return Response.json(
      { error: error instanceof Error ? error.message : 'Internal error' },
      { status: 500, headers: corsHeaders },
    );
  }
});
