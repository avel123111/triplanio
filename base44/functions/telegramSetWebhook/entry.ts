// One-shot admin function. Registers our public telegramWebhook URL with
// Telegram so that /start and messages reach our backend. Run manually from
// Dashboard → Code → Functions → telegramSetWebhook.
import { createClientFromRequest } from 'npm:@base44/sdk@0.8.25';

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me();
    if (!user || user.role !== 'admin') {
      return Response.json({ error: 'Forbidden: Admin access required' }, { status: 403 });
    }

    const token = Deno.env.get('TELEGRAM_BOT_TOKEN');
    const secret = Deno.env.get('TELEGRAM_WEBHOOK_SECRET');
    const appUrl = Deno.env.get('PUBLIC_APP_URL');
    if (!token || !secret || !appUrl) {
      return Response.json({ error: 'Missing TELEGRAM_BOT_TOKEN / TELEGRAM_WEBHOOK_SECRET / PUBLIC_APP_URL' }, { status: 500 });
    }

    const appId = Deno.env.get('BASE44_APP_ID');
    // Public function endpoint on base44 — secret is passed in query string.
    const webhookUrl = `${appUrl.replace(/\/$/, '')}/functions/telegramWebhook?s=${encodeURIComponent(secret)}`;

    const res = await fetch(`https://api.telegram.org/bot${token}/setWebhook`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        url: webhookUrl,
        allowed_updates: ['message'],
        drop_pending_updates: true,
      }),
    });
    const data = await res.json();
    console.log('setWebhook response:', data, 'url:', webhookUrl);
    if (!data.ok) return Response.json({ error: data.description, telegram: data, attemptedUrl: webhookUrl }, { status: 500 });

    // Also fetch current webhook info so the user can see it worked.
    const infoRes = await fetch(`https://api.telegram.org/bot${token}/getWebhookInfo`);
    const info = await infoRes.json();

    return Response.json({ ok: true, webhookUrl, info: info.result, appId });
  } catch (e) {
    console.error('telegramSetWebhook error:', e);
    return Response.json({ error: e.message }, { status: 500 });
  }
});