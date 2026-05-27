/**
 * telegramGetBotInfo
 *
 * GET/POST — no body required.
 *
 * Returns Telegram bot @username. Used by telegramStartLink to build
 * the t.me/<bot>?start=<token> deep link.
 */

import { corsHeaders } from '../_shared/cors.ts';
import { getRequestUser } from '../_shared/supabaseAdmin.ts';

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });

  try {
    const user = await getRequestUser(req);
    if (!user) return Response.json({ error: 'Unauthorized' }, { status: 401, headers: corsHeaders });

    const token = Deno.env.get('TELEGRAM_BOT_TOKEN');
    if (!token) return Response.json({ error: 'TELEGRAM_BOT_TOKEN missing' }, { status: 500, headers: corsHeaders });

    const res = await fetch(`https://api.telegram.org/bot${token}/getMe`);
    const data = await res.json();
    if (!data.ok) {
      console.error('getMe failed:', data);
      return Response.json({ error: data.description || 'getMe failed' }, { status: 500, headers: corsHeaders });
    }

    return Response.json({
      id: data.result.id,
      username: data.result.username,
      first_name: data.result.first_name,
    }, { headers: corsHeaders });

  } catch (e) {
    console.error('telegramGetBotInfo error:', e);
    return Response.json(
      { error: (e as Error).message },
      { status: 500, headers: corsHeaders },
    );
  }
});
