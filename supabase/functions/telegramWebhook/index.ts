/**
 * telegramWebhook
 *
 * INTERNAL binding endpoint. Called by n8n (NOT by Telegram directly): n8n owns
 * the bot webhook (Telegram Trigger) and forwards `/start` updates here. Auth via
 * `Authorization: Bearer <N8N_SECRET>` (requireN8nSecret); verify_jwt=false.
 *
 * Handles the /start handshake only — does NOT send Telegram messages (n8n renders
 * the reply from the JSON this returns):
 *   /start <token> → consume telegram_link_tokens, upsert trip_telegram_integrations
 *                    by (trip_id, telegram_chat_id) → { ok:true, action:'linked', trip_title }
 *   /start         → { ok:true, action:'welcome' }
 *   bad token      → { ok:false, reason:'invalid' | 'used' | 'expired' }
 *   other message  → { ok:true, action:'ignored' }
 *
 * Identity is (trip_id, telegram_chat_id) — many chats per trip, many trips per chat.
 * user_id is informational ("linked_by").
 */

import { corsHeaders } from '../_shared/cors.ts';
import { requireN8nSecret } from '../_shared/n8nAuth.ts';
import { supabaseAdmin } from '../_shared/supabaseAdmin.ts';

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });

  const denied = requireN8nSecret(req);
  if (denied) return denied;

  try {
    const update = await req.json().catch(() => null);
    const msg = update?.message;
    if (!msg) return Response.json({ ok: true, action: 'ignored' }, { headers: corsHeaders });

    const chatId = String(msg.chat.id);
    const text = (msg.text || '').trim();
    const tgUsername = msg.from?.username || '';
    const tgFirstName = msg.from?.first_name || '';

    if (!text.startsWith('/start')) {
      return Response.json({ ok: true, action: 'ignored' }, { headers: corsHeaders });
    }

    const linkToken = text.split(/\s+/)[1];
    if (!linkToken) {
      return Response.json({ ok: true, action: 'welcome' }, { headers: corsHeaders });
    }

    const { data: tokens } = await supabaseAdmin
      .from('telegram_link_tokens')
      .select('*')
      .eq('token', linkToken)
      .limit(1);
    const tok = tokens?.[0];

    if (!tok) return Response.json({ ok: false, reason: 'invalid' }, { headers: corsHeaders });
    if (tok.used_at) return Response.json({ ok: false, reason: 'used' }, { headers: corsHeaders });
    if (new Date(tok.expires_at).getTime() < Date.now()) {
      return Response.json({ ok: false, reason: 'expired' }, { headers: corsHeaders });
    }

    // Upsert by (trip_id, telegram_chat_id). Re-binding the same chat updates the row.
    const { error: upsertErr } = await supabaseAdmin
      .from('trip_telegram_integrations')
      .upsert({
        trip_id: tok.trip_id,
        user_id: tok.user_id,            // linked_by (informational, not identity)
        telegram_chat_id: chatId,
        telegram_username: tgUsername,
        telegram_first_name: tgFirstName,
        is_active: true,
        linked_at: new Date().toISOString(),
      }, { onConflict: 'trip_id,telegram_chat_id' });
    if (upsertErr) throw upsertErr;

    // Consume the token only after a successful upsert.
    await supabaseAdmin
      .from('telegram_link_tokens')
      .update({ used_at: new Date().toISOString() })
      .eq('id', tok.id);

    const { data: trip } = await supabaseAdmin
      .from('trips').select('title').eq('id', tok.trip_id).maybeSingle();

    return Response.json(
      { ok: true, action: 'linked', trip_title: trip?.title || '' },
      { headers: corsHeaders },
    );

  } catch (e) {
    console.error('telegramWebhook error:', e);
    return Response.json(
      { ok: false, reason: 'error', error: (e as Error).message },
      { status: 500, headers: corsHeaders },
    );
  }
});
