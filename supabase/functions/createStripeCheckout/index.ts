/**
 * createStripeCheckout (Ф2b — платёжный фундамент)
 *
 * POST body: { tripId?, productCode: 'trip_pro_lifetime'|'account_pro_monthly'|'account_pro_yearly' }
 *
 * Двойная оплата закрывается ЗДЕСЬ (корень TRIP-32) НАТИВНОЙ идемпотентностью
 * Stripe — без своей дедуп-машинерии:
 *  - Предчек активного права: уже есть active покупка трипа / энтайтлинг-подписка
 *    → не начинаем оплату (409 → биллинг-портал).
 *  - Ленивый ОБЯЗАТЕЛЬНЫЙ Customer: на первом чекауте get-or-create cus_… и
 *    сохраняем в provider_customer ДО похода в Checkout; всегда шлём customer:id
 *    (никогда email) — тело запроса перестаёт «прыгать».
 *  - СТАБИЛЬНЫЙ Stripe idempotency-ключ (`checkout:<user>:<product>[:<trip>]:<cus>`)
 *    + детерминированное тело (фикс. success/cancel URL без returnPath, customer:id) →
 *    две вкладки (даже одновременно, даже новый юзер) → Stripe отдаёт ТУ ЖЕ сессию →
 *    одно списание. Свой outbound_idempotency/90с/рандом-ключ — выпилены.
 *
 * landing-path детерминирован сервером из (productCode, tripId): подписка → /settings,
 * trip_pro_lifetime → /trip/<id>. returnPath клиента больше НЕ принимаем (ломал детерминизм).
 *
 * Каталог/цена — из БД через StripeAdapter (provider_price + default_price).
 */

import { corsFor } from '../_shared/cors.ts';
import { supabaseAdmin, getRequestUser } from '../_shared/supabaseAdmin.ts';
import type Stripe from 'npm:stripe@17.0.0';
import { captureEdgeError } from '../_shared/sentry.ts';
import { StripeAdapter } from '../_shared/payments/stripeAdapter.ts';
import { stripeEnv, isProductCode, ENTITLING_STATUSES } from '../_shared/payments/catalog.ts';
import { ensureProviderCustomerId, saveProviderCustomerId } from '../_shared/payments/customer.ts';

