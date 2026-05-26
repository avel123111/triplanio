import { createClientFromRequest } from 'npm:@base44/sdk@0.8.25';
import Stripe from 'npm:stripe@17.0.0';

/**
 * Creates a Stripe Billing Portal session for the current user so they can
 * manage their Pro subscription (update card, cancel, view invoices).
 */
Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me();

    if (!user) {
      return Response.json({ error: 'Unauthorized' }, { status: 401 });
    }

    // ---------- Origin validation + Stripe env routing ----------
    const TEST_ORIGIN = 'https://share--ninja-wander-plan-go.base44.app';
    const prodAppUrl = (Deno.env.get('PUBLIC_APP_URL') || '').replace(/\/+$/, '');
    if (!prodAppUrl) {
      console.error('PUBLIC_APP_URL not configured');
      return Response.json({ error: 'Server misconfigured: PUBLIC_APP_URL missing' }, { status: 500 });
    }
    const reqOrigin = (req.headers.get('origin') || '').replace(/\/+$/, '');
    const isTestEnv = reqOrigin === TEST_ORIGIN;
    const publicAppUrl = isTestEnv ? TEST_ORIGIN : prodAppUrl;
    if (reqOrigin && reqOrigin !== prodAppUrl && reqOrigin !== TEST_ORIGIN) {
      console.error('Origin mismatch:', reqOrigin, 'vs', prodAppUrl, 'or', TEST_ORIGIN);
      return Response.json({ error: 'Origin not allowed' }, { status: 400 });
    }
    console.log('Billing portal env:', isTestEnv ? 'TEST' : 'LIVE');

    const { returnPath } = await req.json().catch(() => ({}));
    const safeReturn = (returnPath && returnPath.startsWith('/')) ? returnPath : '/settings';
    const returnUrl = `${publicAppUrl}${safeReturn}`;

    const sr = base44.asServiceRole;
    const subs = await sr.entities.TripSubscription.filter({ user_email: user.email });
    const recurring = subs
      .filter(s => (s.type === 'pro_monthly' || s.type === 'pro_yearly') && s.stripe_subscription_id)
      .sort((a, b) => new Date(b.start_date || 0) - new Date(a.start_date || 0));

    const latest = recurring[0];
    if (!latest?.stripe_subscription_id) {
      return Response.json({ error: 'No active subscription found' }, { status: 404 });
    }

    const stripeKey = isTestEnv
      ? Deno.env.get('STRIPE_TEST_SECRET_KEY')
      : Deno.env.get('STRIPE_SECRET_KEY');
    if (!stripeKey) {
      console.error('Stripe secret key missing for env:', isTestEnv ? 'TEST' : 'LIVE');
      return Response.json({ error: 'Server misconfigured: Stripe key missing' }, { status: 500 });
    }
    const stripe = new Stripe(stripeKey);
    const subscription = await stripe.subscriptions.retrieve(latest.stripe_subscription_id);
    const customerId = subscription.customer;

    if (!customerId) {
      return Response.json({ error: 'No Stripe customer linked to this subscription' }, { status: 404 });
    }

    const portalSession = await stripe.billingPortal.sessions.create({
      customer: customerId,
      return_url: returnUrl,
    });

    return Response.json({ url: portalSession.url });
  } catch (error) {
    console.error('Billing portal error:', error);
    return Response.json({ error: error.message }, { status: 500 });
  }
});