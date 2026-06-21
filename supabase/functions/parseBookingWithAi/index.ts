/**
 * parseBookingWithAi
 *
 * Front-end → this function → n8n webhook → returns parsed booking data.
 *
 * The browser uploads the booking file(s) to Supabase Storage and sends us the
 * signed URLs. We forward { kind, fileUrls, text } to n8n, which downloads the
 * files, runs the LLM (prompts + schemas live inside the n8n workflow, keyed by
 * `kind`) and returns structured JSON per the hotel / transfer schema.
 *
 * The N8N_SECRET bearer never reaches the frontend — outgoing calls are signed
 * as an HS256 JWT (see _shared/n8nAuth.ts), exactly like planTripWithAi.
 *
 * POST body: { kind: 'hotel' | 'transfer', fileUrls: string[], text?: string }
 */

import { createClient } from 'npm:@supabase/supabase-js@2';
import { signN8nJwt } from '../_shared/n8nAuth.ts';
import { captureEdgeError } from '../_shared/sentry.ts';
import { isCallerParticipant } from '../_shared/tripAccess.ts';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

const supabaseAdmin = createClient(
  Deno.env.get('SUPABASE_URL')!,
  Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
  { auth: { persistSession: false } },
);

async function getRequestUser(req: Request) {
  const auth = req.headers.get('Authorization');
  if (!auth) return null;
  const { data: { user }, error } = await supabaseAdmin.auth.getUser(auth.replace('Bearer ', ''));
  if (error || !user) return null;
  return user;
}

const N8N_WEBHOOK_URL = 'https://n8n-production-d1214.up.railway.app/webhook/parse-booking';

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });

  try {
    const user = await getRequestUser(req);
    if (!user) return Response.json({ error: 'Unauthorized' }, { status: 401, headers: corsHeaders });

    const { kind, fileUrls, text, trip_id } = await req.json();

    if (kind !== 'hotel' && kind !== 'transfer') {
      return Response.json({ error: "kind must be 'hotel' or 'transfer'" }, { status: 400, headers: corsHeaders });
    }
    if (!Array.isArray(fileUrls)) {
      return Response.json({ error: 'fileUrls must be an array' }, { status: 400, headers: corsHeaders });
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
    const { data: tripPro, error: proErr } = await supabaseAdmin.rpc('is_trip_pro', { p_trip_id: trip_id });
    if (proErr) {
      console.error('is_trip_pro rpc error:', proErr);
      return Response.json({ error: 'Pro check failed' }, { status: 500, headers: corsHeaders });
    }
    if (!tripPro) {
      return Response.json({ error: 'Pro required', code: 'PRO_REQUIRED' }, { status: 403, headers: corsHeaders });
    }

    const n8nSecret = Deno.env.get('N8N_SECRET');
    if (!n8nSecret) return Response.json({ error: 'N8N_SECRET not configured' }, { status: 500, headers: corsHeaders });

    const n8nJwt = await signN8nJwt(n8nSecret);
    const res = await fetch(N8N_WEBHOOK_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${n8nJwt}` },
      body: JSON.stringify({ kind, fileUrls, text: text ?? '' }),
    });

    if (!res.ok) {
      const errText = await res.text().catch(() => '');
      console.error('n8n parse-booking error:', res.status, errText);
      return Response.json({ error: 'AI webhook failed' }, { status: 502, headers: corsHeaders });
    }

    const data = await res.json();
    return Response.json(data, { headers: corsHeaders });
  } catch (err) {
    await captureEdgeError(err, 'parseBookingWithAi');
    console.error('parseBookingWithAi error:', err);
    return Response.json(
      { error: err instanceof Error ? err.message : 'Internal error' },
      { status: 500, headers: corsHeaders },
    );
  }
});
