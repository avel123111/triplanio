/**
 * stripe-webhook
 *
 * Handles Stripe events: checkout.session.completed,
 * customer.subscription.updated, customer.subscription.deleted.
 *
 * Security:
 * - Dual-env signature verification: tries live secret first, falls back to test.
 * - Idempotency: records processed events in stripe_events table.
 *
 * Migrated from base44: replaced all base44 SDK entity calls with Supabase queries.
 * No JWT required (Stripe sends its own signature).
 */

import { supabaseAdmin } from '../_shared/supabaseAdmin.ts';
import Stripe from 'npm:stripe@17.0.0';

Deno.serve(async (req) => {
  try {
    const body = await req.text();
    const signature = req.headers.get('stripe-signature');

    // ---------- Dual-env signature verification ----------
    // Accepts events from BOTH live and test Stripe endpoints via a single URL.
    // Try live first; on failure fall back to test.
    const liveSecret = Deno.env.get('STRIPE_WEBHOOK_SECRET');
    const testSecret = Deno.env.get('STRIPE_TEST_WEBHOOK_SECRET');

    // Use placeholder key just for signature verification (no API calls needed here)
    const verifier = new Stripe(liveSecret || testSecret || 'sk_placeholder');

    let event: Stripe.Event;
    let isTestEvent = false;
    try {
      event = await verifier.webhooks.constructEventAsync(body, signature!, liveSecret!);
    } catch {
      try {
        event = await verifier.webhooks.constructEventAsync(body, signature!, testSecret!);
        isTestEvent = true;
      } catch (testErr) {
        console.error('Webhook signature verification failed:', (testErr as Error).message);
        return Response.json({ error: 'Invalid signature' }, { status: 400 });
      }
    }

    // Re-init Stripe with the correct API key for this event's mode
    const stripe = new Stripe(
      isTestEvent
        ? Deno.env.get('STRIPE_TEST_SECRET_KEY')!
        : Deno.env.get('STRIPE_SECRET_KEY')!
    );

    console.log('Stripe webhook received:', event.type, event.id, 'mode:', isTestEvent ? 'TEST' : 'LIVE');

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
      // Non-fatal: better to risk a duplicate than drop the event
      console.error('Idempotency lookup failed (continuing):', (e as Error).message);
    }

    switch (event.type) {

      case 'checkout.session.completed': {
        const session = event.data.object as Stripe.Checkout.Session;
        const { user_id, trip_id, plan_type } = session.metadata || {};

        console.log('Checkout completed for:', user_id, plan_type, 'trip:', trip_id);

        // Second idempotency layer: never create two TripSubscription rows
        // for the same checkout session
        const { data: existingSub } = await supabaseAdmin
          .from('trip_subscriptions')
          .select('id')
          .eq('stripe_checkout_id', session.id)
          .limit(1);

        if (existingSub && existingSub.length > 0) {
          console.log('TripSubscription already exists for session, skipping:', session.id);
        } else if (plan_type === 'pro_trip' && trip_id) {

          // Mark trip as Pro
          const { data: trip } = await supabaseAdmin
            .from('trips')
            .select('id')
            .eq('id', trip_id)
            .single();

          if (trip) {
            await supabaseAdmin
              .from('trips')
              .update({ is_pro_trip: true })
              .eq('id', trip_id);
            console.log('Trip marked as Pro:', trip_id);
          }

          await supabaseAdmin.from('trip_subscriptions').insert({
            user_id,
            trip_id: trip_id || null,
            type: 'pro_trip',
            stripe_checkout_id: session.id,
            stripe_payment_intent_id: session.payment_intent || null,
            status: 'active',
            start_date: new Date().toISOString(),
            amount_paid: session.amount_total,
            currency: session.currency || 'usd',
          });

        } else if (plan_type === 'pro_monthly' || plan_type === 'pro_yearly') {

          // Grant Pro access to user
          const { data: userData } = await supabaseAdmin
            .from('users')
            .select('id')
            .eq('id', user_id)
            .single();

          if (userData) {
            const endDate = plan_type === 'pro_monthly'
              ? new Date(Date.now() + 30 * 24 * 60 * 60 * 1000)
              : new Date(Date.now() + 365 * 24 * 60 * 60 * 1000);

            await supabaseAdmin
              .from('users')
              .update({
                subscription_status: 'pro',
                subscription_end_date: endDate.toISOString(),
              })
              .eq('id', userData.id);
            console.log('User upgraded to Pro:', user_id);
          }

          await supabaseAdmin.from('trip_subscriptions').insert({
            user_id,
            type: plan_type,
            stripe_subscription_id: session.subscription || null,
            stripe_checkout_id: session.id,
            stripe_payment_intent_id: session.payment_intent || null,
            status: 'active',
            start_date: new Date().toISOString(),
            end_date: plan_type === 'pro_monthly'
              ? new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString()
              : new Date(Date.now() + 365 * 24 * 60 * 60 * 1000).toISOString(),
            amount_paid: session.amount_total,
            currency: session.currency || 'usd',
          });

          // In-app notification confirming Pro activation
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
              console.error('Failed to create Pro-activated notification (non-fatal):', (e as Error).message);
            }
          }
        }
        break;
      }

      case 'customer.subscription.updated': {
        const subscription = event.data.object as Stripe.Subscription;

        const { data: subRows } = await supabaseAdmin
          .from('trip_subscriptions')
          .select('id, user_id')
          .eq('stripe_subscription_id', subscription.id)
          .limit(1);

        if (subRows && subRows.length > 0) {
          const record = subRows[0];
          const { user_id } = record;

          const { data: userData } = await supabaseAdmin
            .from('users')
            .select('id')
            .eq('id', user_id)
            .single();

          // Stripe API 2025-03+ moved current_period_end to subscription items
          const periodEndUnix: number | null =
            (subscription as unknown as Record<string, number>)['current_period_end'] ??
            (subscription.items?.data?.[0] as unknown as Record<string, number>)?.['current_period_end'] ??
            null;
          const cancelAtUnix: number | null =
            (subscription as unknown as Record<string, number | null>)['cancel_at'] ?? null;

          const toIso = (unix: number | null) => {
            if (!unix || typeof unix !== 'number') return null;
            const d = new Date(unix * 1000);
            return isNaN(d.getTime()) ? null : d.toISOString();
          };
          const periodEndIso = toIso(periodEndUnix);
          const cancelAtIso = toIso(cancelAtUnix);

          if (subscription.cancel_at_period_end === true && subscription.status === 'active') {
            // Scheduled cancellation — keep Pro until period end
            const endIso = cancelAtIso || periodEndIso;
            if (userData && endIso) {
              await supabaseAdmin
                .from('users')
                .update({ subscription_status: 'pro', subscription_end_date: endIso })
                .eq('id', userData.id);
            }
            await supabaseAdmin
              .from('trip_subscriptions')
              .update({ status: 'cancelled', ...(endIso ? { end_date: endIso } : {}) })
              .eq('id', record.id);

          } else if (subscription.status === 'active' || subscription.status === 'trialing') {
            if (userData && periodEndIso) {
              await supabaseAdmin
                .from('users')
                .update({ subscription_status: 'pro', subscription_end_date: periodEndIso })
                .eq('id', userData.id);
            }
            await supabaseAdmin
              .from('trip_subscriptions')
              .update({ status: 'active', ...(periodEndIso ? { end_date: periodEndIso } : {}) })
              .eq('id', record.id);

          } else if (subscription.status === 'canceled' || subscription.status === 'unpaid') {
            if (userData) {
              await supabaseAdmin
                .from('users')
                .update({ subscription_status: 'free' })
                .eq('id', userData.id);
            }
            await supabaseAdmin
              .from('trip_subscriptions')
              .update({ status: subscription.status === 'canceled' ? 'cancelled' : 'expired' })
              .eq('id', record.id);
          }
        }
        break;
      }

      case 'customer.subscription.deleted': {
        const subscription = event.data.object as Stripe.Subscription;

        const { data: subRows } = await supabaseAdmin
          .from('trip_subscriptions')
          .select('id, user_id')
          .eq('stripe_subscription_id', subscription.id)
          .limit(1);

        if (subRows && subRows.length > 0) {
          const { id, user_id } = subRows[0];
          const { data: userData } = await supabaseAdmin
            .from('users')
            .select('id')
            .eq('id', user_id)
            .single();

          if (userData) {
            await supabaseAdmin
              .from('users')
              .update({ subscription_status: 'free' })
              .eq('id', userData.id);
          }
          await supabaseAdmin
            .from('trip_subscriptions')
            .update({ status: 'cancelled' })
            .eq('id', id);
        }
        break;
      }
    }

    // Record event AFTER successful processing — on error Stripe will retry
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
    console.error('Webhook error:', error);
    return Response.json(
      { error: error instanceof Error ? error.message : 'Internal error' },
      { status: 500 },
    );
  }
});
