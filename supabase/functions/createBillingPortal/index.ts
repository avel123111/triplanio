/**
 * createBillingPortal
 *
 * POST body: { returnPath? }
 *
 * Creates a Stripe Billing Portal session for the current user so they can
 * manage their Pro subscription (update card, cancel, view invoices).
 */

import { withHandler } from '../_shared/http.ts';
import { supabaseAdmin, getRequestUser } from '../_shared/supabaseAdmin.ts';
import { StripeAdapter } from '../_shared/payments/stripeAdapter.ts';
import { stripeEnv } from '../_shared/payments/catalog.ts';
import { getProviderCustomerId, saveProviderCustomerId } from '../_shared/payments/customer.ts';

Deno.serve(withHandler('createBillingPortal', async (req, corsHeaders) => {
    const user = await getRequestUser(req);
    if (!user) return Response.json({ error: 'Unauthorized' }, { status: 401, headers: corsHeaders });

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

    const { returnPath } = await req.json().catch(() => ({}));
    const safeReturn = (returnPath && returnPath.startsWith('/')) ? returnPath : '/settings';
    const returnUrl = `${publicAppUrl}${safeReturn}`;

    const stripeKey = Deno.env.get('STRIPE_SECRET_KEY');
    if (!stripeKey) {
      console.error('STRIPE_SECRET_KEY missing');
      return Response.json({ error: 'Server misconfigured: Stripe key missing' }, { status: 500, headers: corsHeaders });
    }
    const adapter = new StripeAdapter(stripeKey, stripeEnv(stripeKey));

    // Fast path: customer id из provider_customer (канон). Избегает round-trip к Stripe.
    let customerId = await getProviderCustomerId(supabaseAdmin, user.id);

    // Fallback (теперь почти не срабатывает): createStripeCheckout создаёт+сохраняет
    // customer ДО чекаута, а вебхук сохраняет его на каждом событии — provider_customer
    // у платившего юзера всегда заполнен. Оставлен как страховка для исторических строк:
    // резолвим customer через последнюю recurring подписку реестра И записываем обратно,
    // чтобы следующий заход шёл по fast-path (не дёргал Stripe каждый раз).
    if (!customerId) {
      const { data: subs } = await supabaseAdmin
        .from('subscription')
        .select('provider_subscription_id, created_at')
        .eq('user_id', user.id)
        .in('product_code', ['account_pro_monthly', 'account_pro_yearly'])
        .not('provider_subscription_id', 'is', null)
        .order('created_at', { ascending: false })
        .limit(5);
      const latest = (subs ?? []).find((s) => s.provider_subscription_id);
      if (!latest?.provider_subscription_id) {
        return Response.json({ error: 'No active subscription found' }, { status: 404, headers: corsHeaders });
      }
      const subscription = await adapter.fetchSubscription(latest.provider_subscription_id);
      customerId = (subscription.customer as string) || null;
      if (customerId) await saveProviderCustomerId(supabaseAdmin, user.id, customerId);
    }

    if (!customerId) {
      return Response.json({ error: 'No Stripe customer linked to this subscription' }, { status: 404, headers: corsHeaders });
    }

    const { url } = await adapter.createPortalSession(customerId, returnUrl);
    return Response.json({ url }, { headers: corsHeaders });

}));
