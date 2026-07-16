/**
 * telegramStartLink
 *
 * POST body: { tripId }
 *
 * Creates a one-time link token for the current user + trip and returns
 * the t.me deep link. Frontend opens this in a new tab; user presses Start
 * in Telegram which sends "/start <token>" to our telegramWebhook.
 *
 * Token expires in 10 minutes.
 */

import { withHandler } from '../_shared/http.ts';
import { supabaseAdmin, getRequestUser } from '../_shared/supabaseAdmin.ts';
import { isCallerParticipant } from '../_shared/tripAccess.ts';

Deno.serve(withHandler('telegramStartLink', async (req, corsHeaders) => {
    const user = await getRequestUser(req);
    if (!user) return Response.json({ error: 'Unauthorized' }, { status: 401, headers: corsHeaders });

    const { tripId } = await req.json();
    if (!tripId) return Response.json({ error: 'tripId is required' }, { status: 400, headers: corsHeaders });

    // Verify user has access to this trip
    const { data: trip } = await supabaseAdmin
      .from('trips')
      .select('id')
      .eq('id', tripId)
      .single();
    if (!trip) return Response.json({ error: 'Trip not found' }, { status: 404, headers: corsHeaders });

    const hasAccess = await isCallerParticipant(tripId, user.id);
    if (!hasAccess) return Response.json({ error: 'Forbidden' }, { status: 403, headers: corsHeaders });

    // Bot username is a static public value — no need to call Telegram (no bot token).
    const botUsername = Deno.env.get('TELEGRAM_BOT_USERNAME');
    if (!botUsername) return Response.json({ error: 'TELEGRAM_BOT_USERNAME missing' }, { status: 500, headers: corsHeaders });

    // Generate random 32-hex token
    const bytes = new Uint8Array(16);
    crypto.getRandomValues(bytes);
    const token = Array.from(bytes).map((b) => b.toString(16).padStart(2, '0')).join('');
    const expiresAt = new Date(Date.now() + 10 * 60 * 1000).toISOString();

    await supabaseAdmin.from('telegram_link_tokens').insert({
      token,
      trip_id: tripId,
      user_id: user.id,         // Supabase auth UUID
      expires_at: expiresAt,
    });

    const url = `https://t.me/${botUsername}?start=${token}`;
    return Response.json({ url, botUsername }, { headers: corsHeaders });

}));
