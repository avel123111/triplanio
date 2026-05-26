// Returns Telegram bot @username. Used by telegramStartLink to build
// the t.me/<bot>?start=<token> deep link.
import { createClientFromRequest } from 'npm:@base44/sdk@0.8.25';

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me();
    if (!user) return Response.json({ error: 'Unauthorized' }, { status: 401 });

    const token = Deno.env.get('TELEGRAM_BOT_TOKEN');
    if (!token) return Response.json({ error: 'TELEGRAM_BOT_TOKEN missing' }, { status: 500 });

    const res = await fetch(`https://api.telegram.org/bot${token}/getMe`);
    const data = await res.json();
    if (!data.ok) {
      console.error('getMe failed:', data);
      return Response.json({ error: data.description || 'getMe failed' }, { status: 500 });
    }
    return Response.json({ id: data.result.id, username: data.result.username, first_name: data.result.first_name });
  } catch (e) {
    console.error('telegramGetBotInfo error:', e);
    return Response.json({ error: e.message }, { status: 500 });
  }
});