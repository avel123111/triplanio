import { createClientFromRequest } from 'npm:@base44/sdk@0.8.25';
import Stripe from 'npm:stripe@17.0.0';

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me();

    if (!user) {
      return Response.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const { tripId, planType, returnPath, locale } = await req.json();

    const validPlans = ['pro_trip', 'pro_monthly', 'pro_yearly'];
    if (!validPlans.includes(planType)) {
      return Response.json({ error: 'Invalid plan type' }, { status: 400 });
    }

    // ---------- Origin validation + Stripe env routing ----------
    // PROD: requests from PUBLIC_APP_URL → live Stripe keys + live products.
    // TEST: requests from the Base44 share-preview URL → test Stripe keys +
    // test products. This lets us safely test payments without touching prod.
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
    console.log('Stripe checkout env:', isTestEnv ? 'TEST' : 'LIVE', 'origin:', reqOrigin);

    // ---------- Per-trip Pro: validate trip ownership ----------
    // Closes a security hole: any logged-in user could buy Pro for someone
    // else's trip if they passed that trip_id.
    if (planType === 'pro_trip') {
      if (!tripId) {
        return Response.json({ error: 'tripId required for pro_trip' }, { status: 400 });
      }
      let trip;
      try {
        trip = await base44.asServiceRole.entities.Trip.get(tripId);
      } catch {
        return Response.json({ error: 'Trip not found' }, { status: 404 });
      }
      if (!trip) {
        return Response.json({ error: 'Trip not found' }, { status: 404 });
      }
      if (trip.created_by !== user.email) {
        return Response.json({ error: 'Only the trip owner can buy Pro for this trip' }, { status: 403 });
      }
      if (trip.is_pro_trip) {
        return Response.json({ error: 'This trip is already Pro', code: 'TRIP_ALREADY_PRO' }, { status: 409 });
      }
    }

    // ---------- Recurring: block duplicate active subscription ----------
    // Check fresh data via service role (not the cached user payload) and
    // verify an ACTIVE recurring TripSubscription, not just User.subscription_status
    // (which can also be 'pro' from a pro_trip purchase in legacy edge cases).
    if (planType === 'pro_monthly' || planType === 'pro_yearly') {
      const subs = await base44.asServiceRole.entities.TripSubscription.filter({ user_email: user.email });
      const now = Date.now();
      const hasActiveRecurring = subs.some(s =>
        (s.type === 'pro_monthly' || s.type === 'pro_yearly') &&
        s.status === 'active' &&
        s.end_date && new Date(s.end_date).getTime() > now
      );
      if (hasActiveRecurring) {
        return Response.json({
          error: 'You already have an active subscription. Use the billing portal to change plans.',
          code: 'SUBSCRIPTION_ALREADY_ACTIVE'
        }, { status: 409 });
      }
    }

    const stripeKey = isTestEnv
      ? Deno.env.get('STRIPE_TEST_SECRET_KEY')
      : Deno.env.get('STRIPE_SECRET_KEY');
    if (!stripeKey) {
      console.error('Stripe secret key missing for env:', isTestEnv ? 'TEST' : 'LIVE');
      return Response.json({ error: 'Server misconfigured: Stripe key missing' }, { status: 500 });
    }
    const stripe = new Stripe(stripeKey);

    // ---------- Race-condition guard: recent Stripe checkout in flight ----------
    // After a successful Stripe Checkout, the webhook can take a few seconds to
    // arrive. During that window, the local DB still says "free" — so a quick
    // double-click on the Upgrade button would create a SECOND subscription.
    //
    // Source of truth = Stripe itself: list recent Checkout Sessions for this
    // customer email and reject if any session for a subscription plan is
    // either already paid (complete) or still open within the last 15 minutes.
    if (planType === 'pro_monthly' || planType === 'pro_yearly') {
      try {
        const fifteenMinAgo = Math.floor(Date.now() / 1000) - 15 * 60;
        const recent = await stripe.checkout.sessions.list({
          limit: 10,
          created: { gte: fifteenMinAgo },
          customer_details: { email: user.email },
        }).catch(() => null);
        const sessions = recent?.data || [];
        const inFlight = sessions.find((s) =>
          s.mode === 'subscription' &&
          s.customer_email === user.email &&
          (s.status === 'complete' || s.status === 'open') &&
          (s.payment_status === 'paid' || s.payment_status === 'unpaid' || s.payment_status === 'no_payment_required')
        );
        if (inFlight) {
          console.log('Recent checkout in flight for', user.email, '-> blocking duplicate:', inFlight.id, inFlight.status);
          return Response.json({
            error: 'A recent payment is still being processed. Please wait a moment and refresh.',
            code: 'RECENT_CHECKOUT_PENDING'
          }, { status: 409 });
        }
      } catch (e) {
        // Non-fatal: if Stripe lookup fails, fall through to creating a session.
        console.error('Recent-checkout lookup failed (non-fatal):', e.message);
      }
    }

    // Resolve the active Stripe price via product.default_price (with a
    // fallback to the first active price). This keeps us in sync with whatever
    // is configured in the Stripe Dashboard — no hardcoded price IDs.
    const productMap = isTestEnv ? {
      pro_trip: 'prod_UZnCx7GA3YlLJd',
      pro_monthly: 'prod_UZnBPOlJL0xmue',
      pro_yearly: 'prod_UZnBUDGL1PuyEN',
    } : {
      pro_trip: 'prod_UYfZZsZnknkxDj',
      pro_monthly: 'prod_UYfZf8WvFNE3cI',
      pro_yearly: 'prod_UYfZBYzOWrKiLu',
    };
    const productId = productMap[planType];
    const product = await stripe.products.retrieve(productId, { expand: ['default_price'] });
    let price = product.default_price;
    if (!price || typeof price === 'string') {
      const list = await stripe.prices.list({ product: productId, active: true, limit: 1 });
      price = list.data[0];
    }
    if (!price) {
      return Response.json({ error: `No active price for ${planType}` }, { status: 500 });
    }

    const mode = planType === 'pro_trip' ? 'payment' : 'subscription';
    // Sanitize returnPath — only allow paths starting with /
    const safeReturn = (returnPath && returnPath.startsWith('/')) ? returnPath : '/';
    const sep = safeReturn.includes('?') ? '&' : '?';

    // Stripe Checkout supports a fixed set of locale codes — fall back to 'auto'
    // (Stripe auto-detects from browser) if we don't recognize the value.
    const SUPPORTED_LOCALES = new Set([
      'auto','bg','cs','da','de','el','en','en-GB','es','es-419','et','fi','fil',
      'fr','fr-CA','hr','hu','id','it','ja','ko','lt','lv','ms','mt','nb','nl',
      'pl','pt','pt-BR','ro','ru','sk','sl','sv','th','tr','vi','zh','zh-HK','zh-TW'
    ]);
    const stripeLocale = SUPPORTED_LOCALES.has(locale) ? locale : 'auto';

    // Pre-fill the email on the Stripe checkout page so the user doesn't
    // have to type it. `customer_email` is shown read-only — Stripe still
    // creates a customer with this email behind the scenes.
    //
    // client_reference_id = our internal user.id (stable across email changes).
    // metadata.user_id / user_email / trip_id let the webhook resolve everything.
    const session = await stripe.checkout.sessions.create({
      payment_method_types: ['card'],
      line_items: [{
        price: price.id,
        quantity: 1
      }],
      mode,
      locale: stripeLocale,
      success_url: `${publicAppUrl}${safeReturn}${sep}stripe_status=success&session_id={CHECKOUT_SESSION_ID}`,
      cancel_url: `${publicAppUrl}${safeReturn}${sep}stripe_status=cancel`,
      client_reference_id: user.id,
      customer_email: user.email,
      metadata: {
        base44_app_id: Deno.env.get('BASE44_APP_ID'),
        user_id: user.id,
        user_email: user.email,
        trip_id: tripId || '',
        plan_type: planType,
        return_path: safeReturn
      }
    });

    return Response.json({ url: session.url });
  } catch (error) {
    console.error('Stripe checkout error:', error);
    return Response.json({ error: error.message }, { status: 500 });
  }
});