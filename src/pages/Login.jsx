import React, { useState, useEffect, useRef } from 'react';
import { supabase } from '@/api/supabaseClient';
import { BRAND_NAME, BRAND_LOGO_URL } from '@/lib/brand';
import './login.css';

const GOOGLE_CLIENT_ID = import.meta.env.VITE_GOOGLE_CLIENT_ID;

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
const STRENGTH_LABELS = [
  'Используйте 8+ символов, цифры и заглавные.',
  'Слабый — добавьте длину или регистр.',
  'Средний — добавьте цифру или символ.',
  'Хороший — почти.',
  'Надёжный.',
];

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
  const [view, setView]           = useState('login'); // login | signup | reset | reset-sent
  const [email, setEmail]         = useState('');
  const [password, setPassword]   = useState('');
  const [name, setName]           = useState('');
  const [showPw, setShowPw]       = useState(false);
  const [remember, setRemember]   = useState(true);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError]         = useState(null);
  const [sentEmail, setSentEmail] = useState('');
  const pwScore = scorePassword(password);

  // Redirect if already logged in
  useEffect(() => {
    supabase.auth.getSession().then(({ data: { session } }) => {
      if (session) window.location.href = '/trips';
    });
  }, []);

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
  useEffect(() => { setError(null); setShowPw(false); }, [view]);

  const goto = (v) => setView(v);

  // ── Auth handlers ──
  const handleGoogle = async () => {
    setIsLoading(true); setError(null);
    const { error } = await supabase.auth.signInWithOAuth({
      provider: 'google',
      options: {
        redirectTo: window.location.origin + '/trips',
        queryParams: { prompt: 'select_account' },
      },
    });
    if (error) { setError(error.message); setIsLoading(false); }
  };

  // Google One Tap credential handler — exchanges the Google JWT for a
  // Supabase session via signInWithIdToken. AuthContext picks up SIGNED_IN
  // and handles profile creation + redirect to /trips.
  const handleOneTapCredential = async (response) => {
    setIsLoading(true);
    setError(null);
    try {
      const { error } = await supabase.auth.signInWithIdToken({
        provider: 'google',
        token: response.credential,
      });
      if (error) {
        setError(error.message);
        setIsLoading(false);
      }
    } catch (err) {
      setError(err.message);
      setIsLoading(false);
    }
  };

  // Load Google Identity Services script on demand and show the One Tap
  // prompt. Scoped to this page so other routes don't pay the cost.
  useEffect(() => {
    if (!GOOGLE_CLIENT_ID) return;
    const script = document.createElement('script');
    script.src = 'https://accounts.google.com/gsi/client';
    script.async = true;
    script.defer = true;
    script.onload = () => {
      window.google?.accounts.id.initialize({
        client_id: GOOGLE_CLIENT_ID,
        callback: handleOneTapCredential,
        itp_support: true,
      });
      window.google?.accounts.id.prompt();
    };
    document.head.appendChild(script);
    return () => {
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
      options: { redirectTo: window.location.origin + '/trips' },
    });
    if (error) { setError(error.message); setIsLoading(false); }
  };

  const handleLogin = async (e) => {
    e.preventDefault(); setIsLoading(true); setError(null);
    const { error } = await supabase.auth.signInWithPassword({ email, password });
    if (error) { setError(error.message); setIsLoading(false); }
    // on success onAuthStateChange in AuthContext handles redirect
  };

  const handleSignup = async (e) => {
    e.preventDefault(); setIsLoading(true); setError(null);
    const { error } = await supabase.auth.signUp({
      email,
      password,
      options: { data: { full_name: name } },
    });
    if (error) { setError(error.message); setIsLoading(false); }
    else { setSentEmail(email); goto('reset-sent'); setIsLoading(false); }
  };

  const handleReset = async (e) => {
    e.preventDefault(); setIsLoading(true); setError(null);
    const { error } = await supabase.auth.resetPasswordForEmail(email, {
      redirectTo: window.location.origin + '/reset-password',
    });
    if (error) { setError(error.message); setIsLoading(false); }
    else { setSentEmail(email); goto('reset-sent'); setIsLoading(false); }
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
                <div className="eyebrow">Вход в аккаунт</div>
                <h1 className="auth__h1">С возвращением.</h1>
                <p className="lede">Откройте свои маршруты, бюджеты и общие планы — там, где вы их оставили.</p>

                <div className="socials">
                  <button type="button" className="btn-social" onClick={handleGoogle} disabled={isLoading}>
                    <IconGoogle /><span>Google</span>
                  </button>
                  <button type="button" className="btn-social" onClick={handleApple} disabled={isLoading}>
                    <IconApple /><span>Apple</span>
                  </button>
                </div>

                <div className="divider"><span>или по email</span></div>

                {error && <div className="auth-error">{error}</div>}

                <form className="auth__inputs" onSubmit={handleLogin}>
                  <div className="field">
                    <div className="field__top">
                      <label className="field__label" htmlFor="l-email">Email</label>
                    </div>
                    <input className="auth-input" id="l-email" type="email" autoComplete="email"
                      placeholder="you@example.com" required value={email}
                      onChange={e => setEmail(e.target.value)} disabled={isLoading} />
                  </div>

                  <div className="field">
                    <div className="field__top">
                      <label className="field__label" htmlFor="l-pw">Пароль</label>
                      <span className="field__hint">
                        <a href="#" onClick={e => { e.preventDefault(); goto('reset'); }}>Забыли пароль?</a>
                      </span>
                    </div>
                    <div className="input-wrap">
                      <input className={`auth-input auth-input--trail`} id="l-pw"
                        type={showPw ? 'text' : 'password'} autoComplete="current-password"
                        placeholder="Минимум 8 символов" required value={password}
                        onChange={e => setPassword(e.target.value)} disabled={isLoading} />
                      <button type="button" className="input-trail"
                        aria-label={showPw ? 'Скрыть пароль' : 'Показать пароль'}
                        onClick={() => setShowPw(v => !v)}>
                        <IconEye off={showPw} />
                      </button>
                    </div>
                  </div>

                  <div className="row-between">
                    <label className="check">
                      <input type="checkbox" checked={remember} onChange={e => setRemember(e.target.checked)} />
                      <span>Запомнить меня</span>
                    </label>
                  </div>

                  <button type="submit" className="btn-primary" disabled={isLoading}>
                    {isLoading ? 'Загрузка…' : 'Войти'}<IconArrow />
                  </button>
                </form>

                <p className="auth__switch">
                  Ещё нет аккаунта?{' '}
                  <button type="button" onClick={() => goto('signup')}>Зарегистрироваться</button>
                </p>
              </>
            )}

            {/* ── Sign up ── */}
            {view === 'signup' && (
              <>
                <div className="eyebrow">Создать аккаунт</div>
                <h1 className="auth__h1">Спланируйте первую поездку.</h1>
                <p className="lede">Бесплатно, без карты. Соберите маршрут, бюджет и компанию — в одном месте.</p>

                <div className="socials">
                  <button type="button" className="btn-social" onClick={handleGoogle} disabled={isLoading}>
                    <IconGoogle /><span>Google</span>
                  </button>
                  <button type="button" className="btn-social" onClick={handleApple} disabled={isLoading}>
                    <IconApple /><span>Apple</span>
                  </button>
                </div>

                <div className="divider"><span>или по email</span></div>

                {error && <div className="auth-error">{error}</div>}

                <form className="auth__inputs" onSubmit={handleSignup}>
                  <div className="field">
                    <div className="field__top">
                      <label className="field__label" htmlFor="s-name">Имя</label>
                    </div>
                    <input className="auth-input" id="s-name" type="text" autoComplete="name"
                      placeholder="Как к вам обращаться" required value={name}
                      onChange={e => setName(e.target.value)} disabled={isLoading} />
                  </div>

                  <div className="field">
                    <div className="field__top">
                      <label className="field__label" htmlFor="s-email">Email</label>
                    </div>
                    <input className="auth-input" id="s-email" type="email" autoComplete="email"
                      placeholder="you@example.com" required value={email}
                      onChange={e => setEmail(e.target.value)} disabled={isLoading} />
                  </div>

                  <div className="field">
                    <div className="field__top">
                      <label className="field__label" htmlFor="s-pw">Пароль</label>
                    </div>
                    <div className="input-wrap">
                      <input className="auth-input auth-input--trail" id="s-pw"
                        type={showPw ? 'text' : 'password'} autoComplete="new-password"
                        placeholder="Минимум 8 символов" required minLength={8} value={password}
                        onChange={e => setPassword(e.target.value)} disabled={isLoading} />
                      <button type="button" className="input-trail"
                        aria-label={showPw ? 'Скрыть пароль' : 'Показать пароль'}
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
                    Регистрируясь, вы соглашаетесь с <a href="#">условиями</a> и <a href="#">политикой конфиденциальности</a>.
                  </p>

                  <button type="submit" className="btn-primary" style={{ marginTop: 18 }} disabled={isLoading}>
                    {isLoading ? 'Загрузка…' : 'Создать аккаунт'}<IconArrow />
                  </button>
                </form>

                <p className="auth__switch">
                  Уже есть аккаунт?{' '}
                  <button type="button" onClick={() => goto('login')}>Войти</button>
                </p>
              </>
            )}

            {/* ── Reset request ── */}
            {view === 'reset' && (
              <>
                <div className="eyebrow">Восстановление</div>
                <h1 className="auth__h1">Сбросьте пароль.</h1>
                <p className="lede">Введите email, на который зарегистрирован аккаунт — пришлём ссылку для смены пароля.</p>

                {error && <div className="auth-error">{error}</div>}

                <form className="auth__inputs" onSubmit={handleReset} style={{ marginTop: 28 }}>
                  <div className="field">
                    <div className="field__top">
                      <label className="field__label" htmlFor="r-email">Email</label>
                    </div>
                    <input className="auth-input" id="r-email" type="email" autoComplete="email"
                      placeholder="you@example.com" required value={email}
                      onChange={e => setEmail(e.target.value)} disabled={isLoading} />
                  </div>

                  <button type="submit" className="btn-primary" style={{ marginTop: 6 }} disabled={isLoading}>
                    {isLoading ? 'Загрузка…' : 'Прислать ссылку'}<IconArrow />
                  </button>
                </form>

                <p className="auth__switch">
                  Вспомнили пароль?{' '}
                  <button type="button" onClick={() => goto('login')}>Войти</button>
                </p>
              </>
            )}

            {/* ── Reset sent ── */}
            {view === 'reset-sent' && (
              <div className="confirm">
                <div className="confirm__icon"><IconMail /></div>
                <h2 style={{ fontFamily: 'var(--font-display)', fontSize: 28, letterSpacing: '-0.025em', color: 'var(--ink)' }}>
                  Письмо отправлено.
                </h2>
                <p className="lede" style={{ margin: '14px auto 0', maxWidth: '36ch' }}>
                  Ссылка ушла на{' '}
                  <span className="confirm__email">{sentEmail}</span>.
                  <br />Не пришло за пару минут — посмотрите в «Спам».
                </p>
                <div className="confirm__actions">
                  <a className="btn-ghost" href="https://mail.google.com" target="_blank" rel="noopener noreferrer">
                    Открыть Gmail <IconExternalLink />
                  </a>
                  <button type="button" className="btn-ghost" onClick={() => goto('login')}>
                    К входу
                  </button>
                </div>
                <p className="auth__switch" style={{ marginTop: 24 }}>
                  Не получили письмо?{' '}
                  <button type="button" onClick={() => goto('reset')}>Отправить ещё раз</button>
                </p>
              </div>
            )}

          </div>
        </div>

        <footer className="auth__foot">
          <span>© 2026 Triplanio</span>
          <div className="auth__foot-links">
            <a href="#">Условия</a>
            <a href="#">Приватность</a>
            <a href="#">Поддержка</a>
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
              Вся поездка. <span className="accent">Один</span> красивый план.
            </h2>
            <p className="brand-col__sub">
              Маршруты в нескольких городах, общие планы, бюджеты в любой валюте — и AI, который берёт на себя рутину.
            </p>
          </header>

          <div className="preview" role="img" aria-label="Превью маршрута Иберия — Лето 2026">
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
                    <div className="trip-head__meta">Маршрут · 12.07 → 23.07</div>
                    <div className="trip-head__title">Иберия — Лето '26</div>
                    <div className="trip-head__cities">
                      <span className="city-chip"><span className="dot" style={{ background: 'var(--brand)' }} /> Lisbon</span>
                      <span className="city-chip"><span className="dot" style={{ background: 'var(--warm)' }} /> Porto</span>
                      <span className="city-chip"><span className="dot" style={{ background: 'var(--success)' }} /> Barcelona</span>
                    </div>
                  </div>
                  <div className="trip-tl">
                    <div className="trip-tl__day">Сб · 12.07</div>
                    <div className="trip-tl__row">
                      <span className="ico">
                        <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor"><path d="M21 12.5 3 18l4-5-4-5 18 5.5a.5.5 0 0 1 0 1z"/></svg>
                      </span>
                      <span className="lbl"><strong>LHR → LIS</strong><span className="sub">British Airways 503</span></span>
                      <span className="tag">Перелёт</span>
                      <span className="time">10:25</span>
                    </div>
                    <div className="trip-tl__row">
                      <span className="ico ico--green">
                        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><path d="M3 18v-7a3 3 0 0 1 3-3h12a3 3 0 0 1 3 3v7"/><path d="M3 14h18"/></svg>
                      </span>
                      <span className="lbl"><strong>Memmo Alfama</strong><span className="sub">check-in</span></span>
                      <span className="tag tag--green">Отель</span>
                      <span className="time">15:00</span>
                    </div>
                    <div className="trip-tl__row">
                      <span className="ico ico--warm">
                        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><rect x="3" y="7" width="18" height="13" rx="2"/><circle cx="12" cy="13.5" r="3.5"/></svg>
                      </span>
                      <span className="lbl"><strong>Pastéis de Belém</strong><span className="sub">pastry crawl</span></span>
                      <span className="tag tag--warm">Активность</span>
                      <span className="time">15:30</span>
                    </div>
                  </div>
                  <div className="trip-foot">
                    <div className="trip-foot__lab">Бюджет</div>
                    <div className="trip-foot__total">
                      <span className="big">€4,820</span>
                      <span className="ccy">· $5,210 · ₽491k</span>
                    </div>
                    <span className="trip-foot__delta">−€180 от плана</span>
                  </div>
                </div>
              </div>
              <div className="appnudge">
                <span className="av">AI</span>
                <div>
                  <div className="ttl">Выезд в 14:10</div>
                  <div className="sub">Поезд в Порту, 30 мин от отеля</div>
                </div>
              </div>
            </div>
          </div>

          <div className="brand-col__trust">
            <span>Бесплатно для старта</span>
            <span className="pip" />
            <span>EN · RU · ES</span>
            <span className="pip" />
            <span>Работает в браузере</span>
          </div>
        </div>
      </aside>
    </main>
  );
}
