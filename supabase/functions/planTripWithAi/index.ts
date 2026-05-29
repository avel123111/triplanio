/**
 * planTripWithAi
 *
 * Front-end → this function → n8n webhook → returns draft + ai_comment.
 *
 * The N8N_SECRET bearer token lives only as a Supabase secret. The frontend
 * never sees it. n8n stores its own conversation history keyed by sessionId
 * (Postgres on the n8n side), so we just forward { sessionId, prompt, language }.
 *
 * POST body: { sessionId: string, prompt: string, language?: string }
 */

import { createClient } from 'npm:@supabase/supabase-js@2';
import { signN8nJwt } from '../_shared/n8nAuth.ts';

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

const N8N_WEBHOOK_URL = 'https://n8n-production-d1214.up.railway.app/webhook/ai-trip-planner';

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });

  try {
    const user = await getRequestUser(req);
    if (!user) return Response.json({ error: 'Unauthorized' }, { status: 401, headers: corsHeaders });

    const { sessionId, prompt, language } = await req.json();
    if (!prompt) return Response.json({ error: 'prompt required' }, { status: 400, headers: corsHeaders });

    const n8nSecret = Deno.env.get('N8N_SECRET');
    if (!n8nSecret) return Response.json({ error: 'N8N_SECRET not configured' }, { status: 500, headers: corsHeaders });

    const n8nJwt = await signN8nJwt(n8nSecret);
    const res = await fetch(N8N_WEBHOOK_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${n8nJwt}` },
      body: JSON.stringify({ sessionId, prompt, language }),
    });

    if (!res.ok) {
      const errText = await res.text().catch(() => '');
      console.error('n8n error:', res.status, errText);
      return Response.json({ error: 'AI webhook failed' }, { status: 502, headers: corsHeaders });
    }

    const data = await res.json();
    return Response.json(data, { headers: corsHeaders });
  } catch (err) {
    console.error('planTripWithAi error:', err);
    return Response.json(
      { error: err instanceof Error ? err.message : 'Internal error' },
      { status: 500, headers: corsHeaders },
    );
  }
});
