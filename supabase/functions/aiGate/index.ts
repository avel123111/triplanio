/**
 * aiGate — привратник Telegram-бота (TRIP-111).
 *
 * Telegram шлёт сообщение напрямую в n8n (нода Telegram Trigger), а наш бэкенд
 * в этой цепочке не стоит на пути LLM. Поэтому n8n ОДНОЙ нодой (после
 * Telegram Trigger, до AI Agent) дёргает этот эндпоинт; по allow=false n8n
 * отвечает готовым текстом и НЕ идёт в Gemini.
 *
 * Здесь — только rate-limit (30 сообщений в час на telegram_chat_id) через
 * общий примитив rate_limit_hits (aiFlowLimited). Pro отдельно НЕ проверяем:
 * при потере Pro привязка Telegram сносится откатом (revokeLostProFeatures →
 * disconnectTripTelegram), поэтому «есть привязка ⇒ трип Pro» — инвариант.
 * Отсечка непривязанных чатов до Gemini — отдельная задача TRIP-132.
 *
 * Auth: Bearer <N8N_SECRET> (verify_jwt=false в config.toml).
 *
 * POST body: { chat_id: string | number, language_code?: string }
 * Ответ:     { allow: boolean, message?: string }
 *            message локализован здесь (ru/en/es) — n8n шлёт {{ $json.message }}.
 */
import { corsFor } from '../_shared/cors.ts';
import { requireN8nSecret } from '../_shared/n8nAuth.ts';
import { supabaseAdmin } from '../_shared/supabaseAdmin.ts';
import { captureEdgeError } from '../_shared/sentry.ts';
import { type Lang, resolveLang } from '../_shared/tgLang.ts';
import { aiFlowLimited } from '../_shared/rateLimit.ts';

const BOT_RATE_LIMIT = 30;
const BOT_RATE_WINDOW = 3600;

const RATE_MSG: Record<Lang, string> = {
  ru: 'Слишком много сообщений. Попробуй через несколько минут.',
  en: 'Too many messages. Try again in a few minutes.',
  es: 'Demasiados mensajes. Inténtalo de nuevo en unos minutos.',
};

Deno.serve(async (req) => {
  const corsHeaders = corsFor(req);
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });

  const denied = requireN8nSecret(req);
  if (denied) return denied;

  try {
    const { chat_id, language_code } = await req.json();
    if (!chat_id) {
      return Response.json({ error: 'chat_id is required' }, { status: 400, headers: corsHeaders });
    }
    const chatId = String(chat_id);

    // 30/час на чат. Общий примитив rate_limit_hits (bucket=ai_tg_chatbot, key=chat_id).
    if (!(await aiFlowLimited('ai_tg_chatbot', chatId, BOT_RATE_LIMIT, BOT_RATE_WINDOW))) {
      return Response.json({ allow: true }, { headers: corsHeaders });
    }

    // Лимит выбран — язык берём от привязавшего юзера, фолбэк = language_code из TG.
    const { data: integration } = await supabaseAdmin
      .from('trip_telegram_integrations')
      .select('user_id')
      .eq('telegram_chat_id', chatId)
      .order('linked_at', { ascending: false })
      .limit(1)
      .maybeSingle();
    const lang = await resolveLang(integration?.user_id, language_code);

    return Response.json(
      { allow: false, message: RATE_MSG[lang] },
      { headers: corsHeaders },
    );
  } catch (err) {
    await captureEdgeError(err, 'aiGate');
    console.error('aiGate error:', err);
    // fail-open: при сбое привратника не блокируем бота.
    return Response.json({ allow: true }, { headers: corsHeaders });
  }
});
