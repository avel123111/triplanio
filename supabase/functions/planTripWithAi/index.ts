/**
 * planTripWithAi
 *
 * Front-end → this function → n8n webhook (v2) → returns { ops, ai_comment }.
 *
 * TRIP-527: драфт маршрута живёт на фронте и приезжает сюда каждой репликой
 * (`draft`), модель отвечает ОПЕРАЦИЯМИ над ним, а не маршрутом целиком;
 * применяет их фронт (`src/pages/create/aiOps.js`). Edge словаря операций не
 * знает: он пробрасывает драфт как есть, проверив только форму и размер на
 * границе доверия (`draft.ts`) — ввод пользователя уходит в платный LLM-вызов.
 *
 * The N8N_SECRET bearer token lives only as a Supabase secret. The frontend
 * never sees it. n8n stores its own conversation history keyed by sessionId
 * (Postgres on the n8n side); `env` — метка окружения, как в конверте notify.
 *
 * POST body: { sessionId: string, prompt: string, language?: string, draft?: Draft }
 */

import { jsonError, refusalResponse, withHandler } from '../_shared/http.ts';
import { requireUser } from '../_shared/supabaseAdmin.ts';
import { signN8nJwt, n8nWebhookUrl } from '../_shared/n8nAuth.ts';
import { aiFlowLimited } from '../_shared/rateLimit.ts';
import { envTag } from '../_shared/envTag.ts';
import { normalizeDraft } from './draft.ts';

// TRIP-111: лимит генераций ИИ-планировщика. Вешается на САМ вызов генерации
// (не на сохранение трипа), поэтому закрывает и delete+recreate, и спам без
// сохранения. 50 реплик в час на пользователя (TRIP-527: реплика стала
// дешевле и короче — операции, а не маршрут целиком; разговор без операций
// тоже вызов, и живой диалог с правками легко уходит за 20).
const PLANNER_RATE_LIMIT = 50;
const PLANNER_RATE_WINDOW = 3600;

Deno.serve(withHandler('planTripWithAi', async (req, corsHeaders) => {
    const user = await requireUser(req);

    const { sessionId, prompt, language, draft: rawDraft } = await req.json();
    if (!prompt) return Response.json({ error: 'prompt required' }, { status: 400, headers: corsHeaders });
    // Форма драфта — общий шов валидации (`draft.ts` → `validateFields`), отказ
    // едет тем же `refusalResponse`, что у записи (400 INVALID_INPUT).
    const parsed = normalizeDraft(rawDraft);
    if ('status' in parsed) return refusalResponse(parsed, corsHeaders);
    const { draft } = parsed;

    // Rate-limit ПЕРЕД дорогим LLM-вызовом (TRIP-111). Общий примитив
    // rate_limit_hits (bucket=ai_trip_planner, key=user_id).
    if (await aiFlowLimited('ai_trip_planner', user.id, PLANNER_RATE_LIMIT, PLANNER_RATE_WINDOW)) {
      return jsonError(429, 'Rate limit exceeded', 'RATE_LIMITED', corsHeaders);
    }

    const n8nSecret = Deno.env.get('N8N_SECRET');
    if (!n8nSecret) return Response.json({ error: 'N8N_SECRET not configured' }, { status: 500, headers: corsHeaders });

    const n8nJwt = await signN8nJwt(n8nSecret);
    // v2 (TRIP-527): контракт «драфт → операции». v1 (`ai-trip-planner`) живёт,
    // пока прод-фронт с полной заменой не уехал; после мерджа в main — в архив.
    const res = await fetch(n8nWebhookUrl('ai-trip-planner-v2'), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${n8nJwt}` },
      // userId is forwarded so the AI Usage Logger poller can attribute the
      // trip_planner ai_usage_events row to the caller (it reads runData.Webhook
      // body, same as trip_parser reads `kind`). trip_id stays null — no trip
      // exists yet at generation time (this is a pre-save preview).
      //
      // `env` — та же метка окружения, что у конверта notify (`_shared/envTag.ts`,
      // секрет SENTRY_ENVIRONMENT): инстанс n8n ОДИН на dev и prod, поэтому без
      // неё воркфлоу не может отличить, из какого проекта пришёл прогон.
      body: JSON.stringify({ sessionId, prompt, language, draft, userId: user.id, env: envTag() }),
    });

    if (!res.ok) {
      const errText = await res.text().catch(() => '');
      console.error('n8n error:', res.status, errText);
      return Response.json({ error: 'AI webhook failed' }, { status: 502, headers: corsHeaders });
    }

    const data = await res.json();
    return Response.json(data, { headers: corsHeaders });
}));
