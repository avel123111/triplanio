// Admin-only diagnostic. Returns Telegram's current webhook configuration for
// our bot: URL, pending update count, last delivery error (if any). Useful to
// debug why /start updates are not reaching telegramWebhook.
import { createClientFromRequest } from 'npm:@base44/sdk@0.8.25';

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me();
    if (!user || user.role !== 'admin') {
      return Response.json({ error: 'Forbidden: Admin access required' }, { status: 403 });
    }

    const token = Deno.env.get('TELEGRAM_BOT_TOKEN');
    if (!token) return Response.json({ error: 'Missing TELEGRAM_BOT_TOKEN' }, { status: 500 });

    const res = await fetch(`https://api.telegram.org/bot${token}/getWebhookInfo`);
    const data = await res.json();
    return Response.json(data);
  } catch (e) {
    console.error('telegramGetWebhookInfo error:', e);
    return Response.json({ error: e.message }, { status: 500 });
  }
});