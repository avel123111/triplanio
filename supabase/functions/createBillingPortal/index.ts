/**
 * createBillingPortal
 *
 * POST body: { returnPath? }
 *
 * Creates a Stripe Billing Portal session for the current user so they can
 * manage their Pro subscription (update card, cancel, view invoices).
 */

import { corsHeaders } from '../_shared/cors.ts';
import { supabaseAdmin, getRequestUser } from '../_shared/supabaseAdmin.ts';
import Stripe from 'npm:stripe@17.0.0';
import { captureEdgeError } from '../_shared/sentry.ts';

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });

  try {
    const user = await getRequestUser(req);
    if (!user) return Response.json({ error: 'Unauthorized' }, { status: 401, headers: corsHeaders });

    // ---------- Origin validation ----------
    const publicAppUrl = (Deno.env.get('PUBLIC_APP_URL') || '').replace(/\/+$/, '');
    if (!publicAppUrl) {
      console.error('PUBLIC_APP_URL not configured');
      return Response.json({ error: 'Server misconfigured: PUBLIC_APP_URL missing' }, { status: 500, headers: corsHeaders });
    }
    const reqOrigin = (req.headers.get('origin') || '').replace(/\/+$/, '');
    if (reqOrigin && reqOrigin !== publicAppUrl) {
      console.error('Origin mismatch:', reqOrigin, 'vs', publicAppUrl);
      return Response.json({ error: 'Origin not allowed' }, { status: 400, headers: corsHeaders });
    }

    const { returnPath } = await req.json().catch(() => ({}));
    const safeReturn = (returnPath && returnPath.startsWith('/')) ? returnPath : '/settings';
    const returnUrl = `${publicAppUrl}${safeReturn}`;

    // Find the most recent active recurring subscription with a Stripe ID
    const { data: subs } = await supabaseAdmin
      .from('trip_subscriptions')
      .select('stripe_subscription_id, start_date')
      .eq('user_id', user.id)
      .in('type', ['pro_monthly', 'pro_yearly'])
      .not('stripe_subscription_id', 'is', null)
      .order('start_date', { ascending: false })
      .limit(5);

    const latest = (subs ?? []).find((s) => s.stripe_subscription_id);
    if (!latest?.stripe_subscription_id) {
      return Response.json({ error: 'No active subscription found' }, { status: 404, headers: corsHeaders });
    }

    const stripeKey = Deno.env.get('STRIPE_SECRET_KEY');
    if (!stripeKey) {
      console.error('STRIPE_SECRET_KEY missing');
      return Response.json({ error: 'Server misconfigured: Stripe key missing' }, { status: 500, headers: corsHeaders });
    }
    const stripe = new Stripe(stripeKey);

    const subscription = await stripe.subscriptions.retrieve(latest.stripe_subscription_id);
    const customerId = subscription.customer as string;
    if (!customerId) {
      return Response.json({ error: 'No Stripe customer linked to this subscription' }, { status: 404, headers: corsHeaders });
    }

    const portalSession = await stripe.billingPortal.sessions.create({
      customer: customerId,
      return_url: returnUrl,
    });

    return Response.json({ url: portalSession.url }, { headers: corsHeaders });

  } catch (error) {
    await captureEdgeError(error, 'createBillingPortal');
    console.error('Billing portal error:', error);
    return Response.json(
      { error: error instanceof Error ? error.message : 'Internal error' },
      { status: 500, headers: corsHeaders },
    );
  }
});
