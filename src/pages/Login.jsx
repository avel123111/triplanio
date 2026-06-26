import React, { useState, useEffect } from 'react';
import { supabase } from '@/api/supabaseClient';
import { BRAND_NAME } from '@/lib/brand';
import { useI18n } from '@/lib/i18n/I18nContext';
import './login.css';

const GOOGLE_CLIENT_ID = import.meta.env.VITE_GOOGLE_CLIENT_ID;

// Where to land after a successful login. A pending invite-link join (see
// JoinTrip) stores its path in sessionStorage; otherwise go to the app home.
function postLoginPath() {
  try {
    const dest = sessionStorage.getItem('postLoginRedirect');
    if (dest && dest.startsWith('/')) return dest;
  } catch { /* ignore */ }
  return '/trips';
}

// ── Send cooldown (persisted by email) ────────────────────────────────────────
// The ~60s minimum interval Supabase enforces between auth emails to the same
// address. Persisting it by email (not by screen) keeps the countdown honest
// when the user leaves and returns to the form — otherwise the timer is plain
// component state and looks "ready to send" again on re-entry.
const SEND_COOLDOWN_MS = 60_000;
const cooldownKey = (email) => `tpl_send_cooldown:${String(email || '').trim().toLowerCase()}`;

function cooldownLeft(email) {
  if (!email) return 0;
  try {
    const ts = Number(localStorage.getItem(cooldownKey(email))) || 0;
    if (!ts) return 0;
    return Math.max(0, Math.ceil((ts + SEND_COOLDOWN_MS - Date.now()) / 1000));
  } catch { return 0; }
}

function startCooldown(email) {
  if (!email) return;
  try { localStorage.setItem(cooldownKey(email), String(Date.now())); } catch { /* ignore */ }
}

// ── Password strength scorer ──────────────────────────────────────────────────
function scorePassword(pw) {
  if (!pw) return 0;
  let s = 0;
  if (pw.length >= 8) s++;
  if (/[A-ZА-ЯЁ]/.test(pw) && /[a-zа-яё]/.test(pw)) s++;
  if (/\d/.test(pw)) s++;
  if (/[^A-Za-zА-Яа-я0-9]/.test(pw) || pw.length >= 12) s++;
  return s;
}

// Hard gate that mirrors the Supabase server policy
// (Auth → Password: min length 8 + "Letters and digits").
// Keep this in sync if the dashboard policy changes.
function meetsPasswordPolicy(pw) {
  return (pw || '').length >= 8 && /[A-Za-zА-Яа-яЁё]/.test(pw) && /\d/.test(pw);
}

// ── Icons ─────────────────────────────────────────────────────────────────────
function IconEye({ off }) {
  return off ? (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round">
      <path d="M17.94 17.94A10.94 10.94 0 0 1 12 19c-6.5 0-10-7-10-7a18.15 18.15 0 0 1 5.06-5.94" />
      <path d="M9.9 4.24A9.12 9.12 0 0 1 12 4c6.5 0 10 7 10 7a18.5 18.5 0 0 1-2.16 3.19" />
      <line x1="1" y1="1" x2="23" y2="23" />
    </svg>
  ) : (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round">
      <path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7S2 12 2 12z" />
      <circle cx="12" cy="12" r="3" />
    </svg>
  );
}
function IconArrow() {
  return (
    <svg className="arrow" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M5 12h14" /><path d="m13 6 6 6-6 6" />
    </svg>
  );
}
function IconMail() {
  return (
    <svg width="30" height="30" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M4 7a2 2 0 0 1 2-2h12a2 2 0 0 1 2 2v10a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V7z" />
      <path d="m4 7 8 6 8-6" />
    </svg>
  );
}
function IconExternalLink() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      <path d="M7 17 17 7" /><path d="M8 7h9v9" />
    </svg>
  );
}
function IconGoogle() {
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none">
      <path fill="#4285F4" d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z"/>
      <path fill="#34A853" d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.99.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84A10.99 10.99 0 0 0 12 23z"/>
      <path fill="#FBBC05" d="M5.84 14.1A6.6 6.6 0 0 1 5.48 12c0-.73.13-1.44.36-2.1V7.06H2.18A11 11 0 0 0 1 12c0 1.78.42 3.46 1.18 4.94l3.66-2.84z"/>
      <path fill="#EA4335" d="M12 5.38c1.62 0 3.07.56 4.21 1.65l3.16-3.16C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.06l3.66 2.84C6.71 7.3 9.14 5.38 12 5.38z"/>
    </svg>
  );
}
function IconApple() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor">
      <path d="M17.05 12.04c-.03-2.6 2.12-3.85 2.22-3.91-1.21-1.77-3.09-2.01-3.76-2.04-1.6-.16-3.13.94-3.94.94-.83 0-2.07-.92-3.41-.9-1.75.03-3.37 1.02-4.27 2.59-1.83 3.17-.47 7.86 1.32 10.43.87 1.26 1.91 2.67 3.27 2.62 1.31-.05 1.8-.85 3.39-.85 1.58 0 2.03.85 3.42.82 1.41-.02 2.31-1.28 3.18-2.55 1-1.46 1.42-2.88 1.45-2.95-.03-.01-2.78-1.07-2.81-4.2zm-2.6-7.7c.72-.88 1.21-2.1 1.07-3.31-1.04.05-2.3.69-3.05 1.56-.66.78-1.25 2.02-1.09 3.21 1.16.09 2.34-.59 3.07-1.46z"/>
    </svg>
  );
}

