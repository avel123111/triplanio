import { createClientFromRequest } from 'npm:@base44/sdk@0.8.25';

/**
 * Permanently delete the current user's account and all owned data.
 *
 * Pre-flight checks:
 *  - User must be authenticated.
 *  - If the user has an ACTIVE recurring Stripe subscription (pro_monthly /
 *    pro_yearly with status='active'), deletion is blocked. The user must
 *    cancel the subscription first via the Stripe billing portal (Settings
 *    page).
 *  - One-time pro_trip purchases do NOT block deletion (already paid, no
 *    ongoing billing).
 *
 * Cascade order (parent → child, but our store is flat so order is mostly
 * about minimizing orphans visible in any intermediate view):
 *  1. For each Trip owned by the user: delete all linked records
 *     (HotelStay, Activity, Transfer, CityVisit, TripMember, TripDocument,
 *     TripBudget, BudgetCategory, BudgetExpense, BudgetSegmentShare,
 *     TripService) — then delete the Trip itself.
 *  2. Delete the user's TripMember rows on OTHER people's trips (so they
 *     stop appearing as a member). Those trips themselves are kept.
 *  3. Delete the user's Notifications and TripSubscription records.
 *  4. Delete the User record.
 *
 * All entity ops run as service role — required because RLS blocks regular
 * users from listing other users' records, and we need to clean up by
 * trip_id which may include co-owned data.
 */
Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me();
    if (!user) {
      return Response.json({ error: 'Unauthorized' }, { status: 401 });
    }
    const email = user.email;
    if (!email) {
      return Response.json({ error: 'No email on user' }, { status: 400 });
    }

    const svc = base44.asServiceRole.entities;

    // 1) Block deletion if user has an ACTIVE recurring subscription.
    const activeSubs = await svc.TripSubscription.filter({
      user_email: email,
      status: 'active',
    });
    const blockingSub = activeSubs.find(
      (s) => s.type === 'pro_monthly' || s.type === 'pro_yearly'
    );
    if (blockingSub) {
      return Response.json(
        {
          error: 'active_subscription',
          subscription_type: blockingSub.type,
        },
        { status: 409 }
      );
    }

    // 2) Cascade-delete all trips owned by this user.
    const ownedTrips = await svc.Trip.filter({ created_by: email });
    const ownedTripIds = ownedTrips.map((t) => t.id);

    for (const tripId of ownedTripIds) {
      // Delete child records by trip_id. Order doesn't strictly matter since
      // we have no FKs, but we delete leaves first for clarity.
      const childEntities = [
        'HotelStay',
        'Activity',
        'Transfer',
        'BudgetExpense',
        'BudgetCategory',
        'BudgetSegmentShare',
        'TripBudget',
        'TripDocument',
        'TripService',
        'TripMember',
        'CityVisit',
      ];
      for (const entName of childEntities) {
        try {
          const rows = await svc[entName].filter({ trip_id: tripId });
          for (const r of rows) {
            try {
              await svc[entName].delete(r.id);
            } catch (e) {
              console.error(`Failed to delete ${entName} ${r.id}`, e);
            }
          }
        } catch (e) {
          console.error(`Failed to list ${entName} for trip ${tripId}`, e);
        }
      }
      // Finally, delete the trip itself.
      try {
        await svc.Trip.delete(tripId);
      } catch (e) {
        console.error(`Failed to delete Trip ${tripId}`, e);
      }
    }

    // 3) Remove the user's membership rows on OTHER trips (kept option (a)
    //    from the design discussion — those trips remain owned by their
    //    creators, the user just disappears from the member list).
    const myMemberships = await svc.TripMember.filter({ user_email: email });
    for (const m of myMemberships) {
      try {
        await svc.TripMember.delete(m.id);
      } catch (e) {
        console.error(`Failed to delete TripMember ${m.id}`, e);
      }
    }

    // 4) Delete notifications addressed to this user.
    try {
      const notifs = await svc.Notification.filter({ user_email: email });
      for (const n of notifs) {
        try {
          await svc.Notification.delete(n.id);
        } catch (e) {
          console.error(`Failed to delete Notification ${n.id}`, e);
        }
      }
    } catch (e) {
      console.error('Failed to list notifications', e);
    }

    // 5) Delete user's subscription records (no active ones at this point —
    //    pre-flight blocked active recurring; one-time pro_trip records are
    //    informational only).
    try {
      const subs = await svc.TripSubscription.filter({ user_email: email });
      for (const s of subs) {
        try {
          await svc.TripSubscription.delete(s.id);
        } catch (e) {
          console.error(`Failed to delete TripSubscription ${s.id}`, e);
        }
      }
    } catch (e) {
      console.error('Failed to list subscriptions', e);
    }

    // 6) Finally, delete the User record itself.
    try {
      await svc.User.delete(user.id);
    } catch (e) {
      console.error(`Failed to delete User ${user.id}`, e);
      return Response.json(
        { error: 'user_delete_failed', detail: e?.message || String(e) },
        { status: 500 }
      );
    }

    return Response.json({ ok: true });
  } catch (error) {
    console.error('deleteMyAccount failed', error);
    return Response.json({ error: error.message }, { status: 500 });
  }
});