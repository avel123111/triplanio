import { corsFor } from '../_shared/cors.ts';
import { supabaseAdmin } from '../_shared/supabaseAdmin.ts';
import { captureEdgeError } from '../_shared/sentry.ts';

const BOT_EMAIL = 'info@triplanio.com';
const BOT_NAME  = 'Triplanio';

Deno.serve(async (req) => {
  const corsHeaders = corsFor(req);
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });
  if (req.method !== 'POST') {
    return Response.json({ error: 'Method not allowed' }, { status: 405, headers: corsHeaders });
  }

  try {
    const expected = Deno.env.get('N8N_SECRET');
    if (!expected) return Response.json({ error: 'N8N_SECRET not configured' }, { status: 500, headers: corsHeaders });

    const auth  = req.headers.get('authorization') || '';
    const match = auth.match(/^Bearer\s+(.+)$/i);
    if (!match || match[1].trim() !== expected) {
      return Response.json({ error: 'Unauthorized' }, { status: 401, headers: corsHeaders });
    }

    const { chat_id, message } = await req.json();
    if (!chat_id || !message?.trim()) {
      return Response.json({ error: 'chat_id and message required' }, { status: 400, headers: corsHeaders });
    }

    const { data: chat } = await supabaseAdmin
      .from('chats')
      .select('id,trip_id')
      .eq('id', chat_id)
      .single();
    if (!chat) return Response.json({ error: 'Chat not found' }, { status: 404, headers: corsHeaders });

    const { data: botUser } = await supabaseAdmin
      .from('users')
      .select('id')
      .eq('email', BOT_EMAIL)
      .maybeSingle();
    if (!botUser) return Response.json({ error: 'Bot user not found' }, { status: 500, headers: corsHeaders });

    const { data: created, error } = await supabaseAdmin
      .from('chat_messages')
      .insert({
        chat_id,
        trip_id:        chat.trip_id,
        user_id:        botUser.id,
        user_full_name: BOT_NAME,
        text:           message.trim().slice(0, 4000),
        created_by:     botUser.id,
      })
      .select('id')
      .single();

    if (error) throw error;

    return Response.json({ ok: true, id: created.id }, { headers: corsHeaders });
  } catch (err) {
    await captureEdgeError(err, 'triplanioAiReply');
    console.error('triplanioAiReply error:', err);
    return Response.json({ error: (err as Error).message }, { status: 500, headers: corsHeaders });
  }
});
