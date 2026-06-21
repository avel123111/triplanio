/**
 * reconcileEntitlement — lazy "recompute-on-read" reconcile (Ф3).
 *
 * recompute_user_entitlement() is cheap (DB-only). This is the EXPENSIVE path:
 * it pulls the user's recurring subscription(s) live from Stripe, refreshes the
 * ledger row (status / current_period_end / cancel_at_period_end), then calls
 * recompute. It exists to self-heal a lost webhook the moment the user opens a
 * screen — WITHOUT hammering Stripe on every read.
 *
 * Guarding is the CALLER's job: only invoke when the cache says `pro` but looks
 * stale (end_date past/missing). Here we additionally throttle per-user via
 * users.entitlement_synced_at so at most one Stripe round-trip per THROTTLE_MIN.
 */

import Stripe from 'npm:stripe@17.0.0';
import type { SupabaseClient } from 'npm:@supabase/supabase-js@2';
import { getPeriodEndUnix, unixToIso } from './getPeriodEnd.ts';

const THROTTLE_MIN = 10;

/**
 * Returns true if a reconcile actually ran (i.e. the throttle allowed it), so the
 * caller knows to re-read users.* afterwards. Best-effort: any Stripe failure is
 * swallowed (the cache stays as-is; the next window retries).
 */
export async function reconcileEntitlement(admin: SupabaseClient, userId: string): Promise<boolean> {
  if (!userId) return false;

  // ---- Throttle: at most one external reconcile per window per user ----
  const { data: u } = await admin
    .from('users')
    .select('entitlement_synced_at')
    .eq('id', userId)
    .single();
  const last = u?.entitlement_synced_at ? new Date(u.entitlement_synced_at).getTime() : 0;
  if (Number.isFinite(last) && Date.now() - last < THROTTLE_MIN * 60 * 1000) return false;

  const key = Deno.env.get('STRIPE_SECRET_KEY');
  if (!key) return false;

  // Mark synced up-front so a slow/failing Stripe call still throttles the next read.
  await admin.from('users').update({ entitlement_synced_at: new Date().toISOString() }).eq('id', userId);

  // Recurring rows that carry a Stripe subscription id.
  const { data: rows } = await admin
    .from('trip_subscriptions')
    .select('id, stripe_subscription_id')
    .eq('user_id', userId)
    .in('type', ['pro_monthly', 'pro_yearly'])
    .not('stripe_subscription_id', 'is', null);

  if (rows && rows.length > 0) {
    const stripe = new Stripe(key);
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
  }

  // Always recompute — even with no rows, this correctly drops the user to free.
  await admin.rpc('recompute_user_entitlement', { p_user_id: userId });
  return true;
}
