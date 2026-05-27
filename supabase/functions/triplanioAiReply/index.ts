/**
 * triplanioAiReply
 *
 * POST body: { tripId, text }
 *
 * Called by the Triplanio AI service (not a user).
 * Auth via TRIPLANIO_AI_CALLBACK_SECRET bearer token.
 * Inserts a chat message as the bot user (info@triplanio.com).
 */

import { corsHeaders } from '../_shared/cors.ts';
import { supabaseAdmin } from '../_shared/supabaseAdmin.ts';

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });

  try {
    // Authenticate via shared secret (not user JWT)
    const authHeader = req.headers.get('Authorization') || '';
    const secret = Deno.env.get('TRIPLANIO_AI_CALLBACK_SECRET');
    if (!secret) {
      return Response.json({ error: 'TRIPLANIO_AI_CALLBACK_SECRET not configured' }, { status: 500, headers: corsHeaders });
    }
    if (authHeader !== `Bearer ${secret}`) {
      return Response.json({ error: 'Unauthorized' }, { status: 401, headers: corsHeaders });
    }

    const { tripId, text } = await req.json();
    if (!tripId || !text) {
      return Response.json({ error: 'tripId and text are required' }, { status: 400, headers: corsHeaders });
    }

    // Verify trip exists
    const { data: trip } = await supabaseAdmin
      .from('trips')
      .select('id')
      .eq('id', tripId)
      .single();
    if (!trip) {
      return Response.json({ error: 'Trip not found' }, { status: 404, headers: corsHeaders });
    }

    const BOT_EMAIL = 'info@triplanio.com';
    const BOT_NAME = 'Triplanio AI';

    const { data: message, error } = await supabaseAdmin
      .from('chat_messages')
      .insert({
        trip_id: tripId,
        user_email: BOT_EMAIL,
        user_full_name: BOT_NAME,
        text,
        created_by: BOT_EMAIL,
      })
      .select()
      .single();

    if (error) throw error;

    return Response.json({ ok: true, message }, { headers: corsHeaders });

  } catch (e) {
    console.error('triplanioAiReply error:', e);
    return Response.json(
      { error: (e as Error).message },
      { status: 500, headers: corsHeaders },
    );
  }
});
