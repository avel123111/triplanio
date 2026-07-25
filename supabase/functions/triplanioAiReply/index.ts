import { supabaseAdmin } from '../_shared/supabaseAdmin.ts';
import { readJson, withHandler } from '../_shared/http.ts';

const BOT_EMAIL = 'info@triplanio.com';

/**
 * Ответ ассистента приходит сюда из n8n.
 *
 * Ответ и снятие пометки «ждём ответ» — одна транзакция (RPC finish_ai_run):
 * разъехаться они не могут, повторная доставка не создаёт вторую копию ответа.
 * Вызов с полем `error` закрывает прогон отказом — это путь Error Workflow в
 * n8n, чтобы упавший прогон не висел до сторожа (TRIP-296).
 */
Deno.serve(withHandler('triplanioAiReply', async (req, corsHeaders) => {
  if (req.method !== 'POST') {
    return Response.json({ error: 'Method not allowed' }, { status: 405, headers: corsHeaders });
  }

    const expected = Deno.env.get('N8N_SECRET');
    if (!expected) return Response.json({ error: 'N8N_SECRET not configured' }, { status: 500, headers: corsHeaders });

    const auth  = req.headers.get('authorization') || '';
    const match = auth.match(/^Bearer\s+(.+)$/i);
    if (!match || match[1].trim() !== expected) {
      return Response.json({ error: 'Unauthorized' }, { status: 401, headers: corsHeaders });
    }

    const body = await readJson(req);
    const messageIdIn = typeof body.message_id === 'string' ? body.message_id : '';
    const chatId      = typeof body.chat_id === 'string' ? body.chat_id : '';
    const message     = typeof body.message === 'string' ? body.message : '';
    const failure     = typeof body.error === 'string' ? body.error : '';

    if (!messageIdIn && !chatId) {
      return Response.json({ error: 'message_id or chat_id required' }, { status: 400, headers: corsHeaders });
    }
    if (!failure && !message.trim()) {
      return Response.json({ error: 'message required' }, { status: 400, headers: corsHeaders });
    }

    // Мост на время переключения: воркфлоу n8n правится руками и ещё не знает про
    // message_id, поэтому по chat_id находим самый свежий открытый прогон этого
    // чата. Удалить вместе с переводом воркфлоу на message_id (TRIP-296, Ф6).
    let messageId = messageIdIn;
    if (!messageId) {
      const { data: open } = await supabaseAdmin
        .from('chat_messages')
        .select('id')
        .eq('chat_id', chatId)
        .in('ai_status', ['queued', 'running'])
        .order('ai_requested_at', { ascending: false })
        .limit(1)
        .maybeSingle();
      if (!open) {
        return Response.json({ error: 'No open assistant run for this chat' }, { status: 404, headers: corsHeaders });
      }
      messageId = open.id;
    }

    const { data: botUser } = await supabaseAdmin
      .from('users')
      .select('id')
      .eq('email', BOT_EMAIL)
      .maybeSingle();
    if (!botUser) return Response.json({ error: 'Bot user not found' }, { status: 500, headers: corsHeaders });

    const { data: replyId, error } = await supabaseAdmin.rpc('finish_ai_run', {
      p_message_id:  messageId,
      p_bot_user_id: botUser.id,
      p_reply:       failure ? null : message,
      p_error:       failure || null,
    });
    if (error) throw error;

    return Response.json({ ok: true, id: replyId }, { headers: corsHeaders });
}));
