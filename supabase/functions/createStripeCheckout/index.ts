/**
 * createStripeCheckout (Ф2b — платёжный фундамент)
 *
 * POST body: { tripId?, planType: 'pro_trip'|'pro_monthly'|'pro_yearly', returnPath? }
 *
 * Двойная оплата закрывается ЗДЕСЬ (корень TRIP-32):
 *  - НАШ стабильный idempotency-ключ из (user, product, trip) → две вкладки/два
 *    устройства/дабл-клик получают ОДНУ checkout-сессию (Stripe возвращает ту же
 *    по тому же ключу). Запись интента — в outbound_idempotency.
 *  - Предчек активного права: уже есть active покупка трипа / энтайтлинг-подписка
 *    → не начинаем оплату (409 → биллинг-портал).
 *  - self-heal протухшего customer id: своя суффикс-ветка ключа (другое тело).
 *
 * Снято (было нужно только из-за случайного ключа): list 10 сессий, окно 10 мин,
 * CHECKOUT_PROCESSING, expire брошенных, SUPPORTED_LOCALES/locale (шлём auto).
 *
 * Каталог/цена — из БД через StripeAdapter (provider_price + default_price).
 */

import { corsFor } from '../_shared/cors.ts';
import { supabaseAdmin, getRequestUser } from '../_shared/supabaseAdmin.ts';
import type Stripe from 'npm:stripe@17.0.0';
import { captureEdgeError } from '../_shared/sentry.ts';
import { VALID_PLANS, type PlanType } from '../_shared/stripeCatalog.ts';
import { StripeAdapter } from '../_shared/payments/stripeAdapter.ts';
import { stripeEnv, PLAN_TO_PRODUCT } from '../_shared/payments/catalog.ts';

const ENTITLING = ['active', 'trialing', 'past_due'];

Deno.serve(async (req) => {
  const corsHeaders = corsFor(req);
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });

  try {
    const user = await getRequestUser(req);
    if (!user) return Response.json({ error: 'Unauthorized' }, { status: 401, headers: corsHeaders });

    const { tripId, planType, returnPath } = await req.json();
    if (!VALID_PLANS.includes(planType)) {
      return Response.json({ error: 'Invalid plan type' }, { status: 400, headers: corsHeaders });
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

    // Сохранённый Stripe customer (CK-6: не плодим Customer'ов).
    const { data: urow } = await supabaseAdmin
      .from('users').select('stripe_customer_id').eq('id', user.id).single();
    const existingCustomerId = (urow?.stripe_customer_id as string) || null;

    // ---------- Предчек активного права ----------
    if (planType === 'pro_trip') {
      if (!tripId) return Response.json({ error: 'tripId required for pro_trip' }, { status: 400, headers: corsHeaders });
      const { data: trip } = await supabaseAdmin
        .from('trips').select('id, created_by, is_pro_trip').eq('id', tripId).single();
      if (!trip) return Response.json({ error: 'Trip not found' }, { status: 404, headers: corsHeaders });
      if (trip.created_by !== user.id) {
        return Response.json({ error: 'Only the trip owner can buy Pro for this trip' }, { status: 403, headers: corsHeaders });
      }
      if (trip.is_pro_trip) {
        return Response.json({ error: 'This trip is already Pro', code: 'TRIP_ALREADY_PRO' }, { status: 409, headers: corsHeaders });
      }
    } else {
      // Статус-driven (как recompute): active/trialing/past_due держат Pro.
      const { data: subs } = await supabaseAdmin
        .from('subscription').select('status').eq('user_id', user.id).in('status', ENTITLING).limit(1);
      if (subs && subs.length > 0) {
        return Response.json({
          error: 'You already have an active subscription. Use the billing portal to change plans.',
          code: 'SUBSCRIPTION_ALREADY_ACTIVE',
        }, { status: 409, headers: corsHeaders });
      }
    }

    // ---------- Резолв цены из каталога БД ----------
    const productCode = PLAN_TO_PRODUCT[planType as PlanType];
    const providerProductId = await adapter.providerProductId(productCode);
    if (!providerProductId) {
      return Response.json({ error: `No catalog entry for ${planType}` }, { status: 500, headers: corsHeaders });
    }
    const price = await adapter.resolvePriceForProduct(providerProductId);

    const mode = planType === 'pro_trip' ? 'payment' : 'subscription';
    const safeReturn = (returnPath && returnPath.startsWith('/')) ? returnPath : '/';
    const sep = safeReturn.includes('?') ? '&' : '?';
    const ctxParam = planType === 'pro_trip' ? `&kind=trip&pt=${tripId}` : '&kind=sub';

    // НАШ стабильный ключ: (user, product, trip). Две вкладки → один ключ → одна
    // сессия Stripe. self-heal по email — отдельный суффикс (другое тело).
    const baseKey = `checkout:${user.id}:${productCode}:${tripId || '-'}`;

    const buildParams = (useCustomerId: boolean): Stripe.Checkout.SessionCreateParams => ({
      payment_method_types: ['card'],
      line_items: [{ price: price.price_id, quantity: 1 }],
      mode,
      locale: 'auto',
      success_url: `${publicAppUrl}${safeReturn}${sep}stripe_status=success&session_id={CHECKOUT_SESSION_ID}${ctxParam}`,
      cancel_url: `${publicAppUrl}${safeReturn}${sep}stripe_status=cancel${ctxParam}`,
      client_reference_id: user.id,
      ...(useCustomerId && existingCustomerId ? { customer: existingCustomerId } : { customer_email: user.email! }),
      metadata: { user_id: user.id, user_email: user.email!, trip_id: tripId || '', plan_type: planType, return_path: safeReturn },
      ...(mode === 'subscription'
        ? { subscription_data: { metadata: { user_id: user.id, plan_type: planType } } }
        : {}),
    });

    // Запись интента (провайдер-агностичная идемпотентность исходящего вызова).
    await supabaseAdmin.from('outbound_idempotency')
      .upsert({ idempotency_key: baseKey, user_id: user.id, operation: 'checkout', status: 'pending' },
              { onConflict: 'idempotency_key', ignoreDuplicates: true });

    let session: Stripe.Checkout.Session;
    try {
      session = await adapter.createCheckout(buildParams(true), baseKey);
    } catch (e) {
      // Протухший сохранённый customer id → ретрай по email (своим ключом).
      const err = e as { code?: string; message?: string };
      if (existingCustomerId && (err.code === 'resource_missing' || /no such customer/i.test(err.message || ''))) {
        console.error('createStripeCheckout: stale stripe_customer_id, retrying by email');
        session = await adapter.createCheckout(buildParams(false), `${baseKey}:byemail`);
      } else {
        throw e;
      }
    }

    await supabaseAdmin.from('outbound_idempotency')
      .update({ status: 'completed', response: { url: session.url } })
      .eq('idempotency_key', baseKey);

    return Response.json({ url: session.url }, { headers: corsHeaders });

  } catch (error) {
    await captureEdgeError(error, 'createStripeCheckout');
    console.error('Stripe checkout error:', error);
    return Response.json({ error: error instanceof Error ? error.message : 'Internal error' }, { status: 500, headers: corsHeaders });
  }
});
