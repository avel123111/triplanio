import { createClientFromRequest } from 'npm:@base44/sdk@0.8.25';

/**
 * Returns the count of active trips for the current user AND whether they have Pro.
 * Pro users always have isPro=true (so the UI should never block them on limits).
 *
 * Active = trip has no visits with dates yet, OR the max end date of its visits >= today (UTC).
 *
 * Performance note: we fetch ALL the user's city visits in a single `$in`
 * query instead of N parallel filters (one per trip). With ~10 trips this
 * dropped the call from 10+s to a couple hundred ms.
 */
Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me();

    if (!user) {
      return Response.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const now = new Date();
    const isPro = user.subscription_status === 'pro' &&
      user.subscription_end_date &&
      new Date(user.subscription_end_date) > now;

    // Trips created by this user
    const allTrips = await base44.entities.Trip.filter({ created_by: user.email });

    if (allTrips.length === 0) {
      return Response.json({ isPro, activeCount: 0, activeTrips: [] });
    }

    const today = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
    const todayMs = today.getTime();

    // One query for ALL visits across the user's trips — avoids N+1.
    const tripIds = allTrips.map(t => t.id);
    const allVisits = await base44.entities.CityVisit.filter({ trip_id: { $in: tripIds } });

    // Build a per-trip max end_datetime index in O(n).
    const maxEndByTrip = new Map();
    for (const v of allVisits) {
      if (!v.end_datetime) continue;
      const e = new Date(v.end_datetime).getTime();
      if (Number.isNaN(e)) continue;
      const cur = maxEndByTrip.get(v.trip_id);
      if (cur === undefined || e > cur) maxEndByTrip.set(v.trip_id, e);
    }

    const activeTrips = allTrips.filter(trip => {
      const maxEnd = maxEndByTrip.get(trip.id);
      // No dated visits yet = active. Otherwise active if latest end >= today (UTC).
      return maxEnd === undefined || maxEnd >= todayMs;
    });

    return Response.json({
      isPro,
      activeCount: activeTrips.length,
      activeTrips: activeTrips.map(t => ({ id: t.id, title: t.title }))
    });
  } catch (error) {
    console.error('Get active trips error:', error);
    return Response.json({ error: error.message }, { status: 500 });
  }
});