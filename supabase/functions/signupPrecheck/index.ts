/**
 * signupPrecheck
 *
 * POST { email, redirectTo? }
 *
 * Pre-registration check for the /login signup form. Lets the UI show an
 * explicit, localized message instead of Supabase's anti-enumeration silent
 * "success". Returns one of:
 *   { code: 'ok' }                   — no account with this email; safe to sign up
 *   { code: 'email_exists' }         — any confirmed account already exists (email/pw OR Google/Apple)
 *   { code: 'confirmation_resent' }  — account exists but unconfirmed → confirmation re-sent
 *
 * verify_jwt = false: called by anonymous (logged-out) users.
 * NOTE: this endpoint reveals whether an email is registered (product decision).
 * It is an enumeration oracle by design — bounded by a per-IP rate limit (TRIP-67,
 * `signup_precheck_ip`: 10/min + 60/hour). Add Auth CAPTCHA for full cover at GA.
 */
import { corsFor } from '../_shared/cors.ts';
import { createClient } from 'npm:@supabase/supabase-js@2';
import { supabaseAdmin } from '../_shared/supabaseAdmin.ts';
import { ipRateLimited } from '../_shared/rateLimit.ts';

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
const ANON_KEY = Deno.env.get('SUPABASE_ANON_KEY')!;
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

Deno.serve(async (req) => {
  const corsHeaders = corsFor(req);
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });

  try {
    const { email, redirectTo } = await req.json().catch(() => ({}));
    const norm = String(email ?? '').trim().toLowerCase();
    if (!norm || !EMAIL_RE.test(norm)) {
      return Response.json({ error: 'Invalid email' }, { status: 400, headers: corsHeaders });
    }

    // Per-IP throttle BEFORE the existence check — this endpoint is an
    // enumeration oracle, so bound bulk probing at the door (status 200 +
    // code so the client reads it via functions.invoke `data`, not `error`).
    if (await ipRateLimited(req, 'signup_precheck_ip')) {
      return Response.json({ code: 'rate_limited' }, { headers: corsHeaders });
    }

    const { data, error } = await supabaseAdmin.rpc('auth_email_status', { p_email: norm });
    if (error) throw error;
    const st = Array.isArray(data) ? data[0] : data;

    // No account with this email → free to register.
    if (!st || !st.exists_user) {
      return Response.json({ code: 'ok' }, { headers: corsHeaders });
    }

    // Exists but never confirmed → resend the confirmation email instead of
    // dead-ending the user on "already registered".
    if (!st.is_confirmed) {
      const anon = createClient(SUPABASE_URL, ANON_KEY, { auth: { persistSession: false } });
      await anon.auth.resend({
        type: 'signup',
        email: norm,
        options: safeRedirect(redirectTo) ? { emailRedirectTo: redirectTo } : undefined,
      });
      return Response.json({ code: 'confirmation_resent' }, { headers: corsHeaders });
    }

    // Any confirmed account (email/password OR Google/Apple-only) → one unified
    // "already registered, sign in" message (product decision: same text always).
    return Response.json({ code: 'email_exists' }, { headers: corsHeaders });
  } catch (err) {
    console.error('signupPrecheck error', err);
    return Response.json({ error: 'precheck_failed' }, { status: 500, headers: corsHeaders });
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
