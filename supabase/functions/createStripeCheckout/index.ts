/**
 * createStripeCheckout (Ф2b — платёжный фундамент)
 *
 * POST body: { tripId?, planType: 'pro_trip'|'pro_monthly'|'pro_yearly', returnPath? }
 *
 * Двойная оплата закрывается ЗДЕСЬ (корень TRIP-32):
 *  - Предчек активного права: уже есть active покупка трипа / энтайтлинг-подписка
 *    → не начинаем оплату (409 → биллинг-портал).
 *  - Схлопывание двух почти одновременных вкладок: ≤90с назад создавали сессию
 *    для того же логического ключа → отдаём ту же ссылку (дедуп в НАШЕЙ БД,
 *    outbound_idempotency). Stripe idempotency-ключ — РАНДОМНЫЙ (стабильный ломал
 *    нормальный ретрай Stripe-400 «same key, different params»).
 *  - self-heal протухшего customer id → ретрай по email.
 *
 * Снято: list 10 сессий, окно 10 мин, CHECKOUT_PROCESSING, expire брошенных,
 * SUPPORTED_LOCALES/locale (шлём auto).
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
import { getProviderCustomerId } from '../_shared/payments/customer.ts';

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

    // Сохранённый Stripe customer (CK-6: не плодим Customer'ов) — из provider_customer.
    const existingCustomerId = await getProviderCustomerId(supabaseAdmin, user.id);

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

    // Логический ключ НАШЕЙ идемпотентности (провайдер-агностично). Подписка —
    // аккаунт-уровень (trip НЕ кладём); pro_trip — trip-scoped.
    const idemKey = planType === 'pro_trip'
      ? `checkout:${user.id}:${productCode}:${tripId}`
      : `checkout:${user.id}:${productCode}`;
    const COLLAPSE_MS = 90 * 1000; // окно схлопывания двух вкладок одной покупки

    const buildParams = (useCustomerId: boolean): Stripe.Checkout.SessionCreateParams => {
      const useExisting = useCustomerId && !!existingCustomerId;
      return {
        payment_method_types: ['card'],
        line_items: [{ price: price.price_id, quantity: 1 }],
        mode,
        locale: 'auto',
        success_url: `${publicAppUrl}${safeReturn}${sep}stripe_status=success&session_id={CHECKOUT_SESSION_ID}${ctxParam}`,
        cancel_url: `${publicAppUrl}${safeReturn}${sep}stripe_status=cancel${ctxParam}`,
        client_reference_id: user.id,
        ...(useExisting ? { customer: existingCustomerId! } : { customer_email: user.email! }),
        // pro_trip = payment-mode, который по умолчанию НЕ создаёт Stripe Customer
        // (session.customer=null → вебхук не сохранял provider_customer). Просим
        // Stripe создавать Customer всегда (когда не передаём существующего) —
        // унифицирует идентичность с подпиской.
        ...(mode === 'payment' && !useExisting ? { customer_creation: 'always' as const } : {}),
        metadata: { user_id: user.id, user_email: user.email!, trip_id: tripId || '', plan_type: planType, return_path: safeReturn },
        ...(mode === 'subscription'
          ? { subscription_data: { metadata: { user_id: user.id, plan_type: planType } } }
          : {}),
      };
    };

    // Схлопывание двух почти одновременных вкладок одной покупки: если ≤90с назад
    // уже создали сессию для этого же логического ключа — отдаём ту же ссылку.
    // Stripe idempotency-ключ при этом РАНДОМНЫЙ: стабильный ломался Stripe-400
    // «same key, different params» при любом отличии тела (email→customer после
    // первой покупки, другой returnPath/locale). Дедуп держим в НАШЕЙ БД.
    const { data: prior } = await supabaseAdmin
      .from('outbound_idempotency')
      .select('response, updated_at')
      .eq('idempotency_key', idemKey)
      .maybeSingle();
    const priorUrl = (prior?.response as { url?: string } | null)?.url;
    if (priorUrl && prior?.updated_at && (Date.now() - new Date(prior.updated_at).getTime() < COLLAPSE_MS)) {
      return Response.json({ url: priorUrl }, { headers: corsHeaders });
    }

    let session: Stripe.Checkout.Session;
    try {
      session = await adapter.createCheckout(buildParams(true), crypto.randomUUID());
    } catch (e) {
      // Протухший сохранённый customer id → ретрай по email.
      const err = e as { code?: string; message?: string };
      if (existingCustomerId && (err.code === 'resource_missing' || /no such customer/i.test(err.message || ''))) {
        console.error('createStripeCheckout: stale customer id, retrying by email');
        session = await adapter.createCheckout(buildParams(false), crypto.randomUUID());
      } else {
        throw e;
      }
    }

    await supabaseAdmin.from('outbound_idempotency').upsert({
      idempotency_key: idemKey, user_id: user.id, operation: 'checkout',
      status: 'completed', response: { url: session.url }, updated_at: new Date().toISOString(),
    }, { onConflict: 'idempotency_key' });

    return Response.json({ url: session.url }, { headers: corsHeaders });

  } catch (error) {
    await captureEdgeError(error, 'createStripeCheckout');
    console.error('Stripe checkout error:', error);
    return Response.json({ error: error instanceof Error ? error.message : 'Internal error' }, { status: 500, headers: corsHeaders });
  }
});
