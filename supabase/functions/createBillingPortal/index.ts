/**
 * createBillingPortal
 *
 * POST body: { returnPath? }
 *
 * Creates a Stripe Billing Portal session for the current user so they can
 * manage their Pro subscription (update card, cancel, view invoices).
 */

import { corsFor } from '../_shared/cors.ts';
import { supabaseAdmin, getRequestUser } from '../_shared/supabaseAdmin.ts';
import Stripe from 'npm:stripe@17.0.0';
import { captureEdgeError } from '../_shared/sentry.ts';

Deno.serve(async (req) => {
  const corsHeaders = corsFor(req);
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

    const stripeKey = Deno.env.get('STRIPE_SECRET_KEY');
    if (!stripeKey) {
      console.error('STRIPE_SECRET_KEY missing');
      return Response.json({ error: 'Server misconfigured: Stripe key missing' }, { status: 500, headers: corsHeaders });
    }
    const stripe = new Stripe(stripeKey);

    // Fast path (Ф3): use the stored customer id (populated lazily by the webhook).
    // Avoids a Stripe round-trip through the subscription object.
    let customerId: string | null = null;
    const { data: urow } = await supabaseAdmin
      .from('users').select('stripe_customer_id').eq('id', user.id).single();
    customerId = (urow?.stripe_customer_id as string) || null;

    // Fallback: resolve the customer через последнюю recurring подписку реестра.
    if (!customerId) {
      const { data: subs } = await supabaseAdmin
        .from('subscription')
        .select('provider_subscription_id, created_at')
        .eq('user_id', user.id)
        .in('product_code', ['account_pro_monthly', 'account_pro_yearly'])
        .not('provider_subscription_id', 'is', null)
        .order('created_at', { ascending: false })
        .limit(5);
      const latest = (subs ?? []).find((s) => s.provider_subscription_id);
      if (!latest?.provider_subscription_id) {
        return Response.json({ error: 'No active subscription found' }, { status: 404, headers: corsHeaders });
      }
      const subscription = await stripe.subscriptions.retrieve(latest.provider_subscription_id);
      customerId = (subscription.customer as string) || null;
    }

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
