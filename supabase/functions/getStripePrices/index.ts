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

import { withHandler } from '../_shared/http.ts';
import { getRequestUser } from '../_shared/supabaseAdmin.ts';
import { StripeAdapter } from '../_shared/payments/stripeAdapter.ts';
import { getCatalogPricesCached, stripeEnv } from '../_shared/payments/catalog.ts';

Deno.serve(withHandler('getStripePrices', async (req, corsHeaders) => {
    const user = await getRequestUser(req);
    if (!user) return Response.json({ error: 'Unauthorized' }, { status: 401, headers: corsHeaders });

    const stripeKey = Deno.env.get('STRIPE_SECRET_KEY');
    if (!stripeKey) {
      console.error('STRIPE_SECRET_KEY missing');
      return Response.json({ error: 'Server misconfigured: Stripe key missing' }, { status: 500, headers: corsHeaders });
    }
    const env = stripeEnv(stripeKey);
    const adapter = new StripeAdapter(stripeKey, env);

    // Каталог из БД (product / provider_price) — единственный источник. Цена берётся
    // из lazy-TTL кэша в provider_price; в Stripe идём только на протухшей/пустой
    // строке (первый читающий обновляет кэш). Пусто = реальный мисконфиг (миграция
    // Ф1 сидирует обе среды): логируем и отдаём {}.
    const prices = await getCatalogPricesCached(
      (pid) => adapter.resolvePriceForProduct(pid), 'stripe', env);
    if (prices.length === 0) {
      console.warn(`getStripePrices: DB catalog empty for env=${env} (seed migration not applied?)`);
    }

    const map = Object.fromEntries(prices.map((p) => [p.product_code, {
      product_code: p.product_code,
      price_id: p.price_id,
      product_id: p.product_id,
      unit_amount: p.unit_amount,
      currency: p.currency,
      recurring_interval: p.recurring_interval,
    }]));

    return Response.json({ prices: map }, { headers: corsHeaders });

}));
