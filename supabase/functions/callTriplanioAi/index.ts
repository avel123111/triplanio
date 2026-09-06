import { HttpError, readJson, refusalResponse, withHandler } from '../_shared/http.ts';
import { supabaseAdmin, getRequestUser } from '../_shared/supabaseAdmin.ts';
import { PRO_REQUIRED, requireTripPro } from '../_shared/proGate.ts';
import { signN8nJwt } from '../_shared/n8nAuth.ts';
import { aiFlowLimited } from '../_shared/rateLimit.ts';
import { callerStep } from '../_shared/tripAccess.ts';
import { clearsStep } from '../_shared/tripStep.ts';
import { envTag } from '../_shared/envTag.ts';

const N8N_WEBHOOK_URL = 'https://n8n-production-d1214.up.railway.app/webhook/group-chat';

// TRIP-111: групповой ИИ-чат — Pro-фича. 30 обращений в час на трип (общий ресурс).
const CHAT_RATE_LIMIT = 30;
const CHAT_RATE_WINDOW = 3600;

/** История, которую видит ассистент. */
const CONTEXT_MESSAGES = 20;

/**
 * Закрыть прогон отказом. Раньше на отказ гейта функция ПОСТИЛА в чат сообщение
 * от имени бота (со своим переводом на три языка) — то есть чинила состояние
 * индикатора подделкой реплики ассистента. Теперь отказ — это статус прогона с
 * машинным кодом, а текст живёт в i18n на фронте (TRIP-296).
 */
async function failRun(messageId: string, code: string) {
  const { error } = await supabaseAdmin.rpc('finish_ai_run', {
    p_message_id: messageId,
    p_error: code,
  });
  if (error) console.error('finish_ai_run failed', code, error.message);
}

