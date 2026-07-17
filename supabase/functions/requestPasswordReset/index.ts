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
 *   { code: 'rate_limited' }      — our IP/email hourly cap (long wait, "try in an hour")
 *   { code: 'retry_soon' }        — Supabase's ~60s min-interval (short wait, "in a minute")
 *   { code: 'reset_sent' }
 *   { code: 'send_failed' }       — transient send error; UI shows generic retry
 *
 * verify_jwt = false: called by anonymous (logged-out) users.
 * NOTE: revealing account existence is an enumeration oracle. Bounded by TWO
 * axes (TRIP-67): a per-IP limit (`pwd_reset_ip`: 10/min + 60/hour) cuts bulk
 * probing of non-existent addresses; the per-email cap (`pwd_reset_email`:
 * 5/hour) protects a real user's inbox from reset-email spam. Add Auth CAPTCHA
 * for full cover at GA.
 */
import { corsFor } from '../_shared/cors.ts';
import { captureEdgeError } from '../_shared/sentry.ts';
import { createClient } from 'npm:@supabase/supabase-js@2';
import { supabaseAdmin } from '../_shared/supabaseAdmin.ts';
import { ipRateLimited, underLimit, recordHit, supabaseThrottleKind } from '../_shared/rateLimit.ts';

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
const ANON_KEY = Deno.env.get('SUPABASE_ANON_KEY')!;
const RESET_MAX_PER_HOUR = 5; // successful sends per rolling hour, per email
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const FALLBACK_REDIRECT = 'https://www.triplanio.com/reset-password';

// sentry: manual — anon; rate-limit is a deliberate 200 with data.code, not an error to report.
Deno.serve(async (req) => {
  const corsHeaders = corsFor(req);
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });

  try {
    const { email, redirectTo } = await req.json().catch(() => ({}));
    const norm = String(email ?? '').trim().toLowerCase();
    if (!norm || !EMAIL_RE.test(norm)) {
      return Response.json({ error: 'Invalid email' }, { status: 400, headers: corsHeaders });
    }

    // 1) Per-IP throttle BEFORE the existence check — bounds bulk enumeration
    // of non-existent addresses (which the email cap below does NOT cover).
    if (await ipRateLimited(req, 'pwd_reset_ip')) {
      return Response.json({ code: 'rate_limited' }, { headers: corsHeaders });
    }

    // 2) Existence check (service-role only RPC over auth.users).
    const { data: stData, error: stErr } = await supabaseAdmin.rpc('auth_email_status', { p_email: norm });
    if (stErr) throw stErr;
    const st = Array.isArray(stData) ? stData[0] : stData;
    if (!st || !st.exists_user) {
      return Response.json({ code: 'account_not_found' }, { headers: corsHeaders });
    }

    // 3) Per-email cap: 5 SUCCESSFUL sends per rolling hour (anti inbox-spam).
    // Recorded only after a delivered email (see recordHit below).
    if (!(await underLimit('pwd_reset_email', norm, RESET_MAX_PER_HOUR, 3600))) {
      return Response.json({ code: 'rate_limited' }, { headers: corsHeaders });
    }

    // 4) Send via Supabase Auth SMTP (existing recovery template), like the client did.
    const anon = createClient(SUPABASE_URL, ANON_KEY, { auth: { persistSession: false } });
    const redirect = safeRedirect(redirectTo) ? (redirectTo as string) : FALLBACK_REDIRECT;
    const { error: sendErr } = await anon.auth.resetPasswordForEmail(norm, { redirectTo: redirect });
    if (sendErr) {
      console.error('resetPasswordForEmail failed', sendErr.status, sendErr.message);
      // Supabase's own throttle → show the limit message and do NOT count it
      // against our quota. Split the ~60s min-interval ('soon') from an hourly
      // cap ('hour') so the UI can say "wait a minute" vs "try in an hour".
      const kind = supabaseThrottleKind(sendErr);
      if (kind === 'soon') return Response.json({ code: 'retry_soon' }, { headers: corsHeaders });
      if (kind === 'hour') return Response.json({ code: 'rate_limited' }, { headers: corsHeaders });
      return Response.json({ code: 'send_failed' }, { headers: corsHeaders });
    }

    // Count only delivered emails toward the 5/hour-per-email cap.
    await recordHit('pwd_reset_email', norm);

    return Response.json({ code: 'reset_sent' }, { headers: corsHeaders });
  } catch (err) {
    // sentry: manual — the rate-limited 200 path is deliberate (not reported), but
    // an unexpected 500 (RPC / Auth failure) must still reach Sentry.
    await captureEdgeError(err, 'requestPasswordReset');
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
