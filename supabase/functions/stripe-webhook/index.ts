/**
 * stripe-webhook
 *
 * Single-writer entitlement (Ф2): each event writes the trip_subscriptions ledger,
 * then recompute_user_entitlement() derives users.subscription_*. NO direct writes
 * to users.* here — this kills the old double-write/drift. pro_trip stays per-trip
 * via trips.is_pro_trip.
 *
 * Security:
 * - Signature verified with this project's STRIPE_WEBHOOK_SECRET (one Stripe mode
 *   per Supabase project: live in prod, test in dev).
 * - Idempotency: processed events recorded in stripe_events; duplicates skipped.
 * - No JWT (Stripe sends its own signature). verify_jwt MUST stay false (canon-10).
 *
 * Status model: Stripe subscription status stored verbatim
 * (active/trialing/past_due/canceled/unpaid/…); scheduled cancellation = status
 * stays 'active' + cancel_at_period_end=true. recompute treats active/trialing/
 * past_due as Pro. pro_trip / charge-derived rows use active/refunded/disputed.
 */

import { supabaseAdmin } from '../_shared/supabaseAdmin.ts';
import Stripe from 'npm:stripe@17.0.0';
import { captureEdgeError } from '../_shared/sentry.ts';
import { getPeriodEndUnix, unixToIso } from '../_shared/getPeriodEnd.ts';

// Single writer of the user-level cache. No-op without a user id.
async function recompute(userId: string | null | undefined) {
  if (!userId) return;
  const { error } = await supabaseAdmin.rpc('recompute_user_entitlement', { p_user_id: userId });
  if (error) console.error('recompute_user_entitlement failed:', error.message, 'user', userId);
}

