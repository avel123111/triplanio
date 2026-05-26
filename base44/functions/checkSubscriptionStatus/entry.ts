import { createClientFromRequest } from 'npm:@base44/sdk@0.8.25';

/**
 * Returns whether the given trip should have Pro features unlocked.
 * Rule: Pro features are available if EITHER
 *   - the trip's OWNER has an active Pro subscription, OR
 *   - the trip itself is marked is_pro_trip=true (one-time purchase).
 *
 * The current user's own subscription is irrelevant here — what matters
 * is whether the OWNER of the trip pays for Pro (so all members benefit).
 */
Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me();

    if (!user) {
      return Response.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const { tripId } = await req.json();
    const sr = base44.asServiceRole;
    const now = new Date();

    // If no tripId, fall back to checking the current user's own subscription
    // (used by pages outside a trip context, e.g. trip-creation paywall).
    if (!tripId) {
      const isPro = user.subscription_status === 'pro' &&
        user.subscription_end_date &&
        new Date(user.subscription_end_date) > now;
      return Response.json({ isPro, reason: isPro ? 'subscription' : null });
    }

    // Load the trip to find its owner
    const trip = await sr.entities.Trip.get(tripId);
    if (!trip) {
      return Response.json({ isPro: false, isOwner: false, reason: null });
    }

    const isOwner = trip.created_by === user.email;

    // 1. One-time Pro-trip purchase unlocks for everyone
    if (trip.is_pro_trip) {
      return Response.json({ isPro: true, isOwner, reason: 'trip' });
    }

    // 2. Owner has active Pro subscription → unlocks for all members
    const ownerEmail = trip.created_by;
    if (ownerEmail) {
      const owners = await sr.entities.User.filter({ email: ownerEmail });
      const owner = owners[0];
      if (owner &&
          owner.subscription_status === 'pro' &&
          owner.subscription_end_date &&
          new Date(owner.subscription_end_date) > now) {
        return Response.json({ isPro: true, isOwner, reason: 'owner_subscription' });
      }
    }

    return Response.json({ isPro: false, isOwner });
  } catch (error) {
    console.error('Check subscription error:', error);
    return Response.json({ error: error.message }, { status: 500 });
  }
});