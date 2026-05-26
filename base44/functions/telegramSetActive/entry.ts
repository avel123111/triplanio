// Toggles TripTelegramIntegration.is_active for the current user + trip.
import { createClientFromRequest } from 'npm:@base44/sdk@0.8.25';

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me();
    if (!user) return Response.json({ error: 'Unauthorized' }, { status: 401 });

    const { tripId, isActive } = await req.json();
    if (!tripId || typeof isActive !== 'boolean') {
      return Response.json({ error: 'tripId and isActive required' }, { status: 400 });
    }

    const rows = await base44.asServiceRole.entities.TripTelegramIntegration.filter({
      trip_id: tripId,
      user_id: user.id,
    });
    if (rows.length === 0) return Response.json({ error: 'Not connected' }, { status: 404 });

    await base44.asServiceRole.entities.TripTelegramIntegration.update(rows[0].id, { is_active: isActive });
    return Response.json({ ok: true });
  } catch (e) {
    console.error('telegramSetActive error:', e);
    return Response.json({ error: e.message }, { status: 500 });
  }
});