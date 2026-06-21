/**
 * createStripeCheckout
 *
 * POST body: { tripId?, planType: 'pro_trip'|'pro_monthly'|'pro_yearly', returnPath?, locale? }
 *
 * Security:
 * - pro_trip: validates trip ownership (created_by === caller email)
 * - pro_monthly/pro_yearly: blocks duplicate active subscription (status-driven)
 * - Checkout retry (TRIP-82): expire abandoned OPEN sessions instead of a 15-min
 *   block; a freshly COMPLETE session returns CHECKOUT_PROCESSING (no 2nd sub)
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
        .select('type, status')
        .eq('user_id', user.id);

      // Status-driven (matches recompute_user_entitlement): active/trialing/past_due
      // all hold Pro (past_due = dunning grace). Date is NOT the gate here — a
      // past_due row may carry a stale period end while the user still has Pro.
      const ENTITLING = new Set(['active', 'trialing', 'past_due']);
      const hasActiveRecurring = (subs ?? []).some((s) =>
        (s.type === 'pro_monthly' || s.type === 'pro_yearly') && ENTITLING.has(s.status)
      );
      if (hasActiveRecurring) {
        return Response.json({
          error: 'You already have an active subscription. Use the billing portal to change plans.',
          code: 'SUBSCRIPTION_ALREADY_ACTIVE',
        }, { status: 409, headers: corsHeaders });
      }
    }

    const stripe = new Stripe(stripeKey);

    // ---------- Checkout retry handling (TRIP-82) ----------
    // No 15-min block. Two cases for a user's recent subscription sessions:
    //  • complete  → payment already went through but the webhook hasn't
    //    materialized the row yet (the SUBSCRIPTION_ALREADY_ACTIVE guard above
    //    passed, so the ledger has no active row). Don't create a 2nd
    //    subscription — return CHECKOUT_PROCESSING so the client shows
    //    "processing" + lets entitlement settle. Bounded to a short window so a
    //    stale (later-canceled) complete session can't block forever.
    //  • open      → abandoned (back / card fail / closed tab); Stripe keeps it
    //    ~24h. Expire it so a retry is never falsely blocked, then create fresh.
    if (planType === 'pro_monthly' || planType === 'pro_yearly') {
      try {
        const recent = await stripe.checkout.sessions.list({
          limit: 10,
          customer_details: { email: user.email! },
        }).catch(() => null);
        const sessions = (recent?.data || []).filter((s) =>
          s.mode === 'subscription' && s.customer_email === user.email
        );

        const tenMinAgo = Math.floor(Date.now() / 1000) - 10 * 60;
        const completeInFlight = sessions.find((s) =>
          s.status === 'complete' && (s.created ?? 0) >= tenMinAgo
        );
        if (completeInFlight) {
          return Response.json({
            error: 'A recent payment is still being processed. Please wait a moment and refresh.',
            code: 'CHECKOUT_PROCESSING',
          }, { status: 409, headers: corsHeaders });
        }

        for (const s of sessions.filter((s) => s.status === 'open')) {
          await stripe.checkout.sessions.expire(s.id).catch((e) =>
            console.error('Expire open session failed (non-fatal):', s.id, (e as Error).message)
          );
        }
      } catch (e) {
        console.error('Open-checkout cleanup failed (non-fatal):', (e as Error).message);
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
    }, {
      // Fresh per-attempt key: guards a network retry of THIS create call from
      // spawning two sessions. Not a static user+plan+trip key — that conflicts
      // with expire+recreate (Stripe caches the response ~24h and would return an
      // already-expired session). Double-click is covered by the button's loading
      // state; double-pay by the webhook pro_trip guard + uq indexes + the
      // SUBSCRIPTION_ALREADY_ACTIVE / CHECKOUT_PROCESSING guards above.
      idempotencyKey: crypto.randomUUID(),
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