function IconShieldAlert() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M20 13c0 5-3.5 7.5-7.66 8.95a1 1 0 0 1-.67-.01C7.5 20.5 4 18 4 13V6a1 1 0 0 1 1-1c2 0 4.5-1.2 6.24-2.72a1.17 1.17 0 0 1 1.52 0C14.51 3.81 17 5 19 5a1 1 0 0 1 1 1z" />
      <path d="M12 8v4" />
      <path d="M12 16h.01" />
    </svg>
  );
}

// Inline alert row used for all auth errors (shield-alert icon + message).
function AuthError({ children }) {
  return (
    <div className="auth-error" role="alert">
      <span className="auth-error__icon"><IconShieldAlert /></span>
      <span>{children}</span>
    </div>
  );
}

// ── Brand SVG mark (matches the landing-page logo exactly) ─────────────────────
const TRIPLANIO_PATH = "M33.9515 -0.266535C40.7142 -0.445139 48.1271 -0.302259 54.9281 -0.303644L94.514 -0.309503L214.845 -0.305597L278.868 -0.306574L298.193 -0.318292C310.201 -0.32163 319.364 -0.684415 329.217 7.74225C343.125 19.635 341.19 34.942 341.176 51.3067L341.157 86.3829L341.184 195.125L341.181 272.228L341.212 295.303C341.226 308.706 342.006 318.931 332.398 329.72C326.281 336.547 317.675 340.628 308.52 341.05C298.456 341.533 284.325 341.086 274.023 341.083L205.381 341.092L162.115 341.117C141.323 341.131 123.861 343.106 107.208 327.72C102.838 323.62 99.3189 318.699 96.8548 313.236C94.3907 307.774 93.0296 301.878 92.849 295.889C92.529 287.072 93.8616 280.992 96.6224 272.786C101.665 257.797 109.31 248.589 119.725 237.345C125.95 245.136 131.667 253.986 137.971 261.606C140.39 264.528 150.129 252.175 148.683 246.961C146.168 237.892 141.381 229.908 138.15 221.158C142.842 216.992 148.474 212.5 153.326 208.398C163.06 200.169 172.732 191.869 182.345 183.5C189.212 190.011 196.381 197.442 203.098 204.167L248.907 249.981C253.187 244.922 256.537 238.164 256.598 231.434C256.623 228.623 256.007 225.923 254.626 223.456C251.646 218.12 237.029 204.664 231.868 199.467C223.676 191.542 215.284 182.914 207.203 174.842L155.649 123.287L134.288 101.945C132.743 100.406 131.158 98.7783 129.626 97.3106C123.616 91.552 120.034 86.1564 110.778 87.3673C103.826 88.2767 99.8349 91.3194 94.4329 95.3995C110.556 111.824 126.807 128.124 143.183 144.297C148.913 150.046 155.228 156.051 160.75 161.915C157.391 166.37 151.717 172.659 147.998 177.059C139.745 186.812 131.56 196.623 123.442 206.489C118.102 204.22 112.747 201.983 107.379 199.78C101.261 197.23 96.1995 193.797 89.9368 198.428C79.7224 205.983 80.7549 205.52 89.9857 212.164C94.9362 215.725 102.289 220.689 106.734 224.759C102.849 229.003 98.6343 233.317 95.2406 237.848C77.4842 261.564 66.952 294.342 80.972 322.417C84.8667 330.214 88.4217 334.775 94.4671 341.075C74.9177 341.309 55.209 340.956 35.6429 341.125C25.3518 341.214 16.7477 338.183 9.43489 330.636C5.11961 326.154 2.09948 320.587 0.695637 314.525C-0.740455 308.276 -0.261685 293.256 -0.261394 286.203C-0.338339 274.2 -0.331163 262.2 -0.240887 250.2C4.18863 255.291 9.4218 259.623 15.2513 263.023C32.4055 272.939 50.165 274.236 69.1761 269.211C69.6238 268.23 70.0656 266.844 70.4095 265.786C72.6759 258.811 75.6942 252.497 79.2786 246.108C67.5692 251.37 57.4925 254.32 44.432 253.45C20.0121 252.083 0.660326 229.606 -0.104168 205.7C-0.510832 192.989 -0.272964 179.798 -0.270183 166.97L-0.275066 95.5186L-0.277019 53.2891C-0.286758 47.0065 -0.647595 34.579 0.182942 28.8214C1.1558 22.1467 4.06527 15.9035 8.55013 10.8653C15.5012 3.17884 23.8502 0.199571 33.9515 -0.266535ZM137.352 52.7081C134.062 49.9494 128.015 49.4695 123.791 49.9737C116.528 51.2496 110.458 54.6421 104.987 59.5674L279.767 234.294L284.439 238.919C289.858 231.455 294.445 222.683 293.148 213.136C292.014 204.797 284.255 198.958 278.489 193.235L260.278 175.103L196.142 110.966L155.937 70.7413C150.064 64.881 143.662 58.0002 137.352 52.7081ZM256.192 105.029C259.319 96.1169 261.478 84.3761 247.586 85.7911C231.37 88.8299 220.289 99.6272 209.231 111.022L227.431 129.133L233.775 135.479C242.589 125.851 251.686 117.855 256.192 105.029Z";
function BrandMark({ size = 28 }) {
  return (
    <svg width={size} height={size} viewBox="0 0 341 341" aria-hidden="true">
      <path fill="#2167e2" d={TRIPLANIO_PATH} />
    </svg>
  );
}

