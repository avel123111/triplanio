/**
 * requestPasswordReset
 *
 * POST { email, redirectTo }
 *
 * Replaces the client's direct supabase.auth.resetPasswordForEmail call so we can:
 *   1) tell the user when no account exists (product decision — see note below)
 *   2) enforce a 5-per-hour-per-email limit (rolling window) BEFORE sending
 *   3) still send the SAME email via Supabase Auth SMTP (existing template)
 *
 * Returns one of:
 *   { code: 'account_not_found' }
 *   { code: 'rate_limited' }
 *   { code: 'reset_sent' }
 *   { code: 'send_failed' }       — transient/Supabase throttle; UI shows generic retry
 *
 * verify_jwt = false: called by anonymous (logged-out) users.
 * NOTE: revealing account existence is an enumeration oracle — the per-email
 * limit here bounds abuse on the normal flow; add Auth CAPTCHA for full cover.
 */
import { corsHeaders } from '../_shared/cors.ts';
import { createClient } from 'npm:@supabase/supabase-js@2';
import { supabaseAdmin } from '../_shared/supabaseAdmin.ts';

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
const ANON_KEY = Deno.env.get('SUPABASE_ANON_KEY')!;
const WINDOW_MS = 60 * 60 * 1000; // rolling 1 hour
const MAX_PER_WINDOW = 5;
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const FALLBACK_REDIRECT = 'https://www.triplanio.com/reset-password';

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });

  try {
    const { email, redirectTo } = await req.json().catch(() => ({}));
    const norm = String(email ?? '').trim().toLowerCase();
    if (!norm || !EMAIL_RE.test(norm)) {
      return Response.json({ error: 'Invalid email' }, { status: 400, headers: corsHeaders });
    }

    // 1) Existence check (service-role only RPC over auth.users).
    const { data: stData, error: stErr } = await supabaseAdmin.rpc('auth_email_status', { p_email: norm });
    if (stErr) throw stErr;
    const st = Array.isArray(stData) ? stData[0] : stData;
    if (!st || !st.exists_user) {
      return Response.json({ code: 'account_not_found' }, { headers: corsHeaders });
    }

    // 2) Rate limit — count this email's attempts in the rolling window.
    const sinceIso = new Date(Date.now() - WINDOW_MS).toISOString();
    const { count, error: cntErr } = await supabaseAdmin
      .from('password_reset_attempts')
      .select('id', { count: 'exact', head: true })
      .eq('email', norm)
      .gte('created_at', sinceIso);
    if (cntErr) throw cntErr;
    if ((count ?? 0) >= MAX_PER_WINDOW) {
      return Response.json({ code: 'rate_limited' }, { headers: corsHeaders });
    }

    // Record the attempt before sending so every dispatched email is counted.
    const { error: insErr } = await supabaseAdmin
      .from('password_reset_attempts')
      .insert({ email: norm });
    if (insErr) throw insErr;

    // 3) Send via Supabase Auth SMTP (existing recovery template), like the client did.
    const anon = createClient(SUPABASE_URL, ANON_KEY, { auth: { persistSession: false } });
    const redirect = safeRedirect(redirectTo) ? (redirectTo as string) : FALLBACK_REDIRECT;
    const { error: sendErr } = await anon.auth.resetPasswordForEmail(norm, { redirectTo: redirect });
    if (sendErr) {
      console.error('resetPasswordForEmail failed', sendErr.message);
      return Response.json({ code: 'send_failed' }, { headers: corsHeaders });
    }

    return Response.json({ code: 'reset_sent' }, { headers: corsHeaders });
  } catch (err) {
    console.error('requestPasswordReset error', err);
    return Response.json({ error: 'reset_failed' }, { status: 500, headers: corsHeaders });
  }
});

// Only allow redirect hosts we own (defense against open-redirect via email links).
function safeRedirect(url?: string): boolean {
  if (!url || typeof url !== 'string') return false;
  try {
    const h = new URL(url).hostname;
    return (
      h === 'triplanio.com' ||
      h === 'www.triplanio.com' ||
      h.endsWith('.triplanio.com') ||
      h.endsWith('.vercel.app') ||
      h === 'localhost'
    );
  } catch {
    return false;
  }
}
