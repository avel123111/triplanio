import { withHandler } from '../_shared/http.ts';
import { supabaseAdmin, getRequestUser } from '../_shared/supabaseAdmin.ts';
import { signN8nJwt } from '../_shared/n8nAuth.ts';
import { aiFlowLimited } from '../_shared/rateLimit.ts';

const N8N_WEBHOOK_URL = 'https://n8n-production-d1214.up.railway.app/webhook/group-chat';

const BOT_EMAIL = 'info@triplanio.com';
const BOT_NAME = 'Triplanio';

// TRIP-111: групповой ИИ-чат — Pro-фича. 30 обращений в час на трип (общий ресурс).
const CHAT_RATE_LIMIT = 30;
const CHAT_RATE_WINDOW = 3600;

type Lang = 'ru' | 'en' | 'es';

// Бот отвечает в чат на родном языке вызвавшего (как и обычный ответ ассистента).
const MSG: Record<'pro' | 'rate', Record<Lang, string>> = {
  pro: {
    ru: 'ИИ-ассистент доступен на Pro-подписке.',
    en: 'The AI assistant is available on a Pro subscription.',
    es: 'El asistente de IA está disponible con la suscripción Pro.',
  },
  rate: {
    ru: 'Слишком много обращений к ИИ-ассистенту. Попробуй через несколько минут.',
    en: 'Too many requests to the AI assistant. Try again in a few minutes.',
    es: 'Demasiadas solicitudes al asistente de IA. Inténtalo de nuevo en unos minutos.',
  },
};

function pickLang(code?: string | null): Lang {
  const c = (code || '').slice(0, 2).toLowerCase();
  return c === 'ru' || c === 'es' || c === 'en' ? (c as Lang) : 'ru';
}

/** Вставляет реплику бота в чат — она же гасит индикатор «Triplanio печатает»
 *  на фронте (последнее сообщение становится ботовским). */
async function postBotMessage(chatId: string, tripId: string, text: string) {
  const { data: botUser } = await supabaseAdmin
    .from('users').select('id').eq('email', BOT_EMAIL).maybeSingle();
  if (!botUser) {
    console.error('callTriplanioAi: bot user not found, cannot post gate message');
    return;
  }
  await supabaseAdmin.from('chat_messages').insert({
    chat_id: chatId,
    trip_id: tripId,
    user_id: botUser.id,
    user_full_name: BOT_NAME,
    text,
    created_by: botUser.id,
  });
}

Deno.serve(withHandler('callTriplanioAi', async (req, corsHeaders) => {
    const user = await getRequestUser(req);
    if (!user) return Response.json({ error: 'Unauthorized' }, { status: 401, headers: corsHeaders });

    const { chat_id, user_message } = await req.json();
    if (!chat_id) return Response.json({ error: 'chat_id required' }, { status: 400, headers: corsHeaders });

    const { data: chat } = await supabaseAdmin
      .from('chats')
      .select('id,trip_id')
      .eq('id', chat_id)
      .single();
    if (!chat) return Response.json({ error: 'Chat not found' }, { status: 404, headers: corsHeaders });

    const { data: trip } = await supabaseAdmin
      .from('trips')
      .select('id,created_by,details')
      .eq('id', chat.trip_id)
      .single();
    if (!trip) return Response.json({ error: 'Trip not found' }, { status: 404, headers: corsHeaders });

    const isCreator = trip.created_by === user.id;
    if (!isCreator) {
      const { data: member } = await supabaseAdmin
        .from('trip_members')
        .select('id')
        .eq('trip_id', chat.trip_id)
        .eq('user_id', user.id)
        .eq('status', 'active')
        .maybeSingle();
      if (!member) return Response.json({ error: 'Forbidden' }, { status: 403, headers: corsHeaders });
    }

    // Язык вызвавшего — для реплик бота при отказе.
    const { data: caller } = await supabaseAdmin
      .from('users').select('language').eq('id', user.id).maybeSingle();
    const lang = pickLang(caller?.language);

    // ── Pro/addon-гейт (TRIP-47) ──
    // Групповой ИИ-чат — Pro-фича. Доступен ⇔ трип Pro (is_trip_pro: is_pro_trip
    // ИЛИ активная подписка владельца) И включён аддон chat. Без гейта любой
    // участник free-трипа дёргал платный n8n/LLM напрямую.
    const { data: tripPro, error: proErr } = await supabaseAdmin.rpc('is_trip_pro', { p_trip_id: chat.trip_id });
    if (proErr) {
      console.error('is_trip_pro rpc error:', proErr);
      return Response.json({ error: 'Pro check failed' }, { status: 500, headers: corsHeaders });
    }
    const chatAddonOn = Boolean(trip.details?.addons?.chat);
    if (!tripPro || !chatAddonOn) {
      await postBotMessage(chat_id, chat.trip_id, MSG.pro[lang]);
      return Response.json({ ok: false, code: 'PRO_REQUIRED' }, { headers: corsHeaders });
    }

    // ── Rate-limit (TRIP-111): 30/час на трип, ПЕРЕД дорогим LLM-вызовом ──
    // Общий примитив rate_limit_hits (bucket=ai_inapp_chat, key=trip_id).
    if (await aiFlowLimited('ai_inapp_chat', chat.trip_id, CHAT_RATE_LIMIT, CHAT_RATE_WINDOW)) {
      await postBotMessage(chat_id, chat.trip_id, MSG.rate[lang]);
      return Response.json({ ok: false, code: 'RATE_LIMITED' }, { headers: corsHeaders });
    }

    const { data: recentMessages } = await supabaseAdmin
      .from('chat_messages')
      .select('id,user_id,user_full_name,text,created_at')
      .eq('chat_id', chat_id)
      .order('created_at', { ascending: false })
      .limit(20);
    const messages = (recentMessages || []).reverse();

    const payload = {
      chat_id,
      trip_id: chat.trip_id,
      user_message: user_message || '',
      messages,
      requested_by: {
        user_id: user.id,
        email: user.email,
        full_name: user.user_metadata?.full_name || null,
      },
    };

    const n8nSecret = Deno.env.get('N8N_SECRET');
    if (!n8nSecret) return Response.json({ error: 'N8N_SECRET not configured' }, { status: 500, headers: corsHeaders });

    const n8nJwt = await signN8nJwt(n8nSecret);
    const res = await fetch(N8N_WEBHOOK_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${n8nJwt}` },
      body: JSON.stringify({ payload }),
    });

    if (!res.ok) {
      const errText = await res.text().catch(() => '');
      console.error('n8n error:', res.status, errText);
      return Response.json({ error: 'AI webhook failed' }, { status: 502, headers: corsHeaders });
    }

    return Response.json({ ok: true }, { headers: corsHeaders });
}));