// ── Main component ────────────────────────────────────────────────────────────
export default function Login() {
  const { t, lang } = useI18n();

  // Password-recovery deep link (/reset-password) reuses this same auth shell
  // (left forms + right brand panel) but opens straight on the new-password form
  // and must NOT bounce to /trips even though the recovery token creates a session.
  const isRecoveryRoute =
    typeof window !== 'undefined' && window.location.pathname === '/reset-password';

  const [view, setView]           = useState(isRecoveryRoute ? 'reset-password' : 'login'); // login | signup | reset | reset-sent | reset-password | reset-done
  const [email, setEmail]         = useState('');
  const [password, setPassword]   = useState('');
  const [password2, setPassword2] = useState('');
  const [name, setName]           = useState('');
  const [showPw, setShowPw]       = useState(false);
  const [showPw2, setShowPw2]     = useState(false);
  const [remember, setRemember]   = useState(true);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError]         = useState(null);
  const [sentEmail, setSentEmail] = useState('');
  const [resendLeft, setResendLeft] = useState(0);       // seconds left on the resend cooldown
  const [resendFlow, setResendFlow] = useState('reset'); // which send to repeat: 'reset' | 'signup'
  const pwScore = scorePassword(password);

  // Password-strength labels (localized; index matches scorePassword 0..4).
  const STRENGTH_LABELS = [
    t('auth.pw_hint0'),
    t('auth.pw_weak'),
    t('auth.pw_medium'),
    t('auth.pw_good'),
    t('auth.pw_strong'),
  ];

  // Redirect if already logged in - but never on the recovery route, where the
  // session belongs to a password reset still in progress.
  useEffect(() => {
    if (isRecoveryRoute) return;
    supabase.auth.getSession().then(({ data: { session } }) => {
      if (session) window.location.href = postLoginPath();
    });
  }, [isRecoveryRoute]);

  // The auth screen is light-only by design (white form + photo brand panel).
  // A dark theme stored from the authed app sets [data-theme=dark] on <html>,
  // which flips --ink/--surface and breaks the right-panel preview (white text
  // on white, dark plates). Force light here, restore the user's theme on exit.
  useEffect(() => {
    const r = document.documentElement;
    const prevTheme = r.getAttribute('data-theme');
    const prevDark = r.classList.contains('dark');
    r.classList.remove('dark');
    r.setAttribute('data-theme', 'light');
    return () => {
      if (prevDark) r.classList.add('dark');
      if (prevTheme) r.setAttribute('data-theme', prevTheme);
    };
  }, []);

  // Unlock the form after returning from a Google/Apple OAuth redirect.
  // signInWithOAuth navigates the whole page away with isLoading=true; pressing
  // "back" can restore this page from the bfcache with that stale disabled
  // state, leaving every input/button locked. Reset loading whenever the page
  // is shown again (bfcache restore or tab refocus).
  useEffect(() => {
    const reset = () => setIsLoading(false);
    const onPageShow = (e) => { if (e.persisted) reset(); };
    const onVisible = () => { if (document.visibilityState === 'visible') reset(); };
    window.addEventListener('pageshow', onPageShow);
    document.addEventListener('visibilitychange', onVisible);
    return () => {
      window.removeEventListener('pageshow', onPageShow);
      document.removeEventListener('visibilitychange', onVisible);
    };
  }, []);

  // Reset error + pw visibility on view change
  useEffect(() => { setError(null); setShowPw(false); setShowPw2(false); }, [view]);

  // Resend cooldown — matches Supabase's ~60s minimum interval between auth
  // emails to the same address. Hydrated from storage (persisted by email) so it
  // survives leaving and returning to the form: on the recovery form keyed by the
  // typed email, on the "email sent" screen by the address we sent to.
  useEffect(() => {
    if (view === 'reset') setResendLeft(cooldownLeft(email));
    else if (view === 'reset-sent') setResendLeft(cooldownLeft(sentEmail));
  }, [view, email, sentEmail]);
  useEffect(() => {
    if (resendLeft <= 0) return undefined;
    const id = setTimeout(() => setResendLeft((s) => Math.max(0, s - 1)), 1000);
    return () => clearTimeout(id);
  }, [resendLeft]);

  const goto = (v) => setView(v);

  // ── Auth handlers ──
  const handleGoogle = async () => {
    setIsLoading(true); setError(null);
    const { error } = await supabase.auth.signInWithOAuth({
      provider: 'google',
      options: {
        redirectTo: window.location.origin + postLoginPath(),
        queryParams: { prompt: 'select_account' },
      },
    });
    if (error) { setError(error.message); setIsLoading(false); }
  };

  // Google One Tap credential handler - exchanges the Google JWT for a
  // Supabase session via signInWithIdToken. AuthContext picks up SIGNED_IN
  // and handles profile creation + redirect to /trips.
  // `nonce` is the RAW nonce: Google embedded its SHA-256 hash in the id_token,
  // Supabase re-hashes the raw value and compares. Both sides must agree -
  // omitting it while the token carries a nonce throws "Passed nonce and nonce
  // in id_token should either both exist or not".
  const handleOneTapCredential = async (response, nonce) => {
    setIsLoading(true);
    setError(null);
    try {
      const { error } = await supabase.auth.signInWithIdToken({
        provider: 'google',
        token: response.credential,
        nonce,
      });
      if (error) {
        setError(error.message);
        setIsLoading(false);
        return;
      }
      // Success: AuthContext picks up SIGNED_IN but does not navigate, and this
      // page stays mounted on /login - redirect explicitly (same as email login
      // and the Google redirect flow's redirectTo). Keep isLoading=true so the
      // buttons don't flash re-enabled before the navigation tears the page down.
      window.location.href = postLoginPath();
    } catch (err) {
      setError(err.message);
      setIsLoading(false);
    }
  };

  // Load Google Identity Services script on demand and show the One Tap
  // prompt. Scoped to this page so other routes don't pay the cost.
  useEffect(() => {
    if (!GOOGLE_CLIENT_ID) return;
    let cancelled = false;

    const init = async () => {
      // Nonce binding (One Tap + FedCM): generate a raw nonce, hand Google its
      // SHA-256 hex hash (goes into the id_token's `nonce` claim), and keep the
      // raw value to pass to signInWithIdToken. Without an explicit nonce, FedCM
      // injects its own that we can't reproduce → Supabase rejects the token.
      const rawNonce = Array.from(crypto.getRandomValues(new Uint8Array(16)))
        .map((b) => b.toString(16).padStart(2, '0')).join('');
      const hashBuffer = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(rawNonce));
      const hashedNonce = Array.from(new Uint8Array(hashBuffer))
        .map((b) => b.toString(16).padStart(2, '0')).join('');
      if (cancelled) return;

      const script = document.createElement('script');
      script.src = 'https://accounts.google.com/gsi/client';
      script.async = true;
      script.defer = true;
      script.onload = () => {
        if (cancelled) return;
        window.google?.accounts.id.initialize({
          client_id: GOOGLE_CLIENT_ID,
          callback: (response) => handleOneTapCredential(response, rawNonce),
          nonce: hashedNonce,
          itp_support: true,
        });
        window.google?.accounts.id.prompt();
      };
      document.head.appendChild(script);
    };

    init();

    return () => {
      cancelled = true;
      window.google?.accounts.id.cancel();
      const existing = document.querySelector('script[src="https://accounts.google.com/gsi/client"]');
      if (existing) existing.remove();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const handleApple = async () => {
    setIsLoading(true); setError(null);
    const { error } = await supabase.auth.signInWithOAuth({
      provider: 'apple',
      options: { redirectTo: window.location.origin + postLoginPath() },
    });
    if (error) { setError(error.message); setIsLoading(false); }
  };

  const handleLogin = async (e) => {
    e.preventDefault(); setIsLoading(true); setError(null);
    const { error } = await supabase.auth.signInWithPassword({ email, password });
    if (error) { setError(error.message); setIsLoading(false); return; }
    // Success: AuthContext picks up SIGNED_IN, but this page stays mounted on
    // /login (App routes /login independently of auth state), so navigate
    // explicitly to land the user in the app. Keep isLoading=true until the
    // full navigation tears the page down (avoids a flash of re-enabled buttons).
    window.location.href = postLoginPath();
  };

  const handleSignup = async (e) => {
    e.preventDefault(); setError(null);
    if (!meetsPasswordPolicy(password)) { setError(t('auth.pw_policy')); return; }
    setIsLoading(true);

    // Preflight: Supabase hides whether an email already exists, so ask the
    // server (signupPrecheck) before creating the account. This lets us show an
    // explicit message instead of a silent "check your email".
    const { data: pre, error: preErr } = await supabase.functions.invoke('signupPrecheck', {
      body: { email, redirectTo: window.location.origin + postLoginPath() },
    });
    if (preErr) { setError(t('auth.err_generic')); setIsLoading(false); return; }
    if (pre?.code === 'rate_limited') { setError(t('auth.err_rate_limited')); setIsLoading(false); return; }
    if (pre?.code === 'retry_soon') { setError(t('auth.err_retry_soon')); setIsLoading(false); return; }
    if (pre?.code === 'email_exists') { setError(t('auth.err_email_exists')); setIsLoading(false); return; }
    if (pre?.code === 'confirmation_resent') {
      // Account exists but was never confirmed — the server re-sent the link.
      startCooldown(email);
      setSentEmail(email); setResendFlow('signup'); goto('reset-sent'); setIsLoading(false); return;
    }

    // code === 'ok' → no such account yet, proceed with the real signup.
    const { error } = await supabase.auth.signUp({
      email,
      password,
      options: {
        data: { full_name: name, language: lang },
        // Land confirmed users in the app, not on the Site-URL landing page.
        emailRedirectTo: window.location.origin + postLoginPath(),
      },
    });
    if (error) { setError(error.message); setIsLoading(false); }
    else { startCooldown(email); setSentEmail(email); setResendFlow('signup'); goto('reset-sent'); setIsLoading(false); }
  };

  // Set a new password during a Supabase recovery session (reached via the
  // /reset-password email link). detectSessionInUrl exchanges the recovery token
  // into a session on load; updateUser then writes the new password. For a
  // Google-only account this ADDS an email/password login alongside Google.
  const handleNewPassword = async (e) => {
    e.preventDefault(); setError(null);
    if (!meetsPasswordPolicy(password)) { setError(t('auth.pw_policy')); return; }
    if (password !== password2) { setError(t('auth.pw_nomatch')); return; }
    setIsLoading(true);
    const { error } = await supabase.auth.updateUser({ password });
    if (error) {
      const msg = /session|token|expired|missing/i.test(error.message)
        ? t('auth.err_reset_link')
        : error.message;
      setError(msg); setIsLoading(false); return;
    }
    goto('reset-done'); setIsLoading(false);
  };

  // From the "password updated" screen: drop the recovery session and send the
  // user to a clean login so they sign in with the new password.
  const finishToLogin = async () => {
    await supabase.auth.signOut();
    window.location.href = '/login';
  };

  const handleReset = async (e) => {
    e.preventDefault(); setIsLoading(true); setError(null);
    // Routed through requestPasswordReset so the server can reveal an unknown
    // email and enforce the 5/hour-per-email limit. The email itself is still
    // sent by Supabase Auth (same template) from inside that function.
    const { data, error: invErr } = await supabase.functions.invoke('requestPasswordReset', {
      body: { email, redirectTo: window.location.origin + '/reset-password' },
    });
    if (invErr) { setError(t('auth.err_generic')); setIsLoading(false); return; }
    if (data?.code === 'account_not_found') { setError(t('auth.err_account_not_found')); setIsLoading(false); return; }
    if (data?.code === 'rate_limited') { setError(t('auth.err_reset_rate_limited')); setIsLoading(false); return; }
    if (data?.code === 'retry_soon') {
      setError(t('auth.err_retry_soon'));
      if (!cooldownLeft(email)) startCooldown(email);
      setResendLeft(cooldownLeft(email)); setIsLoading(false); return;
    }
    if (data?.code === 'reset_sent') { startCooldown(email); setSentEmail(email); setResendFlow('reset'); goto('reset-sent'); setIsLoading(false); return; }
    // send_failed or any unexpected code → generic retry.
    setError(t('auth.err_generic')); setIsLoading(false);
  };

  // Re-send from the "email sent" screen, gated by the 60s cooldown timer.
  const handleResend = async () => {
    if (resendLeft > 0 || isLoading) return;
    setError(null); setIsLoading(true);
    const fn = resendFlow === 'signup' ? 'signupPrecheck' : 'requestPasswordReset';
    const body = resendFlow === 'signup'
      ? { email: sentEmail, redirectTo: window.location.origin + postLoginPath() }
      : { email: sentEmail, redirectTo: window.location.origin + '/reset-password' };
    const { data, error: invErr } = await supabase.functions.invoke(fn, { body });
    setIsLoading(false);
    if (invErr) { setError(t('auth.err_generic')); return; }
    if (data?.code === 'rate_limited') { setError(t('auth.err_reset_rate_limited')); setResendLeft(60); return; }
    if (data?.code === 'retry_soon') {
      setError(t('auth.err_retry_soon'));
      if (!cooldownLeft(sentEmail)) startCooldown(sentEmail);
      setResendLeft(cooldownLeft(sentEmail) || 60); return;
    }
    if (data?.code === 'account_not_found') { setError(t('auth.err_account_not_found')); return; }
    // success (reset_sent / confirmation_resent / ok) → restart the cooldown.
    startCooldown(sentEmail); setResendLeft(60);
  };

  return (
    <main className="auth">
      {/* ════ LEFT: Form ════ */}
      <section className="auth__form-col">
        <a href="/" className="auth__brand-link">
          <BrandMark size={28} />
          <span>{BRAND_NAME}</span>
        </a>

        <div className="auth__form-wrap">
          <div className="auth__form">

            {/* ── Login ── */}
            {view === 'login' && (
              <>
                <div className="eyebrow">{t('auth.login_eyebrow')}</div>
                <h1 className="auth__h1">{t('auth.login_title')}</h1>
                <p className="lede">{t('auth.login_lede')}</p>

                <div className="socials">
                  <button type="button" className="btn-social" onClick={handleGoogle} disabled={isLoading}>
                    <IconGoogle /><span>Google</span>
                  </button>
                  <button type="button" className="btn-social" onClick={handleApple} disabled={isLoading}>
                    <IconApple /><span>Apple</span>
                  </button>
                </div>

                <div className="divider"><span>{t('auth.or_email')}</span></div>

                {error && <AuthError>{error}</AuthError>}

                <form className="auth__inputs" onSubmit={handleLogin}>
                  <div className="field">
                    <div className="field__top">
                      <label className="field__label" htmlFor="l-email">{t('auth.email_label')}</label>
                    </div>
                    <input className="auth-input" id="l-email" type="email" autoComplete="email"
                      placeholder="you@example.com" required value={email}
                      onChange={e => setEmail(e.target.value)} disabled={isLoading} />
                  </div>

                  <div className="field">
                    <div className="field__top">
                      <label className="field__label" htmlFor="l-pw">{t('auth.password')}</label>
                      <span className="field__hint">
                        <a href="#" onClick={e => { e.preventDefault(); goto('reset'); }}>{t('auth.forgot')}</a>
                      </span>
                    </div>
                    <div className="input-wrap">
                      <input className={`auth-input auth-input--trail`} id="l-pw"
                        type={showPw ? 'text' : 'password'} autoComplete="current-password"
                        placeholder={t('auth.pw_placeholder')} required value={password}
                        onChange={e => setPassword(e.target.value)} disabled={isLoading} />
                      <button type="button" className="input-trail"
                        aria-label={showPw ? t('auth.pw_hide') : t('auth.pw_show')}
                        onClick={() => setShowPw(v => !v)}>
                        <IconEye off={showPw} />
                      </button>
                    </div>
                  </div>

                  <div className="row-between">
                    <label className="check">
                      <input type="checkbox" checked={remember} onChange={e => setRemember(e.target.checked)} />
                      <span>{t('auth.remember')}</span>
                    </label>
                  </div>

                  <button type="submit" className="btn-primary" disabled={isLoading}>
                    {isLoading ? t('common.loading') : t('auth.sign_in')}<IconArrow />
                  </button>
                </form>

                <p className="auth__switch">
                  {t('auth.no_account')}{' '}
                  <button type="button" onClick={() => goto('signup')}>{t('auth.sign_up')}</button>
                </p>
              </>
            )}

            {/* ── Sign up ── */}
            {view === 'signup' && (
              <>
                <div className="eyebrow">{t('auth.create_account')}</div>
                <h1 className="auth__h1">{t('auth.signup_title')}</h1>
                <p className="lede">{t('auth.signup_lede')}</p>

                <div className="socials">
                  <button type="button" className="btn-social" onClick={handleGoogle} disabled={isLoading}>
                    <IconGoogle /><span>Google</span>
                  </button>
                  <button type="button" className="btn-social" onClick={handleApple} disabled={isLoading}>
                    <IconApple /><span>Apple</span>
                  </button>
                </div>

                <div className="divider"><span>{t('auth.or_email')}</span></div>

                {error && <AuthError>{error}</AuthError>}

                <form className="auth__inputs" onSubmit={handleSignup}>
                  <div className="field">
                    <div className="field__top">
                      <label className="field__label" htmlFor="s-name">{t('auth.name_label')}</label>
                    </div>
                    <input className="auth-input" id="s-name" type="text" autoComplete="name"
                      placeholder={t('auth.name_placeholder')} required value={name}
                      onChange={e => setName(e.target.value)} disabled={isLoading} />
                  </div>

                  <div className="field">
                    <div className="field__top">
                      <label className="field__label" htmlFor="s-email">{t('auth.email_label')}</label>
                    </div>
                    <input className="auth-input" id="s-email" type="email" autoComplete="email"
                      placeholder="you@example.com" required value={email}
                      onChange={e => setEmail(e.target.value)} disabled={isLoading} />
                  </div>

                  <div className="field">
                    <div className="field__top">
                      <label className="field__label" htmlFor="s-pw">{t('auth.password')}</label>
                    </div>
                    <div className="input-wrap">
                      <input className="auth-input auth-input--trail" id="s-pw"
                        type={showPw ? 'text' : 'password'} autoComplete="new-password"
                        placeholder={t('auth.pw_placeholder')} required minLength={8} value={password}
                        onChange={e => setPassword(e.target.value)} disabled={isLoading} />
                      <button type="button" className="input-trail"
                        aria-label={showPw ? t('auth.pw_hide') : t('auth.pw_show')}
                        onClick={() => setShowPw(v => !v)}>
                        <IconEye off={showPw} />
                      </button>
                    </div>
                    <div className="pw-strength" data-score={password ? pwScore : undefined}>
                      <span /><span /><span /><span />
                    </div>
                    <div className="pw-strength__label">{STRENGTH_LABELS[pwScore]}</div>
                  </div>

                  <p className="terms">
                    {t('auth.terms_pre')} <a href="#">{t('auth.terms_link')}</a> {t('auth.terms_and')} <a href="#">{t('auth.privacy_link')}</a>.
                  </p>

                  <button type="submit" className="btn-primary" style={{ marginTop: 18 }} disabled={isLoading}>
                    {isLoading ? t('common.loading') : t('auth.create_account')}<IconArrow />
                  </button>
                </form>

                <p className="auth__switch">
                  {t('auth.have_account')}{' '}
                  <button type="button" onClick={() => goto('login')}>{t('auth.sign_in')}</button>
                </p>
              </>
            )}

            {/* ── Reset request ── */}
            {view === 'reset' && (
              <>
                <div className="eyebrow">{t('auth.reset_eyebrow')}</div>
                <h1 className="auth__h1">{t('auth.reset_title')}</h1>
                <p className="lede">{t('auth.reset_lede')}</p>

                {error && <AuthError>{error}</AuthError>}

                <form className="auth__inputs" onSubmit={handleReset} style={{ marginTop: 28 }}>
                  <div className="field">
                    <div className="field__top">
                      <label className="field__label" htmlFor="r-email">{t('auth.email_label')}</label>
                    </div>
                    <input className="auth-input" id="r-email" type="email" autoComplete="email"
                      placeholder="you@example.com" required value={email}
                      onChange={e => setEmail(e.target.value)} disabled={isLoading} />
                  </div>

                  <button type="submit" className="btn-primary" style={{ marginTop: 6 }} disabled={isLoading || resendLeft > 0}>
                    {isLoading
                      ? t('common.loading')
                      : resendLeft > 0
                        ? t('auth.resend_in').replace('{s}', String(resendLeft))
                        : t('auth.reset_submit')}<IconArrow />
                  </button>
                </form>

                <p className="auth__switch">
                  {t('auth.remember_pw')}{' '}
                  <button type="button" onClick={() => goto('login')}>{t('auth.sign_in')}</button>
                </p>
              </>
            )}

            {/* ── Reset sent ── */}
            {view === 'reset-sent' && (
              <div className="confirm">
                <div className="confirm__icon"><IconMail /></div>
                <h2 style={{ fontFamily: 'var(--font-display)', fontSize: 'var(--fs-h2)', letterSpacing: '-0.025em', color: 'var(--ink)' }}>
                  {t('auth.sent_title')}
                </h2>
                <p className="lede" style={{ margin: '14px auto 0', maxWidth: '36ch' }}>
                  {t('auth.sent_to').split('{email}')[0]}
                  <span className="confirm__email">{sentEmail}</span>
                  {t('auth.sent_to').split('{email}')[1]}
                  <br />{t('auth.sent_spam')}
                </p>
                <div className="confirm__actions">
                  <a className="btn-ghost" href="https://mail.google.com" target="_blank" rel="noopener noreferrer">
                    {t('auth.open_gmail')} <IconExternalLink />
                  </a>
                  <button type="button" className="btn-ghost" onClick={() => goto('login')}>
                    {t('auth.to_login')}
                  </button>
                </div>
                {error && <div style={{ marginTop: 16, textAlign: 'left' }}><AuthError>{error}</AuthError></div>}
                <p className="auth__switch" style={{ marginTop: 24 }}>
                  {t('auth.no_email')}{' '}
                  {resendLeft > 0 ? (
                    <span className="auth__resend-wait">{t('auth.resend_in').replace('{s}', String(resendLeft))}</span>
                  ) : (
                    <button type="button" onClick={handleResend} disabled={isLoading}>{t('auth.resend')}</button>
                  )}
                </p>
              </div>
            )}

            {/* ── Reset password (set new) ── */}
            {view === 'reset-password' && (
              <>
                <div className="eyebrow">{t('auth.new_password')}</div>
                <h1 className="auth__h1">{t('auth.newpw_title')}</h1>
                <p className="lede">{t('auth.newpw_lede')}</p>

                {error && <AuthError>{error}</AuthError>}

                <form className="auth__inputs" onSubmit={handleNewPassword} style={{ marginTop: 26 }}>
                  <div className="field">
                    <div className="field__top">
                      <label className="field__label" htmlFor="rp-pw">{t('auth.new_password')}</label>
                    </div>
                    <div className="input-wrap">
                      <input className="auth-input auth-input--trail" id="rp-pw"
                        type={showPw ? 'text' : 'password'} autoComplete="new-password"
                        placeholder={t('auth.pw_placeholder')} required minLength={8} value={password}
                        onChange={e => setPassword(e.target.value)} disabled={isLoading} />
                      <button type="button" className="input-trail"
                        aria-label={showPw ? t('auth.pw_hide') : t('auth.pw_show')}
                        onClick={() => setShowPw(v => !v)}>
                        <IconEye off={showPw} />
                      </button>
                    </div>
                    <div className="pw-strength" data-score={password ? pwScore : undefined}>
                      <span /><span /><span /><span />
                    </div>
                    <div className="pw-strength__label">{STRENGTH_LABELS[pwScore]}</div>
                  </div>

                  <div className="field">
                    <div className="field__top">
                      <label className="field__label" htmlFor="rp-pw2">{t('auth.repeat_password')}</label>
                    </div>
                    <div className="input-wrap">
                      <input className="auth-input auth-input--trail" id="rp-pw2"
                        type={showPw2 ? 'text' : 'password'} autoComplete="new-password"
                        placeholder={t('auth.repeat_placeholder')} required value={password2}
                        onChange={e => setPassword2(e.target.value)} disabled={isLoading} />
                      <button type="button" className="input-trail"
                        aria-label={showPw2 ? t('auth.pw_hide') : t('auth.pw_show')}
                        onClick={() => setShowPw2(v => !v)}>
                        <IconEye off={showPw2} />
                      </button>
                    </div>
                    {password2 && (
                      <div className={`field__match ${password === password2 ? 'is-ok' : 'is-bad'}`} aria-live="polite">
                        {password === password2 ? t('auth.pw_match') : t('auth.pw_nomatch')}
                      </div>
                    )}
                  </div>

                  <button type="submit" className="btn-primary" style={{ marginTop: 14 }} disabled={isLoading}>
                    {isLoading ? t('auth.saving') : t('auth.save_password')}<IconArrow />
                  </button>
                </form>

                <p className="auth__switch">
                  {t('auth.remember_old')}{' '}
                  <button type="button" onClick={finishToLogin}>{t('auth.sign_in')}</button>
                </p>
              </>
            )}

            {/* ── Reset done ── */}
            {view === 'reset-done' && (
              <div className="confirm">
                <div className="confirm__icon">
                  <svg width="30" height="30" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M20 6 9 17l-5-5" />
                  </svg>
                </div>
                <h2 style={{ fontFamily: 'var(--font-display)', fontSize: 'var(--fs-h2)', letterSpacing: '-0.025em', color: 'var(--ink)' }}>
                  {t('auth.done_title')}
                </h2>
                <p className="lede" style={{ margin: '14px auto 0', maxWidth: '34ch' }}>
                  {t('auth.done_lede')}
                </p>
                <div className="confirm__actions" style={{ gridTemplateColumns: '1fr' }}>
                  <button type="button" className="btn-primary" onClick={finishToLogin}>
                    {t('auth.sign_in')}<IconArrow />
                  </button>
                </div>
              </div>
            )}

          </div>
        </div>

        <footer className="auth__foot">
          <span>© 2026 Triplanio</span>
          <div className="auth__foot-links">
            <a href="#">{t('auth.foot_terms')}</a>
            <a href="#">{t('auth.foot_privacy')}</a>
            <a href="#">{t('auth.foot_support')}</a>
          </div>
        </footer>
      </section>

      {/* ════ RIGHT: Brand panel ════ */}
      <aside className="auth__brand-col" aria-hidden="true">
        <div className="brand-col__inner">
          <header className="brand-col__head">
            <span className="brand-col__logo">
              <BrandMark size={34} />
              <span>Triplanio</span>
            </span>
            <span className="brand-col__eyebrow">Triplanio</span>
            <h2 className="brand-col__tag">
              {t('auth.brand_tag_pre')} <span className="accent">{t('auth.brand_tag_accent')}</span> {t('auth.brand_tag_post')}
            </h2>
            <p className="brand-col__sub">
              {t('auth.brand_sub')}
            </p>
          </header>

          <div className="preview" role="img" aria-label={t('auth.preview_aria')}>
            <div className="preview__stage">
              <div className="appframe">
                <div className="appframe__bar">
                  <span className="appframe__dot appframe__dot--r" />
                  <span className="appframe__dot appframe__dot--y" />
                  <span className="appframe__dot appframe__dot--g" />
                  <span className="appframe__url">app.triplanio.com · iberia-summer-26</span>
                </div>
                <div className="appframe__body">
                  <div className="trip-head">
                    <div className="trip-head__meta">{t('auth.preview_route_meta')}</div>
                    <div className="trip-head__title">{t('auth.preview_trip_name')}</div>
                    <div className="trip-head__cities">
                      <span className="city-chip"><span className="dot" style={{ background: 'var(--brand)' }} /> Lisbon</span>
                      <span className="city-chip"><span className="dot" style={{ background: 'var(--warm)' }} /> Porto</span>
                      <span className="city-chip"><span className="dot" style={{ background: 'var(--success)' }} /> Barcelona</span>
                    </div>
                  </div>
                  <div className="trip-tl">
                    <div className="trip-tl__day">{t('auth.preview_day')}</div>
                    <div className="trip-tl__row">
                      <span className="ico">
                        <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor"><path d="M21 12.5 3 18l4-5-4-5 18 5.5a.5.5 0 0 1 0 1z"/></svg>
                      </span>
                      <span className="lbl"><strong>LHR → LIS</strong><span className="sub">British Airways 503</span></span>
                      <span className="tag">{t('auth.preview_flight')}</span>
                      <span className="time">10:25</span>
                    </div>
                    <div className="trip-tl__row">
                      <span className="ico ico--green">
                        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><path d="M3 18v-7a3 3 0 0 1 3-3h12a3 3 0 0 1 3 3v7"/><path d="M3 14h18"/></svg>
                      </span>
                      <span className="lbl"><strong>Memmo Alfama</strong><span className="sub">check-in</span></span>
                      <span className="tag tag--green">{t('auth.preview_hotel')}</span>
                      <span className="time">15:00</span>
                    </div>
                    <div className="trip-tl__row">
                      <span className="ico ico--warm">
                        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><rect x="3" y="7" width="18" height="13" rx="2"/><circle cx="12" cy="13.5" r="3.5"/></svg>
                      </span>
                      <span className="lbl"><strong>Pastéis de Belém</strong><span className="sub">pastry crawl</span></span>
                      <span className="tag tag--warm">{t('auth.preview_activity')}</span>
                      <span className="time">15:30</span>
                    </div>
                  </div>
                  <div className="trip-foot">
                    <div className="trip-foot__lab">{t('auth.preview_budget')}</div>
                    <div className="trip-foot__total">
                      <span className="big">€4,820</span>
                      <span className="ccy">· $5,210 · ₽491k</span>
                    </div>
                    <span className="trip-foot__delta">{t('auth.preview_delta')}</span>
                  </div>
                </div>
              </div>
              <div className="appnudge">
                <span className="av">AI</span>
                <div>
                  <div className="ttl">{t('auth.preview_nudge_title')}</div>
                  <div className="sub">{t('auth.preview_nudge_sub')}</div>
                </div>
              </div>
            </div>
          </div>

          <div className="brand-col__trust">
            <span>{t('auth.trust_free')}</span>
            <span className="pip" />
            <span>EN · RU · ES</span>
            <span className="pip" />
            <span>{t('auth.trust_browser')}</span>
          </div>
        </div>
      </aside>
    </main>
  );
}
