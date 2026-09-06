/**
 * parseBookingWithAi
 *
 * Front-end → this function → n8n webhook → returns parsed booking data.
 *
 * The browser uploads the booking file(s) to Supabase Storage and sends us the
 * signed URLs. We forward { kind, fileUrls, text, env } to n8n, which downloads the
 * files, runs the LLM (prompts + schemas live inside the n8n workflow, keyed by
 * `kind`) and returns structured JSON per the hotel / transfer schema.
 *
 * The N8N_SECRET bearer never reaches the frontend — outgoing calls are signed
 * as an HS256 JWT (see _shared/n8nAuth.ts), exactly like planTripWithAi.
 *
 * POST body: { kind: 'hotel' | 'transfer', fileUrls: string[], text?: string }
 */

import { withHandler } from '../_shared/http.ts';
import { requireUser, supabaseAdmin } from '../_shared/supabaseAdmin.ts';
import { requireTripPro } from '../_shared/proGate.ts';
import { signN8nJwt } from '../_shared/n8nAuth.ts';
import { isCallerParticipant } from '../_shared/tripAccess.ts';
import { aiFlowLimited } from '../_shared/rateLimit.ts';
import { envTag } from '../_shared/envTag.ts';

// TRIP-111: распознавание броней — дорогой вызов (файлы + LLM). 10/час на юзера.
const PARSER_RATE_LIMIT = 10;
const PARSER_RATE_WINDOW = 3600;

const N8N_WEBHOOK_URL = 'https://n8n-production-d1214.up.railway.app/webhook/parse-booking';

const STORAGE_ORIGIN = new URL(Deno.env.get('SUPABASE_URL')!).origin;

/**
 * Is this a URL for an object in OUR Storage? (TRIP-281)
 *
 * `fileUrls` is handed straight to the Mistral OCR node in n8n, which downloads
 * whatever address it is given. Unchecked, a caller could aim it at any host —
 * making us pay to fetch it, or reaching something only n8n can see (SSRF). The
 * browser only ever sends URLs minted by `createSignedUrl`, so pinning them to
 * our own storage origin costs nothing legitimate.
 */
function isOwnStorageUrl(value: unknown): boolean {
  if (typeof value !== 'string') return false;
  try {
    const url = new URL(value);
    return url.origin === STORAGE_ORIGIN && url.pathname.startsWith('/storage/v1/object/');
  } catch {
    return false; // not a URL at all
  }
}

Deno.serve(withHandler('parseBookingWithAi', async (req, corsHeaders) => {
    const user = await requireUser(req);

    const { kind, fileUrls, text, trip_id } = await req.json();

    if (kind !== 'hotel' && kind !== 'transfer') {
      return Response.json({ error: "kind must be 'hotel' or 'transfer'" }, { status: 400, headers: corsHeaders });
    }
    if (!Array.isArray(fileUrls)) {
      return Response.json({ error: 'fileUrls must be an array' }, { status: 400, headers: corsHeaders });
    }
    if (!fileUrls.every(isOwnStorageUrl)) {
      return Response.json({ error: 'fileUrls must point at Triplanio storage' }, { status: 400, headers: corsHeaders });
    }
    if (fileUrls.length === 0 && !(text && String(text).trim())) {
      return Response.json({ error: 'Provide at least one file or some text' }, { status: 400, headers: corsHeaders });
    }

    // Pro/membership gate — server-side, in the execution point (not the UI).
    // parseBookingWithAi forwards to a paid n8n/LLM pipeline, so a free user or a
    // non-member must never reach it. AI booking parsing is a per-trip Pro feature:
    // the trip is Pro ⇔ is_pro_trip OR the owner has an active subscription
    // (single SQL source is_trip_pro, migration 0055). Membership = isCallerParticipant.
    if (!trip_id || typeof trip_id !== 'string') {
      return Response.json({ error: 'trip_id required', code: 'BAD_REQUEST' }, { status: 400, headers: corsHeaders });
    }
    if (!(await isCallerParticipant(trip_id, user.id))) {
      return Response.json({ error: 'Forbidden', code: 'FORBIDDEN' }, { status: 403, headers: corsHeaders });
    }
    // Pro — ОДИН источник отказа `requireTripPro` (тот же `proRefusal`, что дверь
    // send/updateTripSettings): 402 PRO_REQUIRED + x-sentry-skip (было 403 — баг:
    // «нет, нужен Pro» = 402, не 403). Сбой RPC бросается внутри → 500 INTERNAL.
    const proResp = await requireTripPro(supabaseAdmin, trip_id, corsHeaders);
    if (proResp) return proResp;

    // Rate-limit ПОСЛЕ Pro/membership-гейта, ПЕРЕД дорогим LLM-вызовом (TRIP-111).
    // Общий примитив rate_limit_hits (bucket=ai_trip_parser, key=user_id).
    if (await aiFlowLimited('ai_trip_parser', user.id, PARSER_RATE_LIMIT, PARSER_RATE_WINDOW)) {
      return Response.json(
        { error: 'Rate limit exceeded', code: 'RATE_LIMITED' },
        { status: 429, headers: corsHeaders },
      );
    }

    const n8nSecret = Deno.env.get('N8N_SECRET');
    if (!n8nSecret) return Response.json({ error: 'N8N_SECRET not configured' }, { status: 500, headers: corsHeaders });

    const n8nJwt = await signN8nJwt(n8nSecret);
    const res = await fetch(N8N_WEBHOOK_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${n8nJwt}` },
      // `env` — та же метка окружения, что у конверта notify (`_shared/envTag.ts`,
      // секрет SENTRY_ENVIRONMENT): инстанс n8n ОДИН на dev и prod, поэтому без
      // неё воркфлоу не может отличить, из какого проекта пришёл прогон.
      body: JSON.stringify({ kind, fileUrls, text: text ?? '', user_id: user.id, trip_id, env: envTag() }),
    });

    if (!res.ok) {
      const errText = await res.text().catch(() => '');
      console.error('n8n parse-booking error:', res.status, errText);
      return Response.json({ error: 'AI webhook failed' }, { status: 502, headers: corsHeaders });
    }

    const data = await res.json();
    return Response.json(data, { headers: corsHeaders });
}));
