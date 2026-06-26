import { corsFor } from '../_shared/cors.ts';
import { supabaseAdmin, getRequestUser } from '../_shared/supabaseAdmin.ts';
import { signN8nJwt } from '../_shared/n8nAuth.ts';

const N8N_WEBHOOK_URL = 'https://n8n-production-d1214.up.railway.app/webhook/group-chat';

Deno.serve(async (req) => {
  const corsHeaders = corsFor(req);
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });

  try {
    const user = await getRequestUser(req);
    if (!user) return Response.json({ error: 'Unauthorized' }, { status: 401, headers: corsHeaders });

    const { chat_id, user_message } = await req.json();
    if (!chat_id) return Response.json({ error: 'chat_id required' }, { status: 400, headers: corsHeaders });

    const { data: chat } = await supabaseAdmin
      .from('chats')
      .select('id,trip_id')
      .eq('id', chat_id)
      .single();
    if (!chat) return Response.json({ error: 'Chat not found' }, { status: 404, headers: corsHeaders });

    const { data: trip } = await supabaseAdmin
      .from('trips')
      .select('id,created_by')
      .eq('id', chat.trip_id)
      .single();
    if (!trip) return Response.json({ error: 'Trip not found' }, { status: 404, headers: corsHeaders });

    const isCreator = trip.created_by === user.id;
    if (!isCreator) {
      const { data: member } = await supabaseAdmin
        .from('trip_members')
        .select('id')
        .eq('trip_id', chat.trip_id)
        .eq('user_id', user.id)
        .eq('status', 'active')
        .maybeSingle();
      if (!member) return Response.json({ error: 'Forbidden' }, { status: 403, headers: corsHeaders });
    }

    const { data: recentMessages } = await supabaseAdmin
      .from('chat_messages')
      .select('id,user_id,user_full_name,text,created_at')
      .eq('chat_id', chat_id)
      .order('created_at', { ascending: false })
      .limit(20);
    const messages = (recentMessages || []).reverse();

    const payload = {
      chat_id,
      trip_id: chat.trip_id,
      user_message: user_message || '',
      messages,
      requested_by: {
        user_id: user.id,
        email: user.email,
        full_name: user.user_metadata?.full_name || null,
      },
    };

    const n8nSecret = Deno.env.get('N8N_SECRET');
    if (!n8nSecret) return Response.json({ error: 'N8N_SECRET not configured' }, { status: 500, headers: corsHeaders });

    const n8nJwt = await signN8nJwt(n8nSecret);
    const res = await fetch(N8N_WEBHOOK_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${n8nJwt}` },
      body: JSON.stringify({ payload }),
    });

    if (!res.ok) {
      const errText = await res.text().catch(() => '');
      console.error('n8n error:', res.status, errText);
      return Response.json({ error: 'AI webhook failed' }, { status: 502, headers: corsHeaders });
    }

    return Response.json({ ok: true }, { headers: corsHeaders });
  } catch (err) {
    console.error('callTriplanioAi error:', err);
    return Response.json({ error: (err as Error).message }, { status: 500, headers: corsHeaders });
  }
});
