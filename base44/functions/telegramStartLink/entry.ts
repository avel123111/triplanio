// Creates a one-time link token for the current user + trip and returns
// the t.me deep link. Frontend opens this URL in a new tab; user presses
// Start in Telegram which sends "/start <token>" to our webhook.
import { createClientFromRequest } from 'npm:@base44/sdk@0.8.25';

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me();
    if (!user) return Response.json({ error: 'Unauthorized' }, { status: 401 });

    const { tripId } = await req.json();
    if (!tripId) return Response.json({ error: 'tripId is required' }, { status: 400 });

    // Verify user has access to this trip (owner or active member).
    const trip = await base44.entities.Trip.get(tripId);
    if (!trip) return Response.json({ error: 'Trip not found' }, { status: 404 });
    if (trip.created_by !== user.email) {
      const members = await base44.entities.TripMember.filter({ trip_id: tripId, user_email: user.email, status: 'active' });
      if (members.length === 0) return Response.json({ error: 'Forbidden' }, { status: 403 });
    }

    // Get bot username.
    const botToken = Deno.env.get('TELEGRAM_BOT_TOKEN');
    if (!botToken) return Response.json({ error: 'TELEGRAM_BOT_TOKEN missing' }, { status: 500 });
    const meRes = await fetch(`https://api.telegram.org/bot${botToken}/getMe`);
    const meData = await meRes.json();
    if (!meData.ok) return Response.json({ error: 'Cannot reach Telegram' }, { status: 500 });
    const botUsername = meData.result.username;

    // Generate random 32-hex token.
    const bytes = new Uint8Array(16);
    crypto.getRandomValues(bytes);
    const token = Array.from(bytes).map((b) => b.toString(16).padStart(2, '0')).join('');
    const expiresAt = new Date(Date.now() + 10 * 60 * 1000).toISOString();

    await base44.asServiceRole.entities.TelegramLinkToken.create({
      token,
      trip_id: tripId,
      user_id: user.id,
      user_email: user.email,
      expires_at: expiresAt,
    });

    const url = `https://t.me/${botUsername}?start=${token}`;
    return Response.json({ url, botUsername });
  } catch (e) {
    console.error('telegramStartLink error:', e);
    return Response.json({ error: e.message }, { status: 500 });
  }
});