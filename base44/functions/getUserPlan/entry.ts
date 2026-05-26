import { createClientFromRequest } from 'npm:@base44/sdk@0.8.25';

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me();

    if (!user) {
      return Response.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const now = new Date();
    const hasProSubscription = user.subscription_status === 'pro' &&
      user.subscription_end_date &&
      new Date(user.subscription_end_date) > now;

    if (hasProSubscription) {
      // Find active TripSubscription record (latest) to surface plan type & cancellation state.
      const subs = await base44.asServiceRole.entities.TripSubscription.filter({
        user_email: user.email,
      });
      const recurring = subs
        .filter(s => s.type === 'pro_monthly' || s.type === 'pro_yearly')
        .sort((a, b) => new Date(b.start_date || 0) - new Date(a.start_date || 0));
      const latest = recurring[0] || null;

      return Response.json({
        plan: 'pro',
        subscriptionEnd: user.subscription_end_date,
        subscriptionType: latest?.type || null,
        cancelled: latest?.status === 'cancelled',
        stripeSubscriptionId: latest?.stripe_subscription_id || null,
        email: user.email,
      });
    }

    return Response.json({
      plan: 'free',
      email: user.email,
    });
  } catch (error) {
    console.error('Get user plan error:', error);
    return Response.json({ error: error.message }, { status: 500 });
  }
});