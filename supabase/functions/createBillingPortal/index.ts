/**
 * createBillingPortal
 *
 * POST body: { returnPath? }
 *
 * Creates a Stripe Billing Portal session for the current user so they can
 * manage their Pro subscription (update card, cancel, view invoices).
 *
 * Migrated from base44: replaced base44 SDK entity calls with Supabase queries.
 */

import { corsHeaders } from '../_shared/cors.ts';
import { supabaseAdmin, getRequestUser } from '../_shared/supabaseAdmin.ts';
import Stripe from 'npm:stripe@17.0.0';

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });

  try {
    const user = await getRequestUser(req);
    if (!user) return Response.json({ error: 'Unauthorized' }, { status: 401, headers: corsHeaders });

    // ---------- Origin validation + Stripe env routing ----------
    const prodAppUrl = (Deno.env.get('PUBLIC_APP_URL') || '').replace(/\/+$/, '');
    if (!prodAppUrl) {
      console.error('PUBLIC_APP_URL not configured');
      return Response.json({ error: 'Server misconfigured: PUBLIC_APP_URL missing' }, { status: 500, headers: corsHeaders });
    }
    const testOrigin = (Deno.env.get('STRIPE_TEST_ORIGIN') || '').replace(/\/+$/, '');
    const reqOrigin = (req.headers.get('origin') || '').replace(/\/+$/, '');
    const isTestEnv = !!(testOrigin && reqOrigin === testOrigin);
    const publicAppUrl = isTestEnv ? testOrigin : prodAppUrl;

    if (reqOrigin && reqOrigin !== prodAppUrl && (!testOrigin || reqOrigin !== testOrigin)) {
      console.error('Origin mismatch:', reqOrigin, 'vs', prodAppUrl);
      return Response.json({ error: 'Origin not allowed' }, { status: 400, headers: corsHeaders });
    }
    console.log('Billing portal env:', isTestEnv ? 'TEST' : 'LIVE');

    const { returnPath } = await req.json().catch(() => ({}));
    const safeReturn = (returnPath && returnPath.startsWith('/')) ? returnPath : '/settings';
    const returnUrl = `${publicAppUrl}${safeReturn}`;

    // Find the most recent active recurring subscription with a Stripe ID
    const { data: subs } = await supabaseAdmin
      .from('trip_subscriptions')
      .select('stripe_subscription_id, start_date')
      .eq('user_email', user.email!)
      .in('type', ['pro_monthly', 'pro_yearly'])
      .not('stripe_subscription_id', 'is', null)
      .order('start_date', { ascending: false })
      .limit(5);

    const latest = (subs ?? []).find((s) => s.stripe_subscription_id);
    if (!latest?.stripe_subscription_id) {
      return Response.json({ error: 'No active subscription found' }, { status: 404, headers: corsHeaders });
    }

    const stripeKey = isTestEnv
      ? Deno.env.get('STRIPE_TEST_SECRET_KEY')
      : Deno.env.get('STRIPE_SECRET_KEY');
    if (!stripeKey) {
      console.error('Stripe secret key missing for env:', isTestEnv ? 'TEST' : 'LIVE');
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
    console.error('Billing portal error:', error);
    return Response.json(
      { error: error instanceof Error ? error.message : 'Internal error' },
      { status: 500, headers: corsHeaders },
    );
  }
});
