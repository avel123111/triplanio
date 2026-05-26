/**
 * Public read-only trip endpoint.
 *
 * No authentication required. Caller must supply tripId + matching share_token.
 * Returns the trip and all its nested data (visits, hotels, transfers,
 * activities, car rentals) — but NOTHING about members, budget, or owners.
 *
 * Input:  { tripId: string, token: string }
 * Output: { trip, visits, hotels, transfers, activities, carRentals }
 */
import { createClientFromRequest } from 'npm:@base44/sdk@0.8.25';

function sanitizeTrip(t) {
  // Strip ownership metadata before exposing publicly.
  const { created_by, share_token, ...rest } = t;
  return rest;
}

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const { tripId, token } = await req.json();
    if (!tripId || !token) {
      return Response.json({ error: 'tripId and token required' }, { status: 400 });
    }

    let trip;
    try {
      trip = await base44.asServiceRole.entities.Trip.get(tripId);
    } catch {
      return Response.json({ error: 'Not found' }, { status: 404 });
    }
    if (!trip || !trip.share_token || trip.share_token !== token) {
      return Response.json({ error: 'Not found' }, { status: 404 });
    }

    const [visits, hotels, transfers, activities, services] = await Promise.all([
      base44.asServiceRole.entities.CityVisit.filter({ trip_id: tripId }),
      base44.asServiceRole.entities.HotelStay.filter({ trip_id: tripId }),
      base44.asServiceRole.entities.Transfer.filter({ trip_id: tripId }),
      base44.asServiceRole.entities.Activity.filter({ trip_id: tripId }),
      base44.asServiceRole.entities.TripService.filter({ trip_id: tripId }),
    ]);

    const carRentals = services.filter(s => s.kind === 'car_rental');

    return Response.json({
      trip: sanitizeTrip(trip),
      visits,
      hotels,
      transfers,
      activities,
      carRentals,
    });
  } catch (err) {
    console.error('getPublicTrip error:', err);
    return Response.json({ error: err.message }, { status: 500 });
  }
});