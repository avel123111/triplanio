import { createClientFromRequest } from 'npm:@base44/sdk@0.8.25';
import Stripe from 'npm:stripe@17.0.0';

// Returns the live Stripe default Price for each of our 3 plans so the
// frontend renders amounts/currency from the source of truth (Stripe Dashboard).
// We resolve via product.default_price — this lets the dashboard pick which
// price is active without us touching code.
//
// Routes between LIVE and TEST Stripe based on request origin (so the test
// share URL shows test prices and prod shows live prices).
const TEST_ORIGIN = 'https://share--ninja-wander-plan-go.base44.app';

const LIVE_PRODUCT_IDS = {
  pro_trip: 'prod_UYfZZsZnknkxDj',
  pro_monthly: 'prod_UYfZf8WvFNE3cI',
  pro_yearly: 'prod_UYfZBYzOWrKiLu',
};
const TEST_PRODUCT_IDS = {
  pro_trip: 'prod_UZnCx7GA3YlLJd',
  pro_monthly: 'prod_UZnBPOlJL0xmue',
  pro_yearly: 'prod_UZnBUDGL1PuyEN',
};

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me();
    if (!user) {
      return Response.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const reqOrigin = (req.headers.get('origin') || '').replace(/\/+$/, '');
    const isTestEnv = reqOrigin === TEST_ORIGIN;
    const stripeKey = isTestEnv
      ? Deno.env.get('STRIPE_TEST_SECRET_KEY')
      : Deno.env.get('STRIPE_SECRET_KEY');
    if (!stripeKey) {
      console.error('Stripe secret key missing for env:', isTestEnv ? 'TEST' : 'LIVE');
      return Response.json({ error: 'Server misconfigured: Stripe key missing' }, { status: 500 });
    }
    const stripe = new Stripe(stripeKey);
    const productIds = isTestEnv ? TEST_PRODUCT_IDS : LIVE_PRODUCT_IDS;

    const entries = await Promise.all(
      Object.entries(productIds).map(async ([planType, productId]) => {
        // Expand default_price so we get the full Price object in one call.
        const product = await stripe.products.retrieve(productId, {
          expand: ['default_price'],
        });
        let price = product.default_price;
        // Fallback: if no default is set in Stripe, take the first active price.
        if (!price || typeof price === 'string') {
          const list = await stripe.prices.list({ product: productId, active: true, limit: 1 });
          price = list.data[0];
        }
        if (!price) {
          throw new Error(`Product ${productId} (${planType}) has no active prices in Stripe`);
        }
        return [planType, {
          plan_type: planType,
          price_id: price.id,
          product_id: productId,
          unit_amount: price.unit_amount,        // cents
          currency: price.currency,              // e.g. 'usd'
          recurring_interval: price.recurring?.interval || null, // 'month'|'year'|null
        }];
      })
    );

    return Response.json({ prices: Object.fromEntries(entries) });
  } catch (error) {
    console.error('getStripePrices error:', error);
    return Response.json({ error: error.message }, { status: 500 });
  }
});