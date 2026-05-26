// Removes the TripTelegramIntegration row for the current user + trip.
import { createClientFromRequest } from 'npm:@base44/sdk@0.8.25';

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me();
    if (!user) return Response.json({ error: 'Unauthorized' }, { status: 401 });

    const { tripId } = await req.json();
    if (!tripId) return Response.json({ error: 'tripId is required' }, { status: 400 });

    const rows = await base44.asServiceRole.entities.TripTelegramIntegration.filter({
      trip_id: tripId,
      user_id: user.id,
    });
    for (const r of rows) {
      await base44.asServiceRole.entities.TripTelegramIntegration.delete(r.id);
    }
    return Response.json({ ok: true, removed: rows.length });
  } catch (e) {
    console.error('telegramDisconnect error:', e);
    return Response.json({ error: e.message }, { status: 500 });
  }
});