Deno.serve(async (req) => {
  const corsHeaders = corsFor(req);
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });

  try {
    const user = await getRequestUser(req);
    if (!user) return Response.json({ error: 'Unauthorized' }, { status: 401, headers: corsHeaders });

    const { tripId, productCode } = await req.json();
    if (!isProductCode(productCode)) {
      return Response.json({ error: 'Invalid product code' }, { status: 400, headers: corsHeaders });
    }

    // ---------- Origin ----------
    const publicAppUrl = (Deno.env.get('PUBLIC_APP_URL') || '').replace(/\/+$/, '');
    if (!publicAppUrl) {
      return Response.json({ error: 'Server misconfigured: PUBLIC_APP_URL missing' }, { status: 500, headers: corsHeaders });
    }
    const reqOrigin = (req.headers.get('origin') || '').replace(/\/+$/, '');
    if (reqOrigin && reqOrigin !== publicAppUrl) {
      return Response.json({ error: 'Origin not allowed' }, { status: 400, headers: corsHeaders });
    }

    const stripeKey = Deno.env.get('STRIPE_SECRET_KEY');
    if (!stripeKey) {
      return Response.json({ error: 'Server misconfigured: Stripe key missing' }, { status: 500, headers: corsHeaders });
    }
    const env = stripeEnv(stripeKey);
    const adapter = new StripeAdapter(stripeKey, env);

    // ---------- Предчек активного права (до создания Customer) ----------
    if (productCode === 'trip_pro_lifetime') {
      if (!tripId) return Response.json({ error: 'tripId required for trip_pro_lifetime' }, { status: 400, headers: corsHeaders });
      const { data: trip } = await supabaseAdmin
        .from('trips').select('id, created_by').eq('id', tripId).single();
      if (!trip) return Response.json({ error: 'Trip not found' }, { status: 404, headers: corsHeaders });
      if (trip.created_by !== user.id) {
        return Response.json({ error: 'Only the trip owner can buy Pro for this trip' }, { status: 403, headers: corsHeaders });
      }
      // Уже Pro по ЛЮБОЙ оси → второй раз не продаём. Единый предикат
      // is_trip_pro = is_pro_trip OR is_user_pro(created_by) закрывает рассинхрон
      // сервер↔фронт: владелец с активной подпиской имеет is_pro_trip=false, но трип
      // уже Pro через подписку — прежний чек по колонке этого не видел. Fail-closed:
      // ошибка предиката → 500 (не начинаем оплату), а не молчаливое списание.
      const { data: alreadyPro, error: proErr } = await supabaseAdmin.rpc('is_trip_pro', { p_trip_id: tripId });
      if (proErr) throw proErr;
      if (alreadyPro) {
        return Response.json({ error: 'This trip is already Pro', code: 'TRIP_ALREADY_PRO' }, { status: 409, headers: corsHeaders });
      }
    } else {
      // Статус-driven (как recompute): active/trialing/past_due держат Pro.
      const { data: subs } = await supabaseAdmin
        .from('subscription').select('status').eq('user_id', user.id).in('status', [...ENTITLING_STATUSES]).limit(1);
      if (subs && subs.length > 0) {
        return Response.json({
          error: 'You already have an active subscription. Use the billing portal to change plans.',
          code: 'SUBSCRIPTION_ALREADY_ACTIVE',
        }, { status: 409, headers: corsHeaders });
      }
    }

    // ---------- Резолв цены из каталога БД ----------
    const providerProductId = await adapter.providerProductId(productCode);
    if (!providerProductId) {
      return Response.json({ error: `No catalog entry for ${productCode}` }, { status: 500, headers: corsHeaders });
    }
    const price = await adapter.resolvePriceForProduct(providerProductId);

    // ---------- Ленивый ОБЯЗАТЕЛЬНЫЙ Customer ----------
    // Нет cus_… → создаём (стабильный idem-ключ → одна вкладка-победитель) и
    // сохраняем; в Checkout идём только с готовым customer:id. Провал → 500.
    const customerId = await ensureProviderCustomerId(
      supabaseAdmin,
      (uid, email) => adapter.createCustomer(uid, email, `customer:${uid}`),
      user.id,
      user.email ?? null,
    );

    const mode = productCode === 'trip_pro_lifetime' ? 'payment' : 'subscription';
    // landing-path детерминирован сервером (returnPath клиента не принимаем).
    const landingPath = productCode === 'trip_pro_lifetime' ? `/trip/${tripId}` : '/settings';
    const ctxParam = productCode === 'trip_pro_lifetime' ? `&kind=trip&pt=${tripId}` : '&kind=sub';

    const buildParams = (custId: string): Stripe.Checkout.SessionCreateParams => ({
      payment_method_types: ['card'],
      line_items: [{ price: price.price_id, quantity: 1 }],
      mode,
      locale: 'auto',
      success_url: `${publicAppUrl}${landingPath}?stripe_status=success&session_id={CHECKOUT_SESSION_ID}${ctxParam}`,
      cancel_url: `${publicAppUrl}${landingPath}?stripe_status=cancel${ctxParam}`,
      client_reference_id: user.id,
      customer: custId,
      metadata: { user_id: user.id, user_email: user.email!, trip_id: tripId || '', product_code: productCode },
      ...(mode === 'subscription'
        ? { subscription_data: { metadata: { user_id: user.id, product_code: productCode } } }
        : {}),
    });

    // СТАБИЛЬНЫЙ Stripe idempotency-ключ. customerId в ключе: при протухшем customer
    // (см. ниже) ключ меняется вместе с телом — нет Stripe-400 «same key, diff params».
    const idemKeyFor = (custId: string) => productCode === 'trip_pro_lifetime'
      ? `checkout:${user.id}:${productCode}:${tripId}:${custId}`
      : `checkout:${user.id}:${productCode}:${custId}`;

    let session: Stripe.Checkout.Session;
    try {
      session = await adapter.createCheckout(buildParams(customerId), idemKeyFor(customerId));
    } catch (e) {
      const err = e as { code?: string; message?: string };
      const stale = err.code === 'resource_missing' || /no such customer/i.test(err.message || '');
      if (!stale) throw e;
      // Сохранённый customer протух (удалён в Stripe). Выкидываем строку и создаём
      // НОВЫЙ с уникальным ключом (стабильный реплеил бы тот же удалённый), повторяем раз.
      console.error('createStripeCheckout: stale customer, recreating');
      await supabaseAdmin.from('provider_customer')
        .delete().eq('user_id', user.id).eq('provider_customer_id', customerId);
      const freshId = await adapter.createCustomer(user.id, user.email ?? null, `customer:${user.id}:${crypto.randomUUID()}`);
      await saveProviderCustomerId(supabaseAdmin, user.id, freshId);
      session = await adapter.createCheckout(buildParams(freshId), idemKeyFor(freshId));
    }

    return Response.json({ url: session.url }, { headers: corsHeaders });

  } catch (error) {
    await captureEdgeError(error, 'createStripeCheckout');
    console.error('Stripe checkout error:', error);
    return Response.json({ error: error instanceof Error ? error.message : 'Internal error' }, { status: 500, headers: corsHeaders });
  }
});
