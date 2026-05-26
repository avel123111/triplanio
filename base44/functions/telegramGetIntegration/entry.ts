// Returns { connected, integration } for the current user and the given trip.
// Connected = a TripTelegramIntegration row exists with a non-null telegram_chat_id.
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
    const integration = rows[0] || null;
    const connected = !!(integration && integration.telegram_chat_id);

    return Response.json({ connected, integration });
  } catch (e) {
    console.error('telegramGetIntegration error:', e);
    return Response.json({ error: e.message }, { status: 500 });
  }
});