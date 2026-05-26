import { createClientFromRequest } from 'npm:@base44/sdk@0.8.25';
import Stripe from 'npm:stripe@17.0.0';

// Admin-only helper used to test Stripe end-to-end without touching real
// product/price logic. Hard-coded to the "Test subscription" Stripe product
// (prod_UZ9Yn841dRm7v0, $0.05/day) — uses its default price.
//
// Not wired into webhook/subscription business logic on purpose: this is a
// throwaway test path. The webhook will simply ignore unknown plan_type.
const TEST_PRODUCT_ID = 'prod_UZ9Yn841dRm7v0';

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me();
    if (!user) return Response.json({ error: 'Unauthorized' }, { status: 401 });
    if (user.role !== 'admin') return Response.json({ error: 'Forbidden' }, { status: 403 });

    const { returnPath, locale } = await req.json().catch(() => ({}));

    const publicAppUrl = (Deno.env.get('PUBLIC_APP_URL') || '').replace(/\/+$/, '');
    if (!publicAppUrl) {
      return Response.json({ error: 'Server misconfigured: PUBLIC_APP_URL missing' }, { status: 500 });
    }
    const reqOrigin = req.headers.get('origin') || '';
    if (reqOrigin && reqOrigin.replace(/\/+$/, '') !== publicAppUrl) {
      return Response.json({ error: 'Origin not allowed' }, { status: 400 });
    }

    const stripe = new Stripe(Deno.env.get('STRIPE_SECRET_KEY'));

    // Resolve the active price for the test product via default_price (fallback
    // to first active price). Keeps us decoupled from hardcoded price IDs.
    const product = await stripe.products.retrieve(TEST_PRODUCT_ID, { expand: ['default_price'] });
    let price = product.default_price;
    if (!price || typeof price === 'string') {
      const list = await stripe.prices.list({ product: TEST_PRODUCT_ID, active: true, limit: 1 });
      price = list.data[0];
    }
    if (!price) return Response.json({ error: 'No active price for test product' }, { status: 500 });

    const mode = price.recurring ? 'subscription' : 'payment';
    const safeReturn = (returnPath && returnPath.startsWith('/')) ? returnPath : '/settings';
    const sep = safeReturn.includes('?') ? '&' : '?';

    const SUPPORTED_LOCALES = new Set([
      'auto','bg','cs','da','de','el','en','en-GB','es','es-419','et','fi','fil',
      'fr','fr-CA','hr','hu','id','it','ja','ko','lt','lv','ms','mt','nb','nl',
      'pl','pt','pt-BR','ro','ru','sk','sl','sv','th','tr','vi','zh','zh-HK','zh-TW'
    ]);
    const stripeLocale = SUPPORTED_LOCALES.has(locale) ? locale : 'auto';

    const session = await stripe.checkout.sessions.create({
      payment_method_types: ['card'],
      line_items: [{ price: price.id, quantity: 1 }],
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
        plan_type: 'test_subscription',
        return_path: safeReturn,
      },
    });

    return Response.json({ url: session.url });
  } catch (error) {
    console.error('createTestCheckout error:', error);
    return Response.json({ error: error.message }, { status: 500 });
  }
});