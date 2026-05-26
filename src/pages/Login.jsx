import React, { useState, useEffect, useRef } from 'react';
import { supabase } from '@/api/supabaseClient';
import { BRAND_NAME, BRAND_LOGO_URL } from '@/lib/brand';
import './login.css';

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

// ── Brand SVG mark ────────────────────────────────────────────────────────────
function BrandMark({ size = 28 }) {
  return (
    <svg width={size} height={size} viewBox="0 0 341 341" aria-hidden="true">
      <path fill="#2167e2" d="M33.95 -0.27C40.71 -0.45 48.13 -0.30 54.93 -0.30L94.51 -0.31L214.85 -0.31L278.87 -0.31L298.19 -0.32C310.20 -0.32 319.36 -0.68 329.22 7.74C343.13 19.64 341.19 34.94 341.18 51.31L341.16 86.38L341.18 195.13L341.18 272.23L341.21 295.30C341.23 308.71 342.01 318.93 332.40 329.72C326.28 336.55 317.68 340.63 308.52 341.05C298.46 341.53 284.33 341.09 274.02 341.08L205.38 341.09L162.12 341.12C141.32 341.13 123.86 343.11 107.21 327.72C102.84 323.62 99.32 318.70 96.85 313.24C94.39 307.77 93.03 301.88 92.85 295.89C92.53 287.07 93.86 280.99 96.62 272.79C101.67 257.80 109.31 248.59 119.73 237.35C125.95 245.14 131.67 253.99 137.97 261.61C140.39 264.53 150.13 252.18 148.68 246.96C146.17 237.89 141.38 229.91 138.15 221.16C142.84 217.00 148.47 212.50 153.33 208.40C163.06 200.17 172.73 191.87 182.35 183.50C189.21 190.01 196.38 197.44 203.10 204.17L248.91 249.98C253.19 244.92 256.54 238.16 256.60 231.43C256.62 228.62 256.01 225.92 254.63 223.46C251.65 218.12 237.03 204.66 231.87 199.47C223.68 191.54 215.28 182.91 207.20 174.84L155.65 123.29L134.29 101.95C132.74 100.41 131.16 98.78 129.63 97.31C123.62 91.55 120.03 86.16 110.78 87.37C103.83 88.28 99.83 91.32 94.43 95.40C110.56 111.82 126.81 128.12 143.18 144.30C148.91 150.05 155.23 156.05 160.75 161.92C157.39 166.37 151.72 172.66 148.00 177.06C139.75 186.81 131.56 196.62 123.44 206.49C118.10 204.22 112.75 201.98 107.38 199.78C101.26 197.23 96.20 193.80 89.94 198.43C79.72 205.98 80.76 205.52 89.99 212.16C94.94 215.73 102.29 220.69 106.73 224.76C102.85 229.00 98.63 233.32 95.24 237.85C77.48 261.56 66.95 294.34 80.97 322.42C84.87 330.21 88.42 334.78 94.47 341.08C74.92 341.31 55.21 340.96 35.64 341.13C25.35 341.21 16.75 338.18 9.43 330.64C5.10 326.18 2.04 320.66 0.57 314.65C-0.91 308.63 -0.74 302.34 1.06 296.40C5.46 282.59 12.71 282.42 26.83 282.50L40.91 282.50C42.84 273.91 47.36 264.34 51.84 256.66C55.50 250.39 60.66 244.04 65.43 238.50C77.65 224.29 92.40 213.21 109.04 206.21C103.45 200.42 97.99 194.46 92.32 188.74L73.55 169.51L57.43 153.51C50.18 146.29 41.66 138.65 35.82 130.39C29.92 122.04 30.18 109.34 35.07 100.51C39.96 91.66 49.69 86.69 58.07 81.36C66.84 75.78 75.74 67.92 86.18 66.20C100.42 63.85 110.92 73.55 120.65 82.20C156.13 113.74 192.66 144.55 226.93 177.42C236.16 167.94 245.71 158.84 254.94 149.36C251.74 145.84 248.10 142.27 244.77 138.83L228.83 122.51L188.18 81.07L165.79 58.20C160.30 52.55 154.64 47.06 149.21 41.42C147.41 39.55 140.97 33.69 147.49 31.95C161.71 28.16 162.96 32.45 172.71 41.99C188.30 57.25 203.65 72.49 218.81 88.20C242.91 113.18 269.13 137.05 292.07 163.41C293.55 161.16 295.93 158.99 295.99 156.20C296.04 153.51 294.39 151.41 292.65 149.51L283.31 139.99L257.59 113.50C238.71 94.18 219.65 75.05 200.40 56.12L182.38 38.22C176.59 32.41 170.81 26.41 164.77 20.85C162.50 18.76 158.51 14.42 154.99 15.86C145.97 19.55 151.55 22.99 156.93 28.20C170.65 41.50 184.07 55.13 197.93 68.30C212.43 82.10 226.43 96.42 240.85 110.30C238.31 113.40 235.69 116.42 233.05 119.40C232.41 120.13 230.31 122.93 229.39 122.99C228.62 123.04 224.62 119.30 223.91 118.62L213.74 108.91L173.40 70.20L155.62 53.13C151.74 49.41 147.31 46.13 144.07 41.85C138.50 34.49 145.99 30.69 149.78 26.04L74.41 26.04L52.66 26.05C43.16 26.09 33.05 24.46 26.79 33.40C25.71 34.94 24.85 36.62 24.20 38.39C23.41 40.46 19.83 39.55 18.49 41.49C13.13 49.13 19.40 53.84 23.93 58.78C31.16 66.66 38.91 75.13 46.62 82.62C50.99 86.85 71.30 105.95 73.59 109.59C75.18 112.13 73.59 113.51 71.71 114.78C66.61 118.22 60.99 116.13 57.06 112.20L44.05 99.34L26.36 81.96C18.46 74.32 6.66 65.69 4.10 54.31C1.36 42.13 1.05 31.66 9.91 21.41C16.18 14.16 24.99 9.05 33.95 -0.27z"/>
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
      if (session) window.location.href = '/';
    });
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
        redirectTo: window.location.origin + '/',
        queryParams: { prompt: 'select_account' },
      },
    });
    if (error) { setError(error.message); setIsLoading(false); }
  };

  const handleApple = async () => {
    setIsLoading(true); setError(null);
    const { error } = await supabase.auth.signInWithOAuth({
      provider: 'apple',
      options: { redirectTo: window.location.origin + '/' },
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