Deno.serve(withHandler('callTriplanioAi', async (req, corsHeaders) => {
    const user = await getRequestUser(req);
    if (!user) return Response.json({ error: 'Unauthorized' }, { status: 401, headers: corsHeaders });

    const body = await readJson(req);
    const messageId = typeof body.message_id === 'string' ? body.message_id : '';
    if (!messageId) throw new HttpError(400, 'message_id required', 'INVALID_BODY');

    // Вопрос уже лежит в базе — его написала send_chat_message, она же пометила
    // строку как ждущую ответа. Мы ничего не принимаем от клиента, кроме id.
    const { data: msg } = await supabaseAdmin
      .from('chat_messages')
      .select('id,chat_id,trip_id,text,ai_status')
      .eq('id', messageId)
      .maybeSingle();
    if (!msg) return Response.json({ error: 'Message not found' }, { status: 404, headers: corsHeaders });
    if (!msg.ai_status) {
      throw new HttpError(400, 'Message does not address the assistant', 'NOT_AN_AI_MESSAGE');
    }

    const { data: trip } = await supabaseAdmin
      .from('trips')
      .select('id,created_by,details')
      .eq('id', msg.trip_id)
      .single();
    if (!trip) return Response.json({ error: 'Trip not found' }, { status: 404, headers: corsHeaders });

    // Обращение к ассистенту — ступень `participant`: viewer пишет в чат, и это
    // решение в силе (тот же предикат держит send_chat_message). `callerStep`, а
    // не `isCallerParticipant`, потому что строка трипа уже прочитана выше.
    //
    // Прежняя рукописная копия разбирала только `data` и роняла ошибку запроса
    // на пол: транзиентный сбой БД читался как «ты не участник» и отдавал 403
    // живому участнику. Шов держит контракт TRIP-208 и падает громко в 5xx.
    if (!clearsStep(await callerStep(msg.trip_id, user.id, trip.created_by), 'participant')) {
      return Response.json({ error: 'Forbidden' }, { status: 403, headers: corsHeaders });
    }

    // ── Pro/addon-гейт (TRIP-47) ──
    // Групповой ИИ-чат — Pro-фича. Доступен ⇔ трип Pro (is_trip_pro: is_pro_trip
    // ИЛИ активная подписка владельца) И включён аддон chat. Без гейта любой
    // участник free-трипа дёргал платный n8n/LLM напрямую.
    //
    // Pro — ОДИН источник отказа `requireTripPro` (тот же `proRefusal`, что и дверь
    // send `trip-chat`): 402 PRO_REQUIRED + x-sentry-skip; сбой RPC бросается → 500
    // (не ложный «не Pro»). Исход по-прежнему пишется на строку (`failRun` — async,
    // индикатор снимается им), а HTTP-эмиссия — через канон (nudge её игнорирует).
    const proResp = await requireTripPro(supabaseAdmin, msg.trip_id, corsHeaders);
    if (proResp) {
      await failRun(messageId, 'PRO_REQUIRED');
      return proResp;
    }
    // Аддон chat — отдельный от Pro тумблер (может быть выключен на Pro-трипе);
    // фича выключена → та же форма отказа (`PRO_REQUIRED`) через канон, не копия.
    if (!trip.details?.addons?.chat) {
      await failRun(messageId, 'PRO_REQUIRED');
      return refusalResponse(PRO_REQUIRED, corsHeaders);
    }

    // ── Rate-limit (TRIP-111): 30/час на трип, ПЕРЕД дорогим LLM-вызовом ──
    // Общий примитив rate_limit_hits (bucket=ai_inapp_chat, key=trip_id).
    if (await aiFlowLimited('ai_inapp_chat', msg.trip_id, CHAT_RATE_LIMIT, CHAT_RATE_WINDOW)) {
      await failRun(messageId, 'RATE_LIMITED');
      return Response.json({ ok: false, code: 'RATE_LIMITED' }, { headers: corsHeaders });
    }

    // Атомарный захват: две вкладки / повторный клик / гонка ретрая дадут ровно
    // один запуск LLM — второй вызов не обновит строку и уйдёт ни с чем.
    const { data: claimed, error: claimErr } = await supabaseAdmin.rpc('claim_ai_run', { p_message_id: messageId });
    if (claimErr) {
      console.error('claim_ai_run failed', claimErr.message);
      return Response.json({ error: 'Could not start the assistant' }, { status: 500, headers: corsHeaders });
    }
    if (!claimed) return Response.json({ ok: true, code: 'ALREADY_HANDLED' }, { headers: corsHeaders });

    const { data: recentMessages } = await supabaseAdmin
      .from('chat_messages')
      .select('id,user_id,user_full_name,text,created_at')
      .eq('chat_id', msg.chat_id)
      .order('created_at', { ascending: false })
      .limit(CONTEXT_MESSAGES);
    const messages = (recentMessages || []).reverse();

    // Окружение проекта одним полем: n8n сам собирает адрес любой функции как
    // `{{ domain }}/functions/v1/<slug>`. Перечислять здесь по URL на каждую
    // функцию нельзя — при добавлении новых нод пришлось бы дописывать поле в
    // payload на каждую. Раньше адреса были зашиты в n8n на ПРОД, поэтому ответ
    // на dev-вопрос уходил в прод-проект и умирал там с 404 «Chat not found» —
    // dev-чат с ассистентом не работал ни дня, а сгенерированные (и оплаченные)
    // ответы выбрасывались (TRIP-296).
    //
    // `env` — та же метка окружения, что у конверта notify и остальных вызовов
    // n8n (`_shared/envTag.ts`, секрет SENTRY_ENVIRONMENT). Здесь окружение до
    // сих пор читалось ТОЛЬКО из формы `domain`, то есть ветвиться по нему
    // воркфлоу мог лишь разбором адреса; теперь у всех вызовов один предикат.
    // `domain` остаётся: по нему n8n собирает адрес колбэка.
    const payload = {
      message_id: messageId,
      chat_id: msg.chat_id,
      trip_id: msg.trip_id,
      domain: Deno.env.get('SUPABASE_URL'),
      env: envTag(),
      user_message: msg.text || '',
      requested_by: {
        user_id: user.id,
        email: user.email,
        full_name: user.user_metadata?.full_name || null,
      },
      messages,
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
      await failRun(messageId, 'WEBHOOK_ERROR');
      return Response.json({ error: 'AI webhook failed' }, { status: 502, headers: corsHeaders });
    }

    return Response.json({ ok: true }, { headers: corsHeaders });
}));
