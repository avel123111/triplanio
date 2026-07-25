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
    const messageId = typeof body.message_id === 'string' ? body.message_id : '';
    const message   = typeof body.message === 'string' ? body.message : '';
    const failure   = typeof body.error === 'string' ? body.error : '';

    if (!messageId) {
      return Response.json({ error: 'message_id required' }, { status: 400, headers: corsHeaders });
    }
    if (!failure && !message.trim()) {
      return Response.json({ error: 'message required' }, { status: 400, headers: corsHeaders });
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
