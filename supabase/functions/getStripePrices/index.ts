/**
 * getStripePrices
 *
 * GET/POST — no body required.
 *
 * Returns live Stripe default prices for our 3 plan types so the frontend
 * renders amounts/currency from Stripe Dashboard (no hardcoded prices).
 *
 * Routes between LIVE and TEST Stripe based on STRIPE_TEST_ORIGIN env var:
 * if the request comes from that origin, uses test keys + test product IDs.
 */

import { corsHeaders } from '../_shared/cors.ts';
import { getRequestUser } from '../_shared/supabaseAdmin.ts';
import Stripe from 'npm:stripe@17.0.0';

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
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });

  try {
    const user = await getRequestUser(req);
    if (!user) return Response.json({ error: 'Unauthorized' }, { status: 401, headers: corsHeaders });

    const testOrigin = (Deno.env.get('STRIPE_TEST_ORIGIN') || '').replace(/\/+$/, '');
    const reqOrigin = (req.headers.get('origin') || '').replace(/\/+$/, '');
    const isTestEnv = !!(testOrigin && reqOrigin === testOrigin);

    const stripeKey = isTestEnv
      ? Deno.env.get('STRIPE_TEST_SECRET_KEY')
      : Deno.env.get('STRIPE_SECRET_KEY');
    if (!stripeKey) {
      console.error('Stripe secret key missing for env:', isTestEnv ? 'TEST' : 'LIVE');
      return Response.json({ error: 'Server misconfigured: Stripe key missing' }, { status: 500, headers: corsHeaders });
    }

    const stripe = new Stripe(stripeKey);
    const productIds = isTestEnv ? TEST_PRODUCT_IDS : LIVE_PRODUCT_IDS;

    const entries = await Promise.all(
      Object.entries(productIds).map(async ([planType, productId]) => {
        // Expand default_price for a single call — no hardcoded price IDs
        const product = await stripe.products.retrieve(productId, {
          expand: ['default_price'],
        });
        let price = product.default_price;
        // Fallback: first active price if no default is set
        if (!price || typeof price === 'string') {
          const list = await stripe.prices.list({ product: productId, active: true, limit: 1 });
          price = list.data[0];
        }
        if (!price) {
          throw new Error(`Product ${productId} (${planType}) has no active prices in Stripe`);
        }
        const p = price as Stripe.Price;
        return [planType, {
          plan_type: planType,
          price_id: p.id,
          product_id: productId,
          unit_amount: p.unit_amount,
          currency: p.currency,
          recurring_interval: p.recurring?.interval || null,
        }];
      })
    );

    return Response.json({ prices: Object.fromEntries(entries) }, { headers: corsHeaders });

  } catch (error) {
    console.error('getStripePrices error:', error);
    return Response.json(
      { error: error instanceof Error ? error.message : 'Internal error' },
      { status: 500, headers: corsHeaders },
    );
  }
});
