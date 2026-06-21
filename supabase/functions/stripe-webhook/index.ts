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
 *
 * Write integrity: every entitlement-affecting DB write goes through ensureWrite()
 * — on a Postgres error it reports to Sentry AND throws, so the event is NOT
 * recorded and Stripe retries. A swallowed write error here is exactly what hid
 * the 0052 ON CONFLICT bug (user stayed `free` after paying, silently).
 */

import { supabaseAdmin } from '../_shared/supabaseAdmin.ts';
import Stripe from 'npm:stripe@17.0.0';
import { captureEdgeError, reportPaymentAnomaly } from '../_shared/sentry.ts';
import { getPeriodEndUnix, unixToIso } from '../_shared/getPeriodEnd.ts';
import { planTypeForProduct, isTestStripeKey } from '../_shared/stripeCatalog.ts';

// Critical write guard. Supabase query builders are thenable and resolve to
// { data, error }. On error: report to Sentry and THROW, so the outer catch
// returns 500, the event is not recorded, and Stripe retries (handlers are
// upsert-idempotent, so a retry is safe). Use for entitlement-affecting writes
// only — best-effort writes (notifications, customer-id) stay non-fatal.
async function ensureWrite(label: string, op: PromiseLike<{ error: unknown }>) {
  const { error } = await op;
  if (error) {
    const msg = (error as { message?: string }).message ?? String(error);
    await captureEdgeError(new Error(`${label}: ${msg}`), 'stripe-webhook');
    throw new Error(`${label} failed`);
  }
}

// Single writer of the user-level cache. No-op without a user id. A failed RPC
// would leave the cache stale (recompute-on-read heals it later), but that is a
// silent drift — report + throw so Stripe retries and the cache is fixed now.
async function recompute(userId: string | null | undefined) {
  if (!userId) return;
  const { error } = await supabaseAdmin.rpc('recompute_user_entitlement', { p_user_id: userId });
  if (error) {
    await captureEdgeError(new Error(`recompute_user_entitlement failed (user ${userId}): ${error.message}`), 'stripe-webhook');
    throw new Error('recompute_user_entitlement failed');
  }
}

