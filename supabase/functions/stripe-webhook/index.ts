/**
 * stripe-webhook
 *
 * Single-writer entitlement (Ф2/Ф3): each event writes the trip_subscriptions
 * ledger, then recompute_user_entitlement() derives users.subscription_*. NO
 * direct writes to users.subscription_* here — this kills the old double-write/
 * drift. pro_trip stays per-trip via trips.is_pro_trip.
 *
 * Lifecycle (Ф3): renewal (invoice.paid), dunning (invoice.payment_failed), and
 * grace-date refresh (invoice.updated → next_payment_attempt under Stripe
 * automations) are handled here. stripe_customer_id is captured lazily.
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

// Persist the Stripe customer id on first sight; never overwrite an existing one.
async function saveCustomerId(userId: string | null | undefined, customerId: unknown) {
  if (!userId || typeof customerId !== 'string' || !customerId) return;
  await supabaseAdmin
    .from('users')
    .update({ stripe_customer_id: customerId })
    .eq('id', userId)
    .is('stripe_customer_id', null);
}

// Version-tolerant: invoice.subscription moved under parent.subscription_details
// on newer (Basil) API versions. Read both shapes so invoice.* never silently
// no-ops if the account is on a newer apiVersion.
function invoiceSubId(invoice: Stripe.Invoice): string | null {
  const top = (invoice as unknown as { subscription?: unknown }).subscription;
  if (typeof top === 'string') return top;
  const nested = (invoice as unknown as { parent?: { subscription_details?: { subscription?: unknown } } })
    .parent?.subscription_details?.subscription;
  return typeof nested === 'string' ? nested : null;
}

// Find an existing recurring ledger row by Stripe subscription id.
async function findSubRow(subId: string) {
  const { data } = await supabaseAdmin
    .from('trip_subscriptions')
    .select('id, user_id, type')
    .eq('stripe_subscription_id', subId)
    .limit(1);
  return data && data.length > 0 ? data[0] : null;
}

// Resolve { userId, planType } for an invoice's subscription: prefer the existing
// ledger row, else the subscription metadata set at checkout (subscription_data.
// metadata). Reports to Sentry and returns null when neither yields a recurring
// user/plan (an anomaly worth a human look).
async function resolveRecurringUser(
  stripe: Stripe,
  subId: string,
  existing: { user_id?: string; type?: string } | null,
  ctx: string,
): Promise<{ userId: string; planType: 'pro_monthly' | 'pro_yearly' } | null> {
  let userId = existing?.user_id ?? null;
  let planType = existing?.type ?? null;
  if (!userId || !planType) {
    const sub = await stripe.subscriptions.retrieve(subId);
    userId = userId ?? ((sub.metadata?.user_id as string) || null);
    planType = planType ?? ((sub.metadata?.plan_type as string) || null);
  }
  if (!userId || (planType !== 'pro_monthly' && planType !== 'pro_yearly')) {
    await captureEdgeError(
      new Error(`${ctx}: subscription ${subId} has no resolvable user_id/plan_type`),
      'stripe-webhook',
    );
    return null;
  }
  return { userId, planType };
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
      await captureEdgeError(err, 'stripe-webhook:signature');
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
          // Anti-double-pay (TRIP-82): a DIFFERENT checkout session already turned
          // this trip Pro (e.g. two tabs both paid). Same-session redelivery can't
          // reach here (duplicate event_id is skipped above), so is_pro_trip=true
          // means a genuine second payment. Don't insert a 2nd ledger row / double-
          // count — flag it for a human (manual refund in Dashboard; no auto-refund).
          const { data: tripRow } = await supabaseAdmin
            .from('trips').select('is_pro_trip').eq('id', trip_id).single();
          if (tripRow?.is_pro_trip) {
            await captureEdgeError(
              new Error(`pro_trip_double_paid: trip ${trip_id} already Pro; duplicate session ${session.id} user ${user_id}`),
              'stripe-webhook',
            );
            break;
          }

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
          await saveCustomerId(user_id, session.customer);
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

      // ---- Renewal: a subscription invoice was paid → extend the period ----
      case 'invoice.paid': {
        const invoice = event.data.object as Stripe.Invoice;
        const subId = invoiceSubId(invoice);
        if (!subId) break;
        const existing = await findSubRow(subId);
        const resolved = await resolveRecurringUser(stripe, subId, existing, 'invoice.paid');
        if (!resolved) break;
        await saveCustomerId(resolved.userId, invoice.customer);
        const sub = await stripe.subscriptions.retrieve(subId);
        const periodEndIso = unixToIso(getPeriodEndUnix(sub));
        await supabaseAdmin
          .from('trip_subscriptions')
          .upsert({
            user_id: resolved.userId,
            type: resolved.planType,
            stripe_subscription_id: subId,
            status: sub.status,               // 'active' on a healthy renewal (verbatim)
            cancel_at_period_end: sub.cancel_at_period_end === true,
            provider_meta: null,              // clear any stale past_due grace marker
            ...(periodEndIso ? { current_period_end: periodEndIso, end_date: periodEndIso } : {}),
            ...(existing ? {} : { start_date: new Date().toISOString(), currency: invoice.currency || 'usd' }),
          }, { onConflict: 'stripe_subscription_id' });
        await recompute(resolved.userId);
        break;
      }

      // ---- Dunning: a subscription invoice failed → enter past_due grace ----
      case 'invoice.payment_failed': {
        const invoice = event.data.object as Stripe.Invoice;
        const subId = invoiceSubId(invoice);
        if (!subId) break;
        const existing = await findSubRow(subId);
        const resolved = await resolveRecurringUser(stripe, subId, existing, 'invoice.payment_failed');
        if (!resolved) break;
        await saveCustomerId(resolved.userId, invoice.customer);
        // Under automations next_payment_attempt is usually null here (it rides
        // invoice.updated); recompute falls back to a short buffer until then.
        const nextAttemptIso = invoice.next_payment_attempt ? unixToIso(invoice.next_payment_attempt) : null;
        await supabaseAdmin
          .from('trip_subscriptions')
          .upsert({
            user_id: resolved.userId,
            type: resolved.planType,
            stripe_subscription_id: subId,
            status: 'past_due',
            ...(nextAttemptIso ? { provider_meta: { next_payment_attempt: nextAttemptIso } } : {}),
            ...(existing ? {} : { start_date: new Date().toISOString(), currency: invoice.currency || 'usd' }),
          }, { onConflict: 'stripe_subscription_id' });
        await recompute(resolved.userId);

        // Dunning notification — ask the user to update their card. Replay-safe.
        try {
          await supabaseAdmin.from('notifications').insert({
            user_id: resolved.userId,
            type: 'system',
            i18n_title_key: 'notif.tpl_pro_payment_failed_title',
            i18n_message_key: 'notif.tpl_pro_payment_failed_msg',
            i18n_params: {},
            title: 'Pro payment failed',
            message: 'We couldn\'t charge your subscription. Update your payment method to keep Pro.',
            action_url: '/settings',
            read: false,
          });
        } catch (e) {
          console.error('dunning notification failed (non-fatal):', (e as Error).message);
        }
        break;
      }

      // ---- Grace-date refresh: under Stripe automations the scheduled retry time
      // (next_payment_attempt) arrives on invoice.updated, NOT payment_failed.
      // Chatty event → act ONLY when it carries a next attempt. Status is owned by
      // subscription.* / invoice.paid|failed; here we only move the grace date.
      case 'invoice.updated': {
        const invoice = event.data.object as Stripe.Invoice;
        const subId = invoiceSubId(invoice);
        if (!subId) break;
        const nextAttemptIso = invoice.next_payment_attempt ? unixToIso(invoice.next_payment_attempt) : null;
        if (!nextAttemptIso) break; // healthy/active invoices have no scheduled retry
        const existing = await findSubRow(subId);
        const resolved = await resolveRecurringUser(stripe, subId, existing, 'invoice.updated');
        if (!resolved) break;
        await saveCustomerId(resolved.userId, invoice.customer);
        await supabaseAdmin
          .from('trip_subscriptions')
          .upsert({
            user_id: resolved.userId,
            type: resolved.planType,
            stripe_subscription_id: subId,
            provider_meta: { next_payment_attempt: nextAttemptIso },
            // Only assume past_due when reconstructing a missing row; never override
            // an existing row's status from this event.
            ...(existing ? {} : { status: 'past_due', start_date: new Date().toISOString(), currency: invoice.currency || 'usd' }),
          }, { onConflict: 'stripe_subscription_id' });
        await recompute(resolved.userId);
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