Deno.serve(async (req) => {
  try {
    const body = await req.text();
    const signature = req.headers.get('stripe-signature');

    // ---------- Signature verification ----------
    const webhookSecret = Deno.env.get('STRIPE_WEBHOOK_SECRET')!;
    const stripe = new Stripe(Deno.env.get('STRIPE_SECRET_KEY')!);

    let event: Stripe.Event;
    try {
      event = await stripe.webhooks.constructEventAsync(body, signature!, webhookSecret);
    } catch (err) {
      console.error('Webhook signature verification failed:', (err as Error).message);
      return Response.json({ error: 'Invalid signature' }, { status: 400 });
    }

    console.log('Stripe webhook received:', event.type, event.id);

    // ---------- Idempotency: skip already-processed events ----------
    try {
      const { data: existing } = await supabaseAdmin
        .from('stripe_events')
        .select('id')
        .eq('event_id', event.id)
        .limit(1);
      if (existing && existing.length > 0) {
        console.log('Duplicate event skipped:', event.id);
        return Response.json({ received: true, duplicate: true });
      }
    } catch (e) {
      // Non-fatal: better to risk a duplicate (handlers are idempotent) than drop the event
      console.error('Idempotency lookup failed (continuing):', (e as Error).message);
    }

    switch (event.type) {

      case 'checkout.session.completed': {
        const session = event.data.object as Stripe.Checkout.Session;
        const { user_id, trip_id, plan_type } = session.metadata || {};
        console.log('Checkout completed for:', user_id, plan_type, 'trip:', trip_id);

        if (plan_type === 'pro_trip' && trip_id) {
          // Per-trip Pro. Anti-dup on the checkout id (uq_trip_subs_checkout).
          const { error: insErr } = await supabaseAdmin
            .from('trip_subscriptions')
            .upsert({
              user_id,
              trip_id,
              type: 'pro_trip',
              stripe_checkout_id: session.id,
              stripe_payment_intent_id: session.payment_intent || null,
              status: 'active',
              start_date: new Date().toISOString(),
              amount_paid: session.amount_total,
              currency: session.currency || 'usd',
            }, { onConflict: 'stripe_checkout_id', ignoreDuplicates: true });
          if (insErr) console.error('pro_trip ledger upsert failed:', insErr.message);
          await supabaseAdmin.from('trips').update({ is_pro_trip: true }).eq('id', trip_id);

        } else if (plan_type === 'pro_monthly' || plan_type === 'pro_yearly') {
          // Recurring: pull the live subscription for real status / period / cancel flag.
          const subId = typeof session.subscription === 'string' ? session.subscription : null;
          let status = 'active';
          let periodEndIso: string | null = null;
          let cancelAtPeriodEnd = false;
          if (subId) {
            const sub = await stripe.subscriptions.retrieve(subId);
            status = sub.status;
            periodEndIso = unixToIso(getPeriodEndUnix(sub));
            cancelAtPeriodEnd = sub.cancel_at_period_end === true;
          }
          await supabaseAdmin
            .from('trip_subscriptions')
            .upsert({
              user_id,
              type: plan_type,
              stripe_subscription_id: subId,
              stripe_checkout_id: session.id,
              stripe_payment_intent_id: session.payment_intent || null,
              status,
              start_date: new Date().toISOString(),
              current_period_end: periodEndIso,
              end_date: periodEndIso, // legacy mirror for existing readers
              cancel_at_period_end: cancelAtPeriodEnd,
              amount_paid: session.amount_total,
              currency: session.currency || 'usd',
            }, { onConflict: 'stripe_subscription_id' });
          await recompute(user_id);

          // In-app confirmation (replay-safe: duplicate events are skipped above).
          if (user_id) {
            try {
              await supabaseAdmin.from('notifications').insert({
                user_id,
                type: 'system',
                i18n_title_key: 'notif.tpl_pro_activated_title',
                i18n_message_key: 'notif.tpl_pro_activated_msg',
                i18n_params: {},
                title: 'Pro subscription activated',
                message: 'Your payment was successful. Thank you!',
                action_url: '/settings',
                read: false,
              });
            } catch (e) {
              console.error('Pro-activated notification failed (non-fatal):', (e as Error).message);
            }
          }
        }
        break;
      }

      case 'customer.subscription.updated': {
        const sub = event.data.object as Stripe.Subscription;
        const { data: rows } = await supabaseAdmin
          .from('trip_subscriptions')
          .select('id, user_id')
          .eq('stripe_subscription_id', sub.id)
          .limit(1);
        if (rows && rows.length > 0) {
          const periodEndIso = unixToIso(getPeriodEndUnix(sub));
          await supabaseAdmin
            .from('trip_subscriptions')
            .update({
              status: sub.status, // verbatim — scheduled cancel keeps 'active' + flag below
              cancel_at_period_end: sub.cancel_at_period_end === true,
              ...(periodEndIso ? { current_period_end: periodEndIso, end_date: periodEndIso } : {}),
            })
            .eq('id', rows[0].id);
          await recompute(rows[0].user_id);
        }
        break;
      }

      case 'customer.subscription.deleted': {
        const sub = event.data.object as Stripe.Subscription;
        const { data: rows } = await supabaseAdmin
          .from('trip_subscriptions')
          .select('id, user_id')
          .eq('stripe_subscription_id', sub.id)
          .limit(1);
        if (rows && rows.length > 0) {
          await supabaseAdmin
            .from('trip_subscriptions')
            .update({ status: 'canceled' })
            .eq('id', rows[0].id);
          await recompute(rows[0].user_id);
        }
        break;
      }

      // Refund / chargeback → revoke. pro_trip flips is_pro_trip off; recurring → recompute.
      case 'charge.refunded':
      case 'charge.dispute.created': {
        const obj = event.data.object as { payment_intent?: string | null };
        const paymentIntentId = typeof obj.payment_intent === 'string' ? obj.payment_intent : null;
        if (!paymentIntentId) break;
        const newStatus = event.type === 'charge.dispute.created' ? 'disputed' : 'refunded';

        const { data: rows } = await supabaseAdmin
          .from('trip_subscriptions')
          .select('id, user_id, trip_id, type')
          .eq('stripe_payment_intent_id', paymentIntentId)
          .limit(1);
        if (rows && rows.length > 0) {
          const row = rows[0];
          await supabaseAdmin
            .from('trip_subscriptions')
            .update({ status: newStatus })
            .eq('id', row.id);
          if (row.type === 'pro_trip' && row.trip_id) {
            await supabaseAdmin.from('trips').update({ is_pro_trip: false }).eq('id', row.trip_id);
            console.log('Pro-trip revoked after', event.type, '->', row.trip_id);
          } else {
            await recompute(row.user_id);
            console.log('Subscription revoked after', event.type, 'for user', row.user_id);
          }
        }
        break;
      }
    }

    // Record event AFTER successful processing — on error Stripe retries (no record yet).
    try {
      await supabaseAdmin.from('stripe_events').insert({
        event_id: event.id,
        type: event.type,
        processed_at: new Date().toISOString(),
      });
    } catch (e) {
      console.error('Failed to record StripeEvent (non-fatal):', (e as Error).message);
    }

    return Response.json({ received: true });

  } catch (error) {
    await captureEdgeError(error, 'stripe-webhook');
    console.error('Webhook error:', error);
    return Response.json(
      { error: error instanceof Error ? error.message : 'Internal error' },
      { status: 500 },
    );
  }
});
