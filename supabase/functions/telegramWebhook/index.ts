/**
 * telegramWebhook
 *
 * Public endpoint called by Telegram when a user sends a message to the bot.
 * Authenticity enforced via ?s= query-string secret.
 *
 * /start <token> → consume TelegramLinkToken, upsert TripTelegramIntegration.
 * /start         → reply with connection hint.
 * other          → silently ignored.
 *
 * verify_jwt: false — called by Telegram, not by an authenticated user.
 */

import { supabaseAdmin } from '../_shared/supabaseAdmin.ts';

const TG_API = (token: string) => `https://api.telegram.org/bot${token}`;

async function sendMessage(token: string, chatId: string, text: string, parseMode = 'HTML') {
  try {
    const body: Record<string, unknown> = { chat_id: chatId, text, disable_web_page_preview: true };
    if (parseMode) body.parse_mode = parseMode;
    const res = await fetch(`${TG_API(token)}/sendMessage`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    const data = await res.json();
    if (!data.ok) console.error('sendMessage failed:', data);
    return data;
  } catch (e) {
    console.error('sendMessage error:', e);
  }
}

Deno.serve(async (req) => {
  try {
    // 1. Verify shared secret
    const url = new URL(req.url);
    const s = url.searchParams.get('s');
    const expected = Deno.env.get('TELEGRAM_WEBHOOK_SECRET');
    if (!expected || s !== expected) {
      console.warn('telegramWebhook: bad or missing secret');
      return new Response('forbidden', { status: 403 });
    }

    const botToken = Deno.env.get('TELEGRAM_BOT_TOKEN');
    if (!botToken) return new Response('missing token', { status: 500 });

    const update = await req.json().catch(() => null);
    if (!update?.message) {
      // Acknowledge other update types to avoid Telegram retry storms
      return Response.json({ ok: true });
    }

    const msg = update.message;
    const chatId = String(msg.chat.id);
    const text = (msg.text || '').trim();
    const tgUsername = msg.from?.username || '';
    const tgFirstName = msg.from?.first_name || '';

    // 2. /start <token>  →  bind chat to trip
    if (text.startsWith('/start')) {
      const parts = text.split(/\s+/);
      const linkToken = parts[1];

      if (!linkToken) {
        await sendMessage(botToken, chatId, 'Привет! Чтобы подключить меня к поездке, откройте настройки поездки в приложении и нажмите "Подключить Telegram".');
        return Response.json({ ok: true });
      }

      const { data: tokens } = await supabaseAdmin
        .from('telegram_link_tokens')
        .select('*')
        .eq('token', linkToken)
        .limit(1);
      const tok = tokens?.[0];

      if (!tok) {
        await sendMessage(botToken, chatId, '❌ Ссылка недействительна. Сгенерируйте новую в настройках поездки.');
        return Response.json({ ok: true });
      }
      if (tok.used_at) {
        await sendMessage(botToken, chatId, '❌ Эта ссылка уже использована. Сгенерируйте новую в настройках поездки.');
        return Response.json({ ok: true });
      }
      if (new Date(tok.expires_at).getTime() < Date.now()) {
        await sendMessage(botToken, chatId, '❌ Срок действия ссылки истёк. Сгенерируйте новую в настройках поездки.');
        return Response.json({ ok: true });
      }

      // Upsert TripTelegramIntegration
      const { data: existing } = await supabaseAdmin
        .from('trip_telegram_integrations')
        .select('id')
        .eq('trip_id', tok.trip_id)
        .eq('user_id', tok.user_id)
        .limit(1);

      const payload = {
        trip_id: tok.trip_id,
        user_id: tok.user_id,
        user_email: tok.user_email,
        telegram_chat_id: chatId,
        telegram_username: tgUsername,
        telegram_first_name: tgFirstName,
        is_active: true,
        linked_at: new Date().toISOString(),
      };

      if (existing?.[0]) {
        await supabaseAdmin
          .from('trip_telegram_integrations')
          .update(payload)
          .eq('id', existing[0].id);
      } else {
        await supabaseAdmin
          .from('trip_telegram_integrations')
          .insert(payload);
      }

      await supabaseAdmin
        .from('telegram_link_tokens')
        .update({ used_at: new Date().toISOString() })
        .eq('id', tok.id);

      let tripTitle = '';
      try {
        const { data: trip } = await supabaseAdmin
          .from('trips').select('title').eq('id', tok.trip_id).single();
        tripTitle = trip?.title || '';
      } catch { /* ignore */ }

      await sendMessage(
        botToken,
        chatId,
        `✅ Готово! Теперь я подключён к поездке <b>${tripTitle || tok.trip_id}</b>.\n\nЯ буду присылать напоминания о важных событиях: заезды и выезды из отелей, трансферы, активности, аренда авто.`,
      );
      return Response.json({ ok: true });
    }

    // 3. Any other message → silently ignored
    return Response.json({ ok: true });

  } catch (e) {
    console.error('telegramWebhook error:', e);
    // Always 200 to Telegram — otherwise it will retry the same update forever
    return Response.json({ ok: true, error: (e as Error).message });
  }
});
