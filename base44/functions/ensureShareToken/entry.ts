/**
 * Ensures the given trip has a share_token, generating one on first call.
 *
 * Auth: only owner / admin members of the trip may generate the token.
 *
 * Input:  { tripId: string }
 * Output: { token: string }
 */
import { createClientFromRequest } from 'npm:@base44/sdk@0.8.25';

function genToken() {
  // 32 hex chars (~128 bits) — enough entropy that the URL can't be guessed.
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, b => b.toString(16).padStart(2, '0')).join('');
}

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me();
    if (!user) return Response.json({ error: 'Unauthorized' }, { status: 401 });

    const { tripId } = await req.json();
    if (!tripId) return Response.json({ error: 'tripId required' }, { status: 400 });

    const trip = await base44.asServiceRole.entities.Trip.get(tripId);
    if (!trip) return Response.json({ error: 'Trip not found' }, { status: 404 });

    // Caller must be owner or admin member of the trip.
    const isOwner = trip.created_by === user.email;
    let allowed = isOwner;
    if (!allowed) {
      const memberships = await base44.asServiceRole.entities.TripMember.filter({
        trip_id: tripId,
        user_email: user.email,
      });
      allowed = memberships.some(m => m.role === 'owner' || m.role === 'admin');
    }
    if (!allowed) return Response.json({ error: 'Forbidden' }, { status: 403 });

    if (trip.share_token) {
      return Response.json({ token: trip.share_token });
    }

    const token = genToken();
    await base44.asServiceRole.entities.Trip.update(tripId, { share_token: token });
    return Response.json({ token });
  } catch (err) {
    console.error('ensureShareToken error:', err);
    return Response.json({ error: err.message }, { status: 500 });
  }
});