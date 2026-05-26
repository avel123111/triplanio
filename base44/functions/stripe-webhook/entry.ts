import { createClientFromRequest } from 'npm:@base44/sdk@0.8.25';
import Stripe from 'npm:stripe@17.0.0';

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const sr = base44.asServiceRole;

    const body = await req.text();
    const signature = req.headers.get('stripe-signature');

    // ---------- Dual-env signature verification ----------
    // We expose a single webhook URL but accept events from BOTH the live
    // Stripe endpoint and the test endpoint. Try live first; if the signature
    // doesn't match, fall back to test. After verification, `event.livemode`
    // tells us which Stripe key to use for any follow-up API calls.
    const liveSecret = Deno.env.get('STRIPE_WEBHOOK_SECRET');
    const testSecret = Deno.env.get('STRIPE_TEST_WEBHOOK_SECRET');

    // Use a no-key Stripe instance just to verify signatures (constructEventAsync
    // doesn't need a real API key). For follow-up API calls below we re-init
    // with the correct mode key.
    const verifier = new Stripe(liveSecret || testSecret || 'sk_placeholder');

    let event;
    let isTestEvent = false;
    try {
      event = await verifier.webhooks.constructEventAsync(body, signature, liveSecret);
    } catch (liveErr) {
      try {
        event = await verifier.webhooks.constructEventAsync(body, signature, testSecret);
        isTestEvent = true;
      } catch (testErr) {
        console.error('Webhook signature verification failed (both live and test):', liveErr.message, '|', testErr.message);
        return Response.json({ error: 'Invalid signature' }, { status: 400 });
      }
    }

    // Re-init Stripe client with the correct API key for this event's mode.
    const stripe = new Stripe(
      isTestEvent
        ? Deno.env.get('STRIPE_TEST_SECRET_KEY')
        : Deno.env.get('STRIPE_SECRET_KEY')
    );

    console.log('Stripe webhook received:', event.type, event.id, 'mode:', isTestEvent ? 'TEST' : 'LIVE');

    // ---------- IDEMPOTENCY: skip already-processed events ----------
    // Stripe retries failed deliveries — without this check, the same checkout
    // could create multiple TripSubscription rows and grant duplicate Pro days.
    try {
      const existing = await sr.entities.StripeEvent.filter({ event_id: event.id });
      if (existing.length > 0) {
        console.log('Duplicate event skipped:', event.id);
        return Response.json({ received: true, duplicate: true });
      }
    } catch (e) {
      // If the lookup itself fails (e.g. entity not yet created), log and continue.
      // Better to process and risk a duplicate than to drop the event.
      console.error('Idempotency lookup failed (continuing):', e.message);
    }

    switch (event.type) {
      case 'checkout.session.completed': {
        const session = event.data.object;
        const { user_email, trip_id, plan_type } = session.metadata || {};

        console.log('Checkout completed for:', user_email, plan_type, 'trip:', trip_id);

        // Second idempotency layer: even if the StripeEvent log is wiped, never
        // create two TripSubscription rows for the same checkout session.
        const existingSub = await sr.entities.TripSubscription.filter({ stripe_checkout_id: session.id });
        if (existingSub.length > 0) {
          console.log('TripSubscription already exists for session, skipping:', session.id);
        } else if (plan_type === 'pro_trip' && trip_id) {
          const trips = await sr.entities.Trip.filter({ id: trip_id });
          if (trips.length > 0) {
            await sr.entities.Trip.update(trip_id, { is_pro_trip: true });
            console.log('Trip marked as Pro:', trip_id);
          }

          await sr.entities.TripSubscription.create({
            user_email,
            trip_id,
            type: 'pro_trip',
            stripe_checkout_id: session.id,
            stripe_payment_intent_id: session.payment_intent || null,
            status: 'active',
            start_date: new Date().toISOString(),
            amount_paid: session.amount_total,
            currency: session.currency || 'usd'
          });
        } else if (plan_type === 'pro_monthly' || plan_type === 'pro_yearly') {
          const users = await sr.entities.User.filter({ email: user_email });
          if (users.length > 0) {
            const endDate = plan_type === 'pro_monthly'
              ? new Date(Date.now() + 30 * 24 * 60 * 60 * 1000)
              : new Date(Date.now() + 365 * 24 * 60 * 60 * 1000);

            await sr.entities.User.update(users[0].id, {
              subscription_status: 'pro',
              subscription_end_date: endDate.toISOString()
            });
            console.log('User upgraded to Pro:', user_email);
          }

          await sr.entities.TripSubscription.create({
            user_email,
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
            currency: session.currency || 'usd'
          });
        }

        // In-app notification confirming the successful payment. We use the
        // i18n keys defined under `notif.tpl_pro_activated_*` so the bell
        // renders the message in the user's current interface language at
        // view time. Skipped for Pro-trip one-off purchases where the user
        // already gets the in-app "Welcome to Pro" dialog.
        if (user_email && (plan_type === 'pro_monthly' || plan_type === 'pro_yearly')) {
          try {
            await sr.entities.Notification.create({
              user_email,
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
            console.error('Failed to create Pro-activated notification (non-fatal):', e.message);
          }
        }
        break;
      }

      case 'customer.subscription.updated': {
        const subscription = event.data.object;
        const subRecord = await sr.entities.TripSubscription.filter({
          stripe_subscription_id: subscription.id
        });

        if (subRecord.length > 0) {
          const record = subRecord[0];
          const { user_email } = record;
          const users = await sr.entities.User.filter({ email: user_email });

          // Stripe API 2025-03+ removed `current_period_end` from the subscription
          // root — it now lives on the subscription item. Fall back gracefully.
          const periodEndUnix = subscription.current_period_end
            ?? subscription.items?.data?.[0]?.current_period_end
            ?? null;
          const toIso = (unix) => {
            if (!unix || typeof unix !== 'number') return null;
            const d = new Date(unix * 1000);
            return isNaN(d.getTime()) ? null : d.toISOString();
          };
          const periodEndIso = toIso(periodEndUnix);
          const cancelAtIso = toIso(subscription.cancel_at);

          // Scheduled cancellation at period end — keep access until `cancel_at`,
          // mark our record as cancelled so UI shows "Cancelled, active until ...".
          if (subscription.cancel_at_period_end === true && subscription.status === 'active') {
            const endIso = cancelAtIso || periodEndIso;
            if (users.length > 0 && endIso) {
              await sr.entities.User.update(users[0].id, {
                subscription_status: 'pro',
                subscription_end_date: endIso
              });
            }
            await sr.entities.TripSubscription.update(record.id, {
              status: 'cancelled',
              ...(endIso ? { end_date: endIso } : {})
            });
          } else if (subscription.status === 'active' || subscription.status === 'trialing') {
            if (users.length > 0 && periodEndIso) {
              await sr.entities.User.update(users[0].id, {
                subscription_status: 'pro',
                subscription_end_date: periodEndIso
              });
            }
            await sr.entities.TripSubscription.update(record.id, {
              status: 'active',
              ...(periodEndIso ? { end_date: periodEndIso } : {})
            });
          } else if (subscription.status === 'canceled' || subscription.status === 'unpaid') {
            if (users.length > 0) {
              await sr.entities.User.update(users[0].id, {
                subscription_status: 'free'
              });
            }
            await sr.entities.TripSubscription.update(record.id, {
              status: subscription.status === 'canceled' ? 'cancelled' : 'expired'
            });
          }
        }
        break;
      }

      case 'customer.subscription.deleted': {
        const subscription = event.data.object;
        const subRecord = await sr.entities.TripSubscription.filter({
          stripe_subscription_id: subscription.id
        });

        if (subRecord.length > 0) {
          const { user_email } = subRecord[0];
          const users = await sr.entities.User.filter({ email: user_email });
          if (users.length > 0) {
            await sr.entities.User.update(users[0].id, {
              subscription_status: 'free'
            });
          }
          await sr.entities.TripSubscription.update(subRecord[0].id, {
            status: 'cancelled'
          });
        }
        break;
      }
    }

    // Record the event AFTER successful processing. If anything throws above,
    // the StripeEvent row is never created and Stripe's retry will re-attempt.
    try {
      await sr.entities.StripeEvent.create({
        event_id: event.id,
        type: event.type,
        processed_at: new Date().toISOString()
      });
    } catch (e) {
      console.error('Failed to record StripeEvent (non-fatal):', e.message);
    }

    return Response.json({ received: true });
  } catch (error) {
    console.error('Webhook error:', error);
    return Response.json({ error: error.message }, { status: 500 });
  }
});