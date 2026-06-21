/**
 * reconcileEntitlement — lazy "recompute-on-read" reconcile (Ф3).
 *
 * recompute_user_entitlement() is cheap (DB-only). This is the EXPENSIVE path:
 * it pulls the user's subscription state live from Stripe, refreshes/creates the
 * ledger row, then calls recompute. It self-heals a lost webhook the moment the
 * user opens a screen — WITHOUT hammering Stripe on every read.
 *
 * Two recovery directions (both throttled per-user via users.entitlement_synced_at):
 *   • stuck-PRO  — cache says pro but the period end is stale (lost renewal). We
 *     have ledger rows with a stripe_subscription_id → retrieve each and refresh.
 *   • stuck-FREE — cache says free but the user has a Stripe customer id (a lost
 *     ACTIVATION webhook: no ledger row was ever written). We list the customer's
 *     live subscriptions and materialize the missing row so recompute can grant Pro.
 *
 * Guarding is the CALLER's job: only invoke when the cache looks wrong (stuck-pro
 * stale, or free-with-a-customer). The throttle bounds it to one Stripe round-trip
 * per THROTTLE_MIN per user regardless.
 */

import Stripe from 'npm:stripe@17.0.0';
import type { SupabaseClient } from 'npm:@supabase/supabase-js@2';
import { getPeriodEndUnix, unixToIso } from './getPeriodEnd.ts';
import { planTypeForProduct, isTestStripeKey } from './stripeCatalog.ts';
import { reportPaymentAnomaly } from './sentry.ts';

const THROTTLE_MIN = 10;

export async function reconcileEntitlement(admin: SupabaseClient, userId: string): Promise<boolean> {
  if (!userId) return false;

  // ---- Throttle: at most one external reconcile per window per user ----
  const { data: u } = await admin
    .from('users')
    .select('entitlement_synced_at, stripe_customer_id')
    .eq('id', userId)
    .single();
  const last = u?.entitlement_synced_at ? new Date(u.entitlement_synced_at).getTime() : 0;
  if (Number.isFinite(last) && Date.now() - last < THROTTLE_MIN * 60 * 1000) return false;

  const key = Deno.env.get('STRIPE_SECRET_KEY');
  if (!key) return false;

  // Mark synced up-front so a slow/failing Stripe call still throttles the next read.
  await admin.from('users').update({ entitlement_synced_at: new Date().toISOString() }).eq('id', userId);

  const stripe = new Stripe(key);

  // Recurring rows that carry a Stripe subscription id.
  const { data: rows } = await admin
    .from('trip_subscriptions')
    .select('id, stripe_subscription_id')
    .eq('user_id', userId)
    .in('type', ['pro_monthly', 'pro_yearly'])
    .not('stripe_subscription_id', 'is', null);

  if (rows && rows.length > 0) {
    // stuck-PRO path: refresh the status/period of the rows we already have.
    for (const r of rows) {
      try {
        const sub = await stripe.subscriptions.retrieve(r.stripe_subscription_id as string);
        const iso = unixToIso(getPeriodEndUnix(sub));
        await admin
          .from('trip_subscriptions')
          .update({
            status: sub.status, // verbatim
            cancel_at_period_end: sub.cancel_at_period_end === true,
            ...(iso ? { current_period_end: iso, end_date: iso } : {}),
          })
          .eq('id', r.id);
      } catch (e) {
        console.error('reconcileEntitlement: retrieve failed', r.stripe_subscription_id, (e as Error).message);
      }
    }
  } else if (u?.stripe_customer_id) {
    // stuck-FREE path: no ledger row, but the user has a Stripe customer → a lost
    // activation. Discover their live subscriptions and materialize the row(s) so
    // recompute can restore Pro. (Bounded by the throttle above.)
    try {
      const isTestEnv = isTestStripeKey(key);
      const subs = await stripe.subscriptions.list({
        customer: u.stripe_customer_id as string,
        status: 'all',
        limit: 10,
      });
      // No recurring rows existed (this branch), so any pro sub found here is a
      // genuine recovery of a lost activation webhook — collect for one signal.
      const recovered: string[] = [];
      for (const sub of subs.data) {
        const price = sub.items?.data?.[0]?.price as Stripe.Price | undefined;
        const productId = typeof price?.product === 'string'
          ? price.product
          : ((price?.product as { id?: string } | undefined)?.id ?? null);
        const planType = (productId ? planTypeForProduct(productId, isTestEnv) : null)
          ?? ((sub.metadata?.plan_type as string | undefined) ?? null);
        if (planType !== 'pro_monthly' && planType !== 'pro_yearly') continue; // skip what we can't classify
        const iso = unixToIso(getPeriodEndUnix(sub));
        const startIso = unixToIso(sub.start_date) ?? new Date().toISOString();
        await admin
          .from('trip_subscriptions')
          .upsert({
            user_id: userId,
            type: planType,
            stripe_subscription_id: sub.id,
            status: sub.status, // verbatim
            cancel_at_period_end: sub.cancel_at_period_end === true,
            start_date: startIso,
            ...(iso ? { current_period_end: iso, end_date: iso } : {}),
          }, { onConflict: 'stripe_subscription_id' });
        recovered.push(sub.id);
      }
      // Self-heal succeeded: a webhook was lost and recompute-on-read materialized
      // the missing ledger row(s). Healthy recovery → warning-level (no alert).
      if (recovered.length > 0) {
        await reportPaymentAnomaly('reconcile_recovered_sub', { user_id: userId, sub_ids: recovered }, 'warning');
      }
    } catch (e) {
      console.error('reconcileEntitlement: list-by-customer failed', (e as Error).message);
    }
  }

  // Always recompute — even with no rows, this correctly drops the user to free.
  await admin.rpc('recompute_user_entitlement', { p_user_id: userId });
  return true;
}
