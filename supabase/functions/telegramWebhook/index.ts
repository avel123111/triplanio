/**
 * telegramWebhook
 *
 * INTERNAL binding endpoint. Called by n8n (NOT by Telegram directly). Auth via
 * `Authorization: Bearer <N8N_SECRET>` (requireN8nSecret); verify_jwt=false.
 *
 * Returns a fully-localized `message` string so n8n just sends `{{ $json.message }}`
 * — no per-language text in the workflow. Language is resolved from the linking
 * user's `users.language` (token branches) or the Telegram `language_code`
 * (welcome / no-token). Adding a language = add a block to T below.
 *
 * Identity is (trip_id, telegram_chat_id) — many chats per trip, many trips per chat.
 */

import { corsFor } from '../_shared/cors.ts';
import { requireN8nSecret } from '../_shared/n8nAuth.ts';
import { supabaseAdmin } from '../_shared/supabaseAdmin.ts';
import { captureEdgeError } from '../_shared/sentry.ts';
import { captureServer } from '../_shared/analytics.ts';
import { type Lang, pickLang, resolveLang } from '../_shared/tgLang.ts';

const T: Record<Lang, {
  linked: (title: string) => string;
  welcome: string;
  invalid: string;
  used: string;
  expired: string;
}> = {
  ru: {
    linked: (t) => `✅ Готово! Подключено к поездке «${t}». Буду присылать напоминания о событиях.`,
    welcome: 'Привет! Я Triplanio-бот. Чтобы подключить меня к поездке — в приложении откройте настройки поездки → «Привязать Telegram».',
    invalid: '❌ Ссылка недействительна. Сгенерируйте новую в настройках поездки.',
    used: '❌ Эта ссылка уже использована. Сгенерируйте новую в настройках поездки.',
    expired: '❌ Срок действия ссылки истёк. Сгенерируйте новую в настройках поездки.',
  },
  en: {
    linked: (t) => `✅ Done! Connected to "${t}". I'll send you reminders about events.`,
    welcome: 'Hi! I am the Triplanio bot. To connect me to a trip, open the trip settings in the app → "Connect Telegram".',
    invalid: '❌ This link is invalid. Generate a new one in the trip settings.',
    used: '❌ This link has already been used. Generate a new one in the trip settings.',
    expired: '❌ This link has expired. Generate a new one in the trip settings.',
  },
  es: {
    linked: (t) => `✅ ¡Listo! Conectado a «${t}». Te enviaré recordatorios de los eventos.`,
    welcome: 'Hola! Soy el bot de Triplanio. Para conectarme a un viaje, abre los ajustes del viaje en la app → «Conectar Telegram».',
    invalid: '❌ El enlace no es válido. Genera uno nuevo en los ajustes del viaje.',
    used: '❌ Este enlace ya se ha usado. Genera uno nuevo en los ajustes del viaje.',
    expired: '❌ El enlace ha caducado. Genera uno nuevo en los ajustes del viaje.',
  },
};

// sentry: manual — must always answer Telegram 200 (else it retries); captures inline.
Deno.serve(async (req) => {
  const corsHeaders = corsFor(req);
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
    const langCode = msg.from?.language_code || '';

    if (!text.startsWith('/start')) {
      return Response.json({ ok: true, action: 'ignored' }, { headers: corsHeaders });
    }

    const linkToken = text.split(/\s+/)[1];
    if (!linkToken) {
      const lang = pickLang(langCode);
      return Response.json({ ok: true, action: 'welcome', message: T[lang].welcome }, { headers: corsHeaders });
    }

    const { data: tokens } = await supabaseAdmin
      .from('telegram_link_tokens')
      .select('*')
      .eq('token', linkToken)
      .limit(1);
    const tok = tokens?.[0];

    if (!tok) {
      const lang = pickLang(langCode);
      return Response.json({ ok: false, reason: 'invalid', message: T[lang].invalid }, { headers: corsHeaders });
    }
    if (tok.used_at) {
      const lang = await resolveLang(tok.user_id, langCode);
      return Response.json({ ok: false, reason: 'used', message: T[lang].used }, { headers: corsHeaders });
    }
    if (new Date(tok.expires_at).getTime() < Date.now()) {
      const lang = await resolveLang(tok.user_id, langCode);
      return Response.json({ ok: false, reason: 'expired', message: T[lang].expired }, { headers: corsHeaders });
    }

    const { error: upsertErr } = await supabaseAdmin
      .from('trip_telegram_integrations')
      .upsert({
        trip_id: tok.trip_id,
        user_id: tok.user_id,
        telegram_chat_id: chatId,
        telegram_username: tgUsername,
        telegram_first_name: tgFirstName,
        is_active: true,
        linked_at: new Date().toISOString(),
      }, { onConflict: 'trip_id,telegram_chat_id' });
    if (upsertErr) throw upsertErr;

    await supabaseAdmin
      .from('telegram_link_tokens')
      .update({ used_at: new Date().toISOString() })
      .eq('id', tok.id);

    // Telegram connected to a trip (TRIP-213 Ф2). tok carries the real app uid +
    // trip, so the event attributes to the person and the trip group.
    captureServer('telegram_connected', tok.user_id, { trip_id: tok.trip_id }, { trip: tok.trip_id });

    const { data: trip } = await supabaseAdmin
      .from('trips').select('title').eq('id', tok.trip_id).maybeSingle();
    const tripTitle = trip?.title || '';
    const lang = await resolveLang(tok.user_id, langCode);

    return Response.json(
      { ok: true, action: 'linked', trip_title: tripTitle, message: T[lang].linked(tripTitle) },
      { headers: corsHeaders },
    );

  } catch (e) {
    await captureEdgeError(e, 'telegramWebhook');
    console.error('telegramWebhook error:', e);
    return Response.json(
      { ok: false, reason: 'error', error: (e as Error).message },
      { status: 500, headers: corsHeaders },
    );
  }
});
