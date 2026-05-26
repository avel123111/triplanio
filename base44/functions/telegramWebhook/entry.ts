// Public endpoint called by Telegram when a user sends a message to the bot.
// Authenticity is enforced by a shared secret in the ?s= query string.
//
// Behaviour:
//   "/start <token>"  → consume TelegramLinkToken, create/update
//                       TripTelegramIntegration with the chat_id and reply
//                       with a confirmation.
//   "/start"          → reply with a hint on how to connect.
//   anything else     → ignored silently (the bot used to call an LLM here;
//                       that functionality has been removed).
//
// Note: this function is called BY TELEGRAM, not by an authenticated user.
// We use base44.asServiceRole for all DB writes, gated by the secret check.

import { createClientFromRequest } from 'npm:@base44/sdk@0.8.25';

const TG_API = (token) => `https://api.telegram.org/bot${token}`;

async function sendMessage(token, chatId, text, parseMode = 'HTML') {
  try {
    const body = { chat_id: chatId, text, disable_web_page_preview: true };
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
    // 1. Verify secret.
    const url = new URL(req.url);
    const s = url.searchParams.get('s');
    const expected = Deno.env.get('TELEGRAM_WEBHOOK_SECRET');
    if (!expected || s !== expected) {
      console.warn('telegramWebhook: bad or missing secret');
      return new Response('forbidden', { status: 403 });
    }

    const botToken = Deno.env.get('TELEGRAM_BOT_TOKEN');
    if (!botToken) return new Response('missing token', { status: 500 });

    // Service-role client — webhook is unauthenticated by design.
    const base44 = createClientFromRequest(req);

    const update = await req.json().catch(() => null);
    if (!update?.message) {
      // Acknowledge other update types to avoid Telegram retry storms.
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
      const tokens = await base44.asServiceRole.entities.TelegramLinkToken.filter({ token: linkToken });
      const tok = tokens[0];
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

      // Upsert TripTelegramIntegration.
      const existing = await base44.asServiceRole.entities.TripTelegramIntegration.filter({
        trip_id: tok.trip_id,
        user_id: tok.user_id,
      });
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
      if (existing[0]) {
        await base44.asServiceRole.entities.TripTelegramIntegration.update(existing[0].id, payload);
      } else {
        await base44.asServiceRole.entities.TripTelegramIntegration.create(payload);
      }
      await base44.asServiceRole.entities.TelegramLinkToken.update(tok.id, { used_at: new Date().toISOString() });

      let tripTitle = '';
      try {
        const trip = await base44.asServiceRole.entities.Trip.get(tok.trip_id);
        tripTitle = trip?.title || '';
      } catch { /* ignore */ }

      await sendMessage(
        botToken,
        chatId,
        `✅ Готово! Теперь я подключён к поездке <b>${tripTitle || tok.trip_id}</b>.\n\nЯ буду присылать напоминания о важных событиях: заезды и выезды из отелей, трансферы, активности, аренда авто.`,
      );
      return Response.json({ ok: true });
    }

    // 3. Any other message → silently ignored (no LLM).
    return Response.json({ ok: true });
  } catch (e) {
    console.error('telegramWebhook error:', e);
    // Always 200 to Telegram — otherwise it will retry the same update forever.
    return Response.json({ ok: true, error: e.message });
  }
});