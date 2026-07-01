/**
 * getStripePrices
 *
 * GET/POST — no body required.
 *
 * Returns Stripe default prices keyed by product_code (our 3 products) so the
 * frontend renders amounts/currency from Stripe Dashboard (no hardcoded prices).
 *
 * Stripe mode (test/live) is auto-detected from STRIPE_SECRET_KEY — one mode
 * per Supabase project (live in prod, test in dev).
 */

import { corsFor } from '../_shared/cors.ts';
import { getRequestUser } from '../_shared/supabaseAdmin.ts';
import { captureEdgeError } from '../_shared/sentry.ts';
import { StripeAdapter } from '../_shared/payments/stripeAdapter.ts';
import { getActiveProviderProducts, stripeEnv } from '../_shared/payments/catalog.ts';

Deno.serve(async (req) => {
  const corsHeaders = corsFor(req);
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });

  try {
    const user = await getRequestUser(req);
    if (!user) return Response.json({ error: 'Unauthorized' }, { status: 401, headers: corsHeaders });

    const stripeKey = Deno.env.get('STRIPE_SECRET_KEY');
    if (!stripeKey) {
      console.error('STRIPE_SECRET_KEY missing');
      return Response.json({ error: 'Server misconfigured: Stripe key missing' }, { status: 500, headers: corsHeaders });
    }
    const env = stripeEnv(stripeKey);
    const adapter = new StripeAdapter(stripeKey, env);

    // Каталог из БД (product / provider_price) — единственный источник. Пусто =
    // реальный мисконфиг (миграция Ф1 сидирует обе среды): логируем и отдаём {}.
    const catalog = await getActiveProviderProducts('stripe', env);
    if (catalog.length === 0) {
      console.warn(`getStripePrices: DB catalog empty for env=${env} (seed migration not applied?)`);
    }

    const entries = await Promise.all(
      catalog.map(async ({ product_code, provider_product_id }) => {
        const price = await adapter.resolvePriceForProduct(provider_product_id);
        return [product_code, {
          product_code,
          price_id: price.price_id,
          product_id: provider_product_id,
          unit_amount: price.unit_amount,
          currency: price.currency,
          recurring_interval: price.recurring_interval,
        }];
      })
    );

    return Response.json({ prices: Object.fromEntries(entries) }, { headers: corsHeaders });

  } catch (error) {
    await captureEdgeError(error, 'getStripePrices');
    console.error('getStripePrices error:', error);
    return Response.json(
      { error: error instanceof Error ? error.message : 'Internal error' },
      { status: 500, headers: corsHeaders },
    );
  }
});