// Persist the Stripe customer id on first sight; never overwrite an existing one.
// Best-effort (not entitlement-critical): a failure must not block the event.
async function saveCustomerId(userId: string | null | undefined, customerId: unknown) {
  if (!userId || typeof customerId !== 'string' || !customerId) return;
  const { error } = await supabaseAdmin
    .from('users')
    .update({ stripe_customer_id: customerId })
    .eq('id', userId)
    .is('stripe_customer_id', null);
  if (error) console.error('saveCustomerId failed (non-fatal):', error.message);
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
    // Money-critical anomaly: a paid subscription event we can't attribute to a
    // user/plan. Non-fatal (caller breaks) → error-level for alert routing.
    await reportPaymentAnomaly('sub_unresolved_user', { ctx, sub_id: subId }, 'error');
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
            // Money-critical: a genuine second payment for an already-Pro trip
            // (no auto-refund — manual in Dashboard). Non-fatal → error-level.
            await reportPaymentAnomaly('pro_trip_double_paid', { trip_id, session_id: session.id, user_id }, 'error');
            break;
          }

          // Per-trip Pro. Anti-dup on the checkout id (uq_trip_subs_checkout).
          await ensureWrite('pro_trip ledger upsert', supabaseAdmin
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
            }, { onConflict: 'stripe_checkout_id', ignoreDuplicates: true }));
          await ensureWrite('pro_trip is_pro_trip set', supabaseAdmin
            .from('trips').update({ is_pro_trip: true }).eq('id', trip_id));
          // CK-6: persist the customer id on the FIRST purchase too (incl. pro_trip),
          // so the next checkout reuses it instead of letting Stripe create a 2nd
          // (guest) customer. Recurring branch already does this below.
          await saveCustomerId(user_id, session.customer);

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
          await ensureWrite('checkout recurring upsert', supabaseAdmin
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
            }, { onConflict: 'stripe_subscription_id' }));
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
        await ensureWrite('invoice.paid upsert', supabaseAdmin
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
          }, { onConflict: 'stripe_subscription_id' }));
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
        await ensureWrite('invoice.payment_failed upsert', supabaseAdmin
          .from('trip_subscriptions')
          .upsert({
            user_id: resolved.userId,
            type: resolved.planType,
            stripe_subscription_id: subId,
            status: 'past_due',
            ...(nextAttemptIso ? { provider_meta: { next_payment_attempt: nextAttemptIso } } : {}),
            ...(existing ? {} : { start_date: new Date().toISOString(), currency: invoice.currency || 'usd' }),
          }, { onConflict: 'stripe_subscription_id' }));
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
        await ensureWrite('invoice.updated upsert', supabaseAdmin
          .from('trip_subscriptions')
          .upsert({
            user_id: resolved.userId,
            type: resolved.planType,
            stripe_subscription_id: subId,
            provider_meta: { next_payment_attempt: nextAttemptIso },
            // Only assume past_due when reconstructing a missing row; never override
            // an existing row's status from this event.
            ...(existing ? {} : { status: 'past_due', start_date: new Date().toISOString(), currency: invoice.currency || 'usd' }),
          }, { onConflict: 'stripe_subscription_id' }));
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
          // Map the live price back to our plan type so a Billing-Portal plan
          // switch (TRIP-53) updates type instead of freezing it. No resolvable
          // product → leave type unchanged.
          const price = sub.items?.data?.[0]?.price as Stripe.Price | undefined;
          const productId = typeof price?.product === 'string'
            ? price.product
            : ((price?.product as { id?: string } | undefined)?.id ?? null);
          const planType = productId
            ? planTypeForProduct(productId, isTestStripeKey(Deno.env.get('STRIPE_SECRET_KEY')!))
            : null;
          await ensureWrite('subscription.updated update', supabaseAdmin
            .from('trip_subscriptions')
            .update({
              status: sub.status, // verbatim — scheduled cancel keeps 'active' + flag below
              cancel_at_period_end: sub.cancel_at_period_end === true,
              ...(planType ? { type: planType } : {}),
              ...(periodEndIso ? { current_period_end: periodEndIso, end_date: periodEndIso } : {}),
            })
            .eq('id', rows[0].id));
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
          await ensureWrite('subscription.deleted update', supabaseAdmin
            .from('trip_subscriptions')
            .update({ status: 'canceled' })
            .eq('id', rows[0].id));
          await recompute(rows[0].user_id);
        }
        break;
      }

      // Refund / chargeback → revoke (T3, CK-1 fix). Two attribution paths:
      //   1) payment_intent match — catches pro_trip (one-time; PI stored on the row).
      //   2) subscription match — recurring rows have a NULL payment_intent, so we
      //      resolve charge → invoice → subscription and match by stripe_subscription_id.
      // A DISPUTE always revokes (status=disputed). A REFUND revokes only when FULL
      // (partial refund leaves Pro). recompute() then derives users.subscription_*
      // (refunded/disputed are not Pro); pro_trip clears is_pro_trip directly.
      case 'charge.refunded':
      case 'charge.dispute.created': {
        const isDispute = event.type === 'charge.dispute.created';
        const newStatus = isDispute ? 'disputed' : 'refunded';

        // Resolve the underlying charge + payment_intent. For charge.refunded the
        // event object IS the charge; for charge.dispute.created it's a Dispute that
        // references a charge.
        let charge: Stripe.Charge | null = null;
        let paymentIntentId: string | null = null;
        if (isDispute) {
          const dispute = event.data.object as Stripe.Dispute;
          paymentIntentId = typeof dispute.payment_intent === 'string' ? dispute.payment_intent : null;
          const chargeId = typeof dispute.charge === 'string' ? dispute.charge : null;
          if (chargeId) {
            try { charge = await stripe.charges.retrieve(chargeId); }
            catch (e) { console.error('dispute charge lookup failed:', (e as Error).message); }
          }
        } else {
          charge = event.data.object as Stripe.Charge;
          paymentIntentId = typeof charge.payment_intent === 'string' ? charge.payment_intent : null;
        }

        // Partial refund must NOT revoke Pro (only a full refund does). Disputes always revoke.
        if (!isDispute) {
          const fullyRefunded = charge?.refunded === true
            || (typeof charge?.amount === 'number' && typeof charge?.amount_refunded === 'number'
                && charge.amount > 0 && charge.amount_refunded >= charge.amount);
          if (!fullyRefunded) {
            console.log('Partial refund — Pro not revoked (pi', paymentIntentId, ')');
            break;
          }
        }

        // Path 1: direct payment_intent match (pro_trip).
        let row: { id: string; user_id: string; trip_id: string | null; type: string } | null = null;
        if (paymentIntentId) {
          const { data, error } = await supabaseAdmin
            .from('trip_subscriptions')
            .select('id, user_id, trip_id, type')
            .eq('stripe_payment_intent_id', paymentIntentId)
            .limit(1);
          if (error) {
            await captureEdgeError(new Error(`refund PI lookup failed: ${error.message}`), 'stripe-webhook');
            throw new Error('refund PI lookup failed');
          }
          row = data && data.length > 0 ? data[0] : null;
        }

        // Path 2: subscription refund/dispute — resolve charge → invoice → subscription.
        if (!row && charge && typeof charge.invoice === 'string' && charge.invoice) {
          let subId: string | null = null;
          try {
            const invoice = await stripe.invoices.retrieve(charge.invoice);
            subId = invoiceSubId(invoice);
          } catch (e) {
            console.error('refund invoice lookup failed:', (e as Error).message);
          }
          if (subId) {
            const { data, error } = await supabaseAdmin
              .from('trip_subscriptions')
              .select('id, user_id, trip_id, type')
              .eq('stripe_subscription_id', subId)
              .limit(1);
            if (error) {
              await captureEdgeError(new Error(`refund sub lookup failed: ${error.message}`), 'stripe-webhook');
              throw new Error('refund sub lookup failed');
            }
            row = data && data.length > 0 ? data[0] : null;
          }
        }

        if (!row) {
          // Refund/dispute we can't attribute to any ledger row — money-critical
          // anomaly worth a look (T5 #6). Non-fatal: nothing to revoke here.
          await reportPaymentAnomaly('refund_no_ledger', { event_type: event.type, payment_intent: paymentIntentId }, 'error');
          break;
        }

        await ensureWrite('refund/dispute status update', supabaseAdmin
          .from('trip_subscriptions')
          .update({ status: newStatus })
          .eq('id', row.id));
        if (row.type === 'pro_trip' && row.trip_id) {
          await ensureWrite('refund is_pro_trip clear', supabaseAdmin
            .from('trips').update({ is_pro_trip: false }).eq('id', row.trip_id));
          console.log('Pro-trip revoked after', event.type, '->', row.trip_id);
        } else {
          await recompute(row.user_id);
          console.log('Subscription revoked after', event.type, 'for user', row.user_id);
        }
        break;
      }

      default: {
        // Event type outside our subscribed set (endpoint subscribes to 8). Not an
        // error — info-level only, no alert. Surfaces drift in the Stripe endpoint
        // config (a type we now receive but don't handle). Still recorded below.
        await reportPaymentAnomaly('unsupported_event', { event_type: event.type, event_id: event.id }, 'info');
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
