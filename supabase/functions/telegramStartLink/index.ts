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

import { corsHeaders } from '../_shared/cors.ts';
import { supabaseAdmin, getRequestUser } from '../_shared/supabaseAdmin.ts';
import { isCallerParticipant } from '../_shared/tripAccess.ts';

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });

  try {
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

    const hasAccess = await isCallerParticipant(tripId, user.email!);
    if (!hasAccess) return Response.json({ error: 'Forbidden' }, { status: 403, headers: corsHeaders });

    // Get bot username
    const botToken = Deno.env.get('TELEGRAM_BOT_TOKEN');
    if (!botToken) return Response.json({ error: 'TELEGRAM_BOT_TOKEN missing' }, { status: 500, headers: corsHeaders });

    const meRes = await fetch(`https://api.telegram.org/bot${botToken}/getMe`);
    const meData = await meRes.json();
    if (!meData.ok) return Response.json({ error: 'Cannot reach Telegram' }, { status: 500, headers: corsHeaders });
    const botUsername = meData.result.username;

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

  } catch (e) {
    console.error('telegramStartLink error:', e);
    return Response.json(
      { error: (e as Error).message },
      { status: 500, headers: corsHeaders },
    );
  }
});
