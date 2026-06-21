/**
 * createStripeCheckout
 *
 * POST body: { tripId?, planType: 'pro_trip'|'pro_monthly'|'pro_yearly', returnPath?, locale? }
 *
 * Security:
 * - pro_trip: validates trip ownership (created_by === caller email)
 * - pro_monthly/pro_yearly: blocks duplicate active subscription
 * - Race-condition guard: rejects if a recent Stripe session is in flight
 * - Origin validation: only PUBLIC_APP_URL allowed
 *
 * Stripe mode (test/live) is auto-detected from STRIPE_SECRET_KEY — one mode
 * per Supabase project (live in prod, test in dev).
 */

import { corsHeaders } from '../_shared/cors.ts';
import { supabaseAdmin, getRequestUser } from '../_shared/supabaseAdmin.ts';
import Stripe from 'npm:stripe@17.0.0';
import { captureEdgeError } from '../_shared/sentry.ts';
import { VALID_PLANS, type PlanType, isTestStripeKey, productsForEnv } from '../_shared/stripeCatalog.ts';

const SUPPORTED_LOCALES = new Set([
  'auto','bg','cs','da','de','el','en','en-GB','es','es-419','et','fi','fil',
  'fr','fr-CA','hr','hu','id','it','ja','ko','lt','lv','ms','mt','nb','nl',
  'pl','pt','pt-BR','ro','ru','sk','sl','sv','th','tr','vi','zh','zh-HK','zh-TW',
]);

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });

  try {
    const user = await getRequestUser(req);
    if (!user) return Response.json({ error: 'Unauthorized' }, { status: 401, headers: corsHeaders });

    const { tripId, planType, returnPath, locale } = await req.json();

    if (!VALID_PLANS.includes(planType)) {
      return Response.json({ error: 'Invalid plan type' }, { status: 400, headers: corsHeaders });
    }

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

    // ---------- Stripe mode auto-detected from the secret key ----------
    // One mode per project: sk_test_… → test products, sk_live_… → live products.
    const stripeKey = Deno.env.get('STRIPE_SECRET_KEY');
    if (!stripeKey) {
      console.error('STRIPE_SECRET_KEY missing');
      return Response.json({ error: 'Server misconfigured: Stripe key missing' }, { status: 500, headers: corsHeaders });
    }
    const isTestEnv = isTestStripeKey(stripeKey);
    console.log('Stripe checkout mode:', isTestEnv ? 'TEST' : 'LIVE', 'origin:', reqOrigin);

    // ---------- Per-trip Pro: validate trip ownership ----------
    if (planType === 'pro_trip') {
      if (!tripId) {
        return Response.json({ error: 'tripId required for pro_trip' }, { status: 400, headers: corsHeaders });
      }
      const { data: trip } = await supabaseAdmin
        .from('trips')
        .select('id, created_by, is_pro_trip')
        .eq('id', tripId)
        .single();
      if (!trip) {
        return Response.json({ error: 'Trip not found' }, { status: 404, headers: corsHeaders });
      }
      if (trip.created_by !== user.id) {
        return Response.json({ error: 'Only the trip owner can buy Pro for this trip' }, { status: 403, headers: corsHeaders });
      }
      if (trip.is_pro_trip) {
        return Response.json({ error: 'This trip is already Pro', code: 'TRIP_ALREADY_PRO' }, { status: 409, headers: corsHeaders });
      }
    }

    // ---------- Recurring: block duplicate active subscription ----------
    if (planType === 'pro_monthly' || planType === 'pro_yearly') {
      const { data: subs } = await supabaseAdmin
        .from('trip_subscriptions')
        .select('type, status, end_date')
        .eq('user_id', user.id);

      const now = Date.now();
      const hasActiveRecurring = (subs ?? []).some((s) =>
        (s.type === 'pro_monthly' || s.type === 'pro_yearly') &&
        s.status === 'active' &&
        s.end_date && new Date(s.end_date).getTime() > now
      );
      if (hasActiveRecurring) {
        return Response.json({
          error: 'You already have an active subscription. Use the billing portal to change plans.',
          code: 'SUBSCRIPTION_ALREADY_ACTIVE',
        }, { status: 409, headers: corsHeaders });
      }
    }

    const stripe = new Stripe(stripeKey);

    // ---------- Race-condition guard: recent checkout in flight ----------
    if (planType === 'pro_monthly' || planType === 'pro_yearly') {
      try {
        const fifteenMinAgo = Math.floor(Date.now() / 1000) - 15 * 60;
        const recent = await stripe.checkout.sessions.list({
          limit: 10,
          created: { gte: fifteenMinAgo },
          customer_details: { email: user.email! },
        }).catch(() => null);
        const sessions = recent?.data || [];
        const inFlight = sessions.find((s) =>
          s.mode === 'subscription' &&
          s.customer_email === user.email &&
          (s.status === 'complete' || s.status === 'open')
        );
        if (inFlight) {
          console.log('Recent checkout in flight for', user.email, '->', inFlight.id, inFlight.status);
          return Response.json({
            error: 'A recent payment is still being processed. Please wait a moment and refresh.',
            code: 'RECENT_CHECKOUT_PENDING',
          }, { status: 409, headers: corsHeaders });
        }
      } catch (e) {
        console.error('Recent-checkout lookup failed (non-fatal):', (e as Error).message);
      }
    }

    // Resolve active price via product.default_price
    const productId = productsForEnv(isTestEnv)[planType as PlanType];
    const product = await stripe.products.retrieve(productId, { expand: ['default_price'] });
    let price = product.default_price;
    if (!price || typeof price === 'string') {
      const list = await stripe.prices.list({ product: productId, active: true, limit: 1 });
      price = list.data[0];
    }
    if (!price) {
      return Response.json({ error: `No active price for ${planType}` }, { status: 500, headers: corsHeaders });
    }

    const mode = planType === 'pro_trip' ? 'payment' : 'subscription';
    const safeReturn = (returnPath && returnPath.startsWith('/')) ? returnPath : '/';
    const sep = safeReturn.includes('?') ? '&' : '?';
    const stripeLocale = SUPPORTED_LOCALES.has(locale) ? locale : 'auto';

    const session = await stripe.checkout.sessions.create({
      payment_method_types: ['card'],
      line_items: [{ price: (price as Stripe.Price).id, quantity: 1 }],
      mode,
      locale: stripeLocale,
      success_url: `${publicAppUrl}${safeReturn}${sep}stripe_status=success&session_id={CHECKOUT_SESSION_ID}`,
      cancel_url: `${publicAppUrl}${safeReturn}${sep}stripe_status=cancel`,
      client_reference_id: user.id,
      customer_email: user.email!,
      metadata: {
        user_id: user.id,
        user_email: user.email!,
        trip_id: tripId || '',
        plan_type: planType,
        return_path: safeReturn,
      },
      // Carry identity onto the SUBSCRIPTION too, so invoice.* webhooks (renewal /
      // dunning) can reconstruct the ledger row even if checkout.session.completed
      // was lost. (session.metadata alone is not visible on invoice events.)
      ...(mode === 'subscription'
        ? { subscription_data: { metadata: { user_id: user.id, plan_type: planType } } }
        : {}),
    });

    return Response.json({ url: session.url }, { headers: corsHeaders });

  } catch (error) {
    await captureEdgeError(error, 'createStripeCheckout');
    console.error('Stripe checkout error:', error);
    return Response.json(
      { error: error instanceof Error ? error.message : 'Internal error' },
      { status: 500, headers: corsHeaders },
    );
  }
});
