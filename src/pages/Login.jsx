import React, { useState, useEffect, useRef } from 'react';
import { Link } from 'react-router-dom';
import { track, withVisitCampaign } from '@/lib/analytics';
import { getSignupMarks, rememberAttributionForRedirect } from '@/lib/attribution';
import { supabase } from '@/api/supabaseClient';
import { invokeFn } from '@/lib/invokeFn';
import { reportAuthError } from '@/lib/reportDataError';
import { authErrorText, oauthRedirectError, stripOauthError } from '@/lib/authErrorText';
import { authFlowResult } from '@/lib/authFlowCode';
import { postLoginPath } from '@/lib/postLoginPath';
import { hasPendingHandoff } from '@/lib/plannerDraft';
import { initialAuthView, LOGIN_PATH, RECOVERY_PATH } from '@/lib/authEntry';
import { useI18n } from '@/lib/i18n/I18nContext';
import { useSiteCss } from '@/components/site/SiteChrome';
import AuthShell from '@/components/site/AuthShell';
import { setRemember as setRememberFlag } from '@/api/authStorage';

const GOOGLE_CLIENT_ID = import.meta.env.VITE_GOOGLE_CLIENT_ID;

// Куда человек попадает после входа. ОДНО место, а не восемь: из этого экрана
// ведут восемь дверей, каждая ЗАМЕНЯЕТ документ, и решение «несёт ли адрес
// метку кампании» должно приниматься здесь — иначе девятая дверь молча приедет
// без метки, ровно как приехала One Tap (метку теряло хранилище, адрес бы донёс).
//
// Двери двух видов, и обе несут метку — разделяет их только форма адреса:
//   · postLoginHref      — навигация, которую делаем МЫ (путь).
//   · postLoginRedirectTo — адрес, который отдаём SUPABASE (полный, с origin):
//     `redirectTo` / `emailRedirectTo`.
//
// Вторая ветка метку не несла, пока не проверили ЧУЖУЮ сторону, а не свою
// (TRIP-493). Замерено на dev-проекте зондом `/auth/v1/verify` с заведомо
// негодным токеном — он отвечает 303 и показывает готовый адрес возврата:
//   · адрес ВНЕ списка Redirect URLs не ломает вход, а молча уезжает на Site
//     URL — то есть человек попал бы на лендинг вместо приложения (аллоу-лист
//     несёт `https://triplanio.com/**` и `https://www.triplanio.com/**`, `**`
//     покрывает и строку запроса, поэтому метка через него проходит);
//   · query СОХРАНЯЕТСЯ дословно, а своё Supabase дописывает во ФРАГМЕНТ —
//     столкнуться с нашей меткой ему нечем.
// Наша сторона тоже чиста: `safeRedirect` в signupPrecheck и
// requestPasswordReset смотрит только на хост, query ему безразличен.
const postLoginHref = () => withVisitCampaign(postLoginPath());
const postLoginRedirectTo = () => withVisitCampaign(window.location.origin + postLoginPath());

/* floor-exempt: dsshare +30 — неавторизованная зона живёт на СВОЕЙ ДС (site.css
   §AUTH), а не на app-DS из src/design: перенос логина/join с компонентов
   src/design на зонные примитивы законно опускает долю app-DS (метрика dsShareBp
   считает именно app-DS). Решение «зона на своей ДС» — апрув Pavel (TRIP-460). */


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

// Prototype v5.7 field-validation (data-rule). Pure: returns the auth.* i18n key
// for the inline error, or null when the value is acceptable. Empty always fails
// as `field_required` first (mirrors the prototype's `check`), then per-rule.
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;
function fieldError(rule, value, other) {
  const v = (value || '').trim();
  if (!v) return 'field_required';
  if (rule === 'email' && !EMAIL_RE.test(v)) return 'field_email';
  if (rule === 'password' && !meetsPasswordPolicy(v)) return 'field_pw_short';
  if (rule === 'name' && v.length < 2) return 'field_name';
  if (rule === 'match' && value !== other) return 'field_match';
  return null;
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
    <svg className="apple-mark" width="18" height="18" viewBox="0 0 24 24" fill="currentColor">
      <path d="M17.05 12.04c-.03-2.6 2.12-3.85 2.22-3.91-1.21-1.77-3.09-2.01-3.76-2.04-1.6-.16-3.13.94-3.94.94-.83 0-2.07-.92-3.41-.9-1.75.03-3.37 1.02-4.27 2.59-1.83 3.17-.47 7.86 1.32 10.43.87 1.26 1.91 2.67 3.27 2.62 1.31-.05 1.8-.85 3.39-.85 1.58 0 2.03.85 3.42.82 1.41-.02 2.31-1.28 3.18-2.55 1-1.46 1.42-2.88 1.45-2.95-.03-.01-2.78-1.07-2.81-4.2zm-2.6-7.7c.72-.88 1.21-2.1 1.07-3.31-1.04.05-2.3.69-3.05 1.56-.66.78-1.25 2.02-1.09 3.21 1.16.09 2.34-.59 3.07-1.46z"/>
    </svg>
  );
}

// Circular refresh icon for the "resend" button (prototype #i-refresh).
function IconRefresh() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M20 11.5A8 8 0 0 0 6.3 6.3L4 8.5m0 4A8 8 0 0 0 17.7 17.7L20 15.5" />
      <path d="M4 4v4.5h4.5M20 20v-4.5h-4.5" />
    </svg>
  );
}

// Field lead icons (prototype #i-mail/#i-lock/#i-user). Rendered as a direct
// `.lead` child of `.control` so the §AUTH rule `.control>.lead` positions them.
// The site sprite (LandingSprite) carries only #i-lock, so all three are inlined
// verbatim from the prototype for a self-contained, exact match.
function LeadMail() {
  return (
    <svg className="lead" viewBox="0 0 24 24" aria-hidden="true">
      <rect x="3" y="5" width="18" height="14" rx="2.5" fill="none" stroke="currentColor" strokeWidth="1.9" />
      <path fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round" d="m4 7.6 8 5.8 8-5.8" />
    </svg>
  );
}
function LeadLock() {
  return (
    <svg className="lead" viewBox="0 0 24 24" aria-hidden="true">
      <rect x="5" y="10.4" width="14" height="9.8" rx="2.6" fill="none" stroke="currentColor" strokeWidth="1.9" />
      <path fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" d="M8.2 10.4V8a3.8 3.8 0 0 1 7.6 0v2.4" />
    </svg>
  );
}
function LeadUser() {
  return (
    <svg className="lead" viewBox="0 0 24 24" aria-hidden="true">
      <circle cx="12" cy="8.2" r="3.6" fill="none" stroke="currentColor" strokeWidth="1.9" />
      <path fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" d="M4.6 20c.7-3.6 3.8-5.8 7.4-5.8s6.7 2.2 7.4 5.8" />
    </svg>
  );
}
// Checkmark for the remember-me box and the password rules — reuses the site
// sprite symbol (#i-check) that AuthShell mounts via LandingSprite.
function IconCheck() {
  return <svg viewBox="0 0 24 24" aria-hidden="true"><use href="#i-check" /></svg>;
}
// Lock glyph for the reset screen's status tile (#i-lock is in the site sprite).
function IconLockStatus() {
  return <svg viewBox="0 0 24 24" aria-hidden="true"><use href="#i-lock" /></svg>;
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

// Инлайн-строка ошибки (иконка + сообщение). Зонный `.alert` скрыт по умолчанию
// (display:none), показывается модификатором `.show` — рендерим сразу с ним,
// т.к. компонент монтируется только при наличии ошибки.
function AuthError({ children }) {
  return (
    <div className="alert show" role="alert">
      <IconShieldAlert />
      <div><span>{children}</span></div>
    </div>
  );
}

// ── Main component ────────────────────────────────────────────────────────────
export default function Login() {
  const { t, lang, setLang } = useI18n();

  // Адрес, по которому экран открыли, — ОДИН снимок на оба решения ниже
  // (маршрут восстановления и стартовый вид). Ветку «рендер без `window`»
  // выписываем здесь один раз, а не по разу в каждом из них; заглушка — обычный
  // вход, то есть ровно то поведение, что было до появления видов в адресе.
  const entry = typeof window === 'undefined'
    ? { pathname: LOGIN_PATH, search: '' }
    : window.location;

  // Password-recovery deep link (/reset-password) reuses this same auth shell
  // (left forms + right brand panel) but opens straight on the new-password form
  // and must NOT bounce to /trips even though the recovery token creates a session.
  const isRecoveryRoute = entry.pathname === RECOVERY_PATH;

  // С КАКОГО ВИДА ОТКРЫВАЕМСЯ — решает АДРЕС, а не всегда «вход». Экран один на
  // три двери, и раньше он открывался формой ВХОДА для всех, включая
  // человека, который только что нажал «Начать бесплатно»: заголовок «Продолжим
  // с того же места» встречал того, кто здесь впервые, а регистрация пряталась
  // ссылкой под формой. Правило читается из `authEntry` — оттуда же, откуда
  // кнопки зоны берут адрес, чтобы половины контракта не разъехались.
  //
  // Снимок на монтировании, а не подписка на адрес: дальше видом управляет сам
  // экран (`goto`), и перечитывание адреса откатывало бы выбор человека.
  const [view, setView]           = useState(() => initialAuthView(entry.pathname, entry.search)); // login | signup | reset | reset-sent | reset-password | reset-done
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
  // Inline field errors, keyed by input id → auth.* i18n key. Replaces the native
  // browser validation bubbles with the prototype's per-field .invalid + err-slot.
  const [errs, setErrs] = useState({});
  const clearFieldErr = (id) => setErrs((p) => (p[id] ? { ...p, [id]: undefined } : p));
  // Validate a form's fields (each {id, rule, value, other?}); reveal inline
  // errors, focus the first bad one, and return true only when all pass.
  const runValidation = (fields) => {
    const next = {};
    let firstBad = null;
    for (const f of fields) {
      const key = fieldError(f.rule, f.value, f.other);
      if (key) { next[f.id] = key; if (!firstBad) firstBad = f.id; }
    }
    setErrs(next);
    if (firstBad) { const el = document.getElementById(firstBad); if (el) el.focus(); return false; }
    return true;
  };
  // Inline error row for a field (prototype .err-slot). Empty until the field is invalid.
  const errSlot = (id) => (
    <div className="err-slot"><div><p className="av-err"><IconShieldAlert /><span>{errs[id] ? t(`auth.${errs[id]}`) : ''}</span></p></div></div>
  );
  const pwScore = scorePassword(password);
  // Once per visit to the signup form. Retyping a password the client rejects
  // must not multiply the first step of the funnel, and skipping those attempts
  // altogether would hide the people the password rule turns away — the
  // conversion rate would read better than it is. Cleared on every view change.
  const signupStartedRef = useRef(false);

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
      if (session) window.location.href = postLoginHref();
    });
  }, [isRecoveryRoute]);

  // The auth screen is light-only by design (white form + photo brand panel).
  // A dark theme stored from the authed app sets [data-theme=dark] on <html>,
  // which flips --ink/--surface and breaks the right-panel preview (white text
  // on white, dark plates). The shared zone hook forces light and restores the
  // user's theme on exit (TRIP-460 §7.2).
  // cssReady — site.css грузится рантайм-<link>ом; до его загрузки разметка без
  // стилей, а SVG-иконки без width/height вспыхивают во весь экран (FOUC). Как
  // на лендинге, не рисуем зону, пока лист не готов.
  const cssReady = useSiteCss();


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

  // Отказ OAuth приезжает ПАРАМЕТРАМИ АДРЕСА, а не исключением: провайдер
  // уводит документ и возвращает его с `error`/`error_description`, поэтому ни
  // один `catch` вокруг `signInWithOAuth` этого не видит. До TRIP-445 их не
  // читал ни один файл в `src/` — человек, нажавший «Отмена» у Google, молча
  // оказывался снова на форме, будто кнопка не работает.
  //
  // Один эффект покрывает все три входа сразу (Google, Apple, One Tap): все
  // возвращаются на этот же экран одним и тем же механизмом.
  useEffect(() => {
    const oauthErr = oauthRedirectError(window.location.search, window.location.hash);
    if (!oauthErr) return;
    setError(t(oauthErr.key));
    // Отмена — это выбор человека, а не сбой: в Sentry идёт только настоящая
    // ошибка провайдера, иначе мониторинг заполнится передумавшими.
    if (oauthErr.key !== 'auth.err_oauth_cancelled') {
      reportAuthError({ code: oauthErr.code, message: oauthErr.description }, 'oauth_redirect');
    }
    // Снимаем ИЗ АДРЕСА только сам отказ: без этого перезагрузка показывает ту
    // же ошибку заново, а проза сервера остаётся в адресной строке и уезжает
    // дальше — в реферер и в аналитику. Метка кампании живёт в этой же строке
    // запроса и обязана пережить чистку (см. `stripOauthError`).
    const { search, hash } = stripOauthError(window.location.search, window.location.hash);
    try {
      window.history.replaceState({}, '', window.location.pathname + search + hash);
    } catch { /* адрес — косметика: не роняем экран, если replaceState недоступен */ }
  }, [t]);

  // Reset error + pw visibility on view change.
  //
  // ★ Пропускаем ПЕРВЫЙ проход: на монтировании вид ещё не менялся, а эффект
  // всё равно отрабатывал и затирал ошибку, поставленную при загрузке экрана —
  // ровно так молча пропадало сообщение об отказе OAuth (оно приходит из
  // адреса, то есть тоже на монтировании). Лечим смыслом, а не порядком
  // объявления эффектов: «сброс при СМЕНЕ вида» и должен срабатывать только на
  // смене, иначе любая будущая ошибка «с порога» исчезнет так же незаметно.
  const viewMountedRef = useRef(false);
  useEffect(() => {
    if (!viewMountedRef.current) { viewMountedRef.current = true; return; }
    setError(null); setErrs({}); setShowPw(false); setShowPw2(false); signupStartedRef.current = false;
  }, [view]);

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

  // One provider button, two meanings depending on which form is open: from the
  // signup view it is an intent to REGISTER (TRIP-316 B — the microconversion an
  // ad campaign can actually optimise for, there will be 5-10x more of these
  // than registrations), anywhere else a login attempt. Registration itself is
  // counted once, server-side of this screen, in AuthContext.
  const trackAuthIntent = (method) =>
    track(view === 'signup' ? 'signup_started' : 'user_logged_in', { method });

  // A rejected registration never reaches AuthContext, so this screen is the
  // only place its reason exists. The view gate lives HERE, in one place: the
  // provider buttons are shared with the login form, and a failed login is not
  // a failed signup. The email form only exists on the signup view.
  const trackSignupFailed = (reason, method = 'email') => {
    if (view === 'signup') track('signup_failed', { method, reason });
  };

  // ── Auth handlers ──
  const handleGoogle = async () => {
    setIsLoading(true); setError(null);
    trackAuthIntent('google');
    // The whole document is handed to the provider, so the in-memory snapshot of
    // this visit dies here. Every entry that leaves the page needs this line — a
    // fourth provider added without it silently loses campaign attribution.
    rememberAttributionForRedirect();
    const { error } = await supabase.auth.signInWithOAuth({
      provider: 'google',
      options: {
        redirectTo: postLoginRedirectTo(),
        queryParams: { prompt: 'select_account' },
      },
    });
    if (error) { reportAuthError(error, 'oauth'); trackSignupFailed('oauth_error', 'google'); setError(authErrorText(t, error)); setIsLoading(false); }
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
    // One Tap does not leave the page, but it finishes with a hard navigation to
    // postLoginPath() — a new document all the same.
    rememberAttributionForRedirect();
    try {
      const { error } = await supabase.auth.signInWithIdToken({
        provider: 'google',
        token: response.credential,
        nonce,
      });
      if (error) {
        reportAuthError(error, 'id_token');
        setError(authErrorText(t, error));
        setIsLoading(false);
        return;
      }
      // The fourth way in, and until now the only silent one. Tracked on SUCCESS
      // (unlike the redirect flows, which can only report the click) and always
      // as a login: the prompt appears by itself, so it carries no intent to
      // register — and the Google callback is registered once on mount, so the
      // current form view is not readable here anyway. A first-timer arriving
      // this way still gets user_signed_up from AuthContext.
      // `method` stays the provider, same vocabulary as every other auth event
      // (and as app_metadata.provider on user_signed_up), so a funnel can be
      // joined on it; the entry point goes in its own property.
      track('user_logged_in', { method: 'google', surface: 'one_tap' });
      // Success: AuthContext picks up SIGNED_IN but does not navigate, and this
      // page stays mounted on /login - redirect explicitly (same as email login
      // and the Google redirect flow's redirectTo). Keep isLoading=true so the
      // buttons don't flash re-enabled before the navigation tears the page down.
      window.location.href = postLoginHref();
    } catch (err) {
      reportAuthError(err, 'id_token');
      setError(authErrorText(t, err));
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
          // FedCM is now REQUIRED for One Tap to render in Chrome after the
          // third-party-cookie phase-out — without this flag the prompt is
          // silently suppressed (the "почти никогда не появляется" symptom).
          use_fedcm_for_prompt: true,
        });
        // The notification callback surfaces WHY a prompt didn't display
        // (dismissed/skipped/cooldown) instead of failing silently — useful
        // for diagnosing One Tap in the field.
        window.google?.accounts.id.prompt((n) => {
          if (n?.isNotDisplayed?.() || n?.isSkippedMoment?.()) {
            const reason = n.getNotDisplayedReason?.() || n.getSkippedReason?.();
            if (reason) track('one_tap_suppressed', { reason });
          }
        });
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
    trackAuthIntent('apple');
    // The whole document is handed to the provider, so the in-memory snapshot of
    // this visit dies here. Every entry that leaves the page needs this line — a
    // fourth provider added without it silently loses campaign attribution.
    rememberAttributionForRedirect();
    const { error } = await supabase.auth.signInWithOAuth({
      provider: 'apple',
      options: { redirectTo: postLoginRedirectTo() },
    });
    if (error) { reportAuthError(error, 'oauth'); trackSignupFailed('oauth_error', 'apple'); setError(authErrorText(t, error)); setIsLoading(false); }
  };

  const handleLogin = async (e) => {
    e.preventDefault(); setError(null);
    if (!runValidation([{ id: 'l-email', rule: 'email', value: email }, { id: 'l-pw', rule: 'required', value: password }])) return;
    setIsLoading(true);
    // ДО входа решаем, куда ляжет сессия: localStorage (запомнить) или
    // sessionStorage (только вкладка). Адаптер читает флаг при записи сессии.
    setRememberFlag(remember);
    const { error } = await supabase.auth.signInWithPassword({ email, password });
    if (error) { reportAuthError(error, 'signin'); setError(authErrorText(t, error)); setIsLoading(false); return; }
    track('user_logged_in', { method: 'email' });
    window.location.href = postLoginHref();
  };

  const handleSignup = async (e) => {
    e.preventDefault(); setError(null);
    // Through the same helper as the provider buttons, and before the client
    // rules run: someone the password policy turns away DID try to register.
    if (!signupStartedRef.current) { signupStartedRef.current = true; trackAuthIntent('email'); }
    if (!runValidation([
      { id: 's-name', rule: 'name', value: name },
      { id: 's-email', rule: 'email', value: email },
      { id: 's-pw', rule: 'password', value: password },
    ])) {
      // Preserve the weak-password funnel signal even though the message is inline now.
      if (password && !meetsPasswordPolicy(password)) trackSignupFailed('weak_password');
      return;
    }
    setIsLoading(true);

    // Preflight: Supabase hides whether an email already exists, so ask the
    // server (signupPrecheck) before creating the account. This lets us show an
    // explicit message instead of a silent "check your email".
    const { data: pre, error: preErr } = await invokeFn('signupPrecheck', {
      body: { email, redirectTo: postLoginRedirectTo() },
    });
    // Every rejection carries its own reason: without it the gap between
    // "opened the form" and "registered" is one number that cannot be acted on
    // — unclear whether people did not want to or simply could not (TRIP-316 B).
    if (preErr) { trackSignupFailed('precheck_failed'); setError(t('auth.err_generic')); setIsLoading(false); return; }
    // Тот же разбор, что в handleReset/handleResend, но по словарю флоу
    // `signup`: один и тот же `rate_limited` значит здесь другое (лимит на IP,
    // а не на сброс пароля) и несёт свой текст — словари раздельные намеренно.
    const pf = authFlowResult('signup', pre?.code);
    if (pf.sent) {
      // Account exists but was never confirmed — the server re-sent the link.
      track('signup_email_sent', { method: 'email', resent: pf.resent });
      startCooldown(email);
      setSentEmail(email); setResendFlow('signup'); goto('reset-sent'); setIsLoading(false); return;
    }
    if (!pf.proceed) { trackSignupFailed(pf.reason); setError(t(pf.errorKey)); setIsLoading(false); return; }

    // pf.proceed → no such account yet, proceed with the real signup.
    const { error } = await supabase.auth.signUp({
      email,
      password,
      options: {
        // `signup_attribution` rides auth metadata because email is the ONE
        // entry that can finish on another device — the confirmation link is
        // often opened on a phone, where the in-memory snapshot of the visit
        // does not exist. AuthContext reads it back when it creates the profile
        // row (TRIP-311) and hands it to both the columns and the campaign
        // marks. The raw marks, not one reader's projection of them, so the
        // carrier stays the same shape whichever border it crosses (TRIP-335).
        // Undefined when the visit carried no marks.
        data: { full_name: name, language: lang, signup_attribution: getSignupMarks() || undefined },
        // Land confirmed users in the app, not on the Site-URL landing page.
        emailRedirectTo: postLoginRedirectTo(),
      },
    });
    if (error) { reportAuthError(error, 'signup'); trackSignupFailed('signup_error'); setError(authErrorText(t, error)); setIsLoading(false); }
    // NOT a registration: confirming the address is mandatory (Supabase Auth
    // mailer_autoconfirm = false), so at this point the person is on the "check
    // your inbox" screen and may never come back. `user_signed_up` fires later,
    // in AuthContext, when the confirmed account first opens the app.
    else { track('signup_email_sent', { method: 'email' }); startCooldown(email); setSentEmail(email); setResendFlow('signup'); goto('reset-sent'); setIsLoading(false); }
  };

  // Set a new password during a Supabase recovery session (reached via the
  // /reset-password email link). detectSessionInUrl exchanges the recovery token
  // into a session on load; updateUser then writes the new password. For a
  // Google-only account this ADDS an email/password login alongside Google.
  const handleNewPassword = async (e) => {
    e.preventDefault(); setError(null);
    if (!runValidation([
      { id: 'rp-pw', rule: 'password', value: password },
      { id: 'rp-pw2', rule: 'match', value: password2, other: password },
    ])) return;
    setIsLoading(true);
    const { error } = await supabase.auth.updateUser({ password });
    if (error) {
      reportAuthError(error, 'update_password');
      // session-missing / протухшая recovery-ссылка разруливаются внутри маппера
      // (типизированная AuthSessionMissingError + recovery-коды), поэтому мини-хак
      // с регуляркой по error.message больше не нужен.
      setError(authErrorText(t, error)); setIsLoading(false); return;
    }
    goto('reset-done'); setIsLoading(false);
  };

  // From the "password updated" screen: drop the recovery session and send the
  // user to a clean login so they sign in with the new password.
  const finishToLogin = async () => {
    const { error } = await supabase.auth.signOut();
    if (error) reportAuthError(error, 'signout');
    window.location.href = '/login';
  };

  const handleReset = async (e) => {
    e.preventDefault(); setError(null);
    if (!runValidation([{ id: 'r-email', rule: 'email', value: email }])) return;
    setIsLoading(true);
    // Routed through requestPasswordReset so the server can reveal an unknown
    // email and enforce the 5/hour-per-email limit. The email itself is still
    // sent by Supabase Auth (same template) from inside that function.
    const { data, error: invErr } = await invokeFn('requestPasswordReset', {
      body: { email, redirectTo: window.location.origin + '/reset-password' },
    });
    setIsLoading(false);
    if (invErr) { setError(t('auth.err_generic')); return; }
    // Один разбор кода на все три обработчика (`authFlowCode.js`). Раньше здесь
    // стояла собственная лесенка `if (data?.code === …)`, и `send_failed`
    // проваливался в её общий хвост: письмо не ушло, а человек читал «что-то
    // пошло не так» и уходил ждать письмо, которого не будет.
    const res = authFlowResult('reset', data?.code);
    if (res.sent) { startCooldown(email); setSentEmail(email); setResendFlow('reset'); goto('reset-sent'); return; }
    setError(t(res.errorKey || 'auth.err_generic'));
    if (res.cooldown) {
      if (!cooldownLeft(email)) startCooldown(email);
      setResendLeft(cooldownLeft(email));
    }
  };

  // Re-send from the "email sent" screen, gated by the 60s cooldown timer.
  const handleResend = async () => {
    if (resendLeft > 0 || isLoading) return;
    setError(null); setIsLoading(true);
    const flow = resendFlow === 'signup' ? 'signup' : 'reset';
    const fn = flow === 'signup' ? 'signupPrecheck' : 'requestPasswordReset';
    const body = flow === 'signup'
      ? { email: sentEmail, redirectTo: postLoginRedirectTo() }
      : { email: sentEmail, redirectTo: window.location.origin + '/reset-password' };
    const { data, error: invErr } = await invokeFn(fn, { body });
    setIsLoading(false);
    if (invErr) { setError(t('auth.err_generic')); return; }
    const res = authFlowResult(flow, data?.code);
    if (!res.sent) {
      // ★ Раньше сюда проваливался ЛЮБОЙ неопознанный код — включая
      // `send_failed` — прямо в ветку успеха ниже: кнопка блокировалась
      // таймером на минуту, а сообщения не было вовсе. Теперь письмо считается
      // ушедшим, только если код это прямо говорит.
      // `errorKey` пуст у `ok` (аккаунт исчез между шагами — письма не будет,
      // но и отказом сервер это не назвал): общий текст честнее тишины.
      setError(t(res.errorKey || 'auth.err_generic'));
      if (res.cooldown) {
        if (!cooldownLeft(sentEmail)) startCooldown(sentEmail);
        setResendLeft(cooldownLeft(sentEmail) || 60);
      }
      return;
    }
    // The server re-sent the confirmation link — same fact as in handleSignup,
    // so the same event: otherwise the funnel step would mean different things
    // depending on which button the person pressed.
    if (res.resent) track('signup_email_sent', { method: 'email', resent: true });
    startCooldown(sentEmail); setResendLeft(60);
  };

  // Все шесть экранов всегда смонтированы (как в прототипе): активным управляет
  // AuthShell по activeScreen, кроссфейдя и анимируя высоту. Скрытые .screen
  // инертны (visibility:hidden + pointer-events:none), а хендлеры/стейт кейнуты
  // на view, так что невидимые формы бездействуют.
  /**
   * Человека привёл сюда гостевой планировщик, и его маршрут ждёт (TRIP-505).
   *
   * ★ ПРЕДИКАТ — «МАРШРУТ ОТЛОЖЕН», А НЕ «АДРЕС ВОЗВРАТА ТАКОЙ-ТО». Подпись
   * обещает сохранить МАРШРУТ, поэтому честно её показывать ровно тогда, когда
   * маршрут действительно есть. Адрес возврата мог остаться и от другого пути
   * (приглашение, адрес приложения, открытый без сессии) — там это обещание
   * было бы ложью. Заодно снимается второй читатель `postLoginPath` (гард 2j:
   * у адреса после входа один автор).
   *
   * Меняется ТОЛЬКО подпись под заголовком — на обоих экранах, вход и
   * регистрация, потому что человек волен выбрать любой. Это ровно то, зачем
   * подпись существует, поэтому ни новой разметки, ни нового класса: экран
   * входа — самый чувствительный файл в проекте, и форк его ради одной строки
   * был бы несоразмерной ценой.
   *
   * Читается один раз за монтирование: за жизнь экрана хранилище не меняется, а
   * `useState` с инициализатором не даёт подписи мигать между экранами.
   */
  const [fromPlanner] = useState(() => hasPendingHandoff('manual', Date.now()));

  const activeScreen = {
    login: 'signin',
    signup: 'signup',
    reset: 'forgot',
    'reset-sent': 'sent',
    'reset-password': 'reset',
    'reset-done': 'done',
  }[view];

  // Не рисуем до готовности site.css — иначе FOUC (иконки во весь экран).
  if (!cssReady) return null;

  return (
    <AuthShell lang={lang} setLang={setLang} activeScreen={activeScreen}>

            {/* ── Вход ── */}
            {(
              <section className="screen" data-screen="signin">
                <div className="screen-head">
                  <h1 dangerouslySetInnerHTML={{ __html: t('auth.login_title') }} />
                  <p className="av-sub">{t(fromPlanner ? 'auth.lede_save_trip' : 'auth.login_lede')}</p>
                </div>
                {error && <AuthError>{error}</AuthError>}
                <div className="social">
                  <button type="button" className="av-btn-social" onClick={handleGoogle} disabled={isLoading}><IconGoogle /><span>{t('auth.oauth_google_signin')}</span></button>
                  <button type="button" className="av-btn-social" onClick={handleApple} disabled={isLoading}><IconApple /><span>{t('auth.oauth_apple_signin')}</span></button>
                </div>
                <div className="or"><span>{t('auth.or_email')}</span></div>
                <form onSubmit={handleLogin} noValidate>
                  <div className={`av-field${errs['l-email'] ? ' invalid' : ''}`}>
                    <div className="field-top"><label htmlFor="l-email">{t('auth.email_label')}</label></div>
                    <div className="control">
                      <LeadMail />
                      <input className="av-input" id="l-email" type="email" autoComplete="email" placeholder="you@example.com" required aria-invalid={errs['l-email'] ? true : undefined} value={email} onChange={e => { setEmail(e.target.value); clearFieldErr('l-email'); }} disabled={isLoading} />{/* i18n-ignore: пример адреса, как в прототипе */}
                    </div>
                    {errSlot('l-email')}
                  </div>
                  <div className={`av-field${errs['l-pw'] ? ' invalid' : ''}`}>
                    <div className="field-top">
                      <label htmlFor="l-pw">{t('auth.password')}</label>
                      {/* nav-exempt: якорь смены экрана внутри страницы, не навигация */}
                      <a href="#" className="aux" onClick={e => { e.preventDefault(); goto('reset'); }}>{t('auth.forgot')}</a>
                    </div>
                    <div className="control">
                      <LeadLock />
                      <input className="av-input has-toggle" id="l-pw" type={showPw ? 'text' : 'password'} autoComplete="current-password" placeholder={t('auth.pw_placeholder')} required aria-invalid={errs['l-pw'] ? true : undefined} value={password} onChange={e => { setPassword(e.target.value); clearFieldErr('l-pw'); }} disabled={isLoading} />
                      <button type="button" className="pw-toggle" aria-label={showPw ? t('auth.pw_hide') : t('auth.pw_show')} onClick={() => setShowPw(v => !v)}><IconEye off={showPw} /></button>
                    </div>
                    {errSlot('l-pw')}
                  </div>
                  <label className="av-check">
                    <input type="checkbox" checked={remember} onChange={e => setRemember(e.target.checked)} disabled={isLoading} />
                    <span className="box" aria-hidden="true"><IconCheck /></span>
                    <span className="txt">{t('auth.remember')}</span>
                  </label>
                  <button type="submit" className={`av-btn av-btn-primary av-btn-block${isLoading ? ' loading' : ''}`} disabled={isLoading}>
                    <span className="av-btn-label"><span>{t('auth.sign_in')}</span></span>
                    <span className="av-spin" aria-hidden="true" />
                  </button>
                </form>
                {/* nav-exempt: якорь смены экрана внутри страницы, не навигация */}
                <p className="alt">{t('auth.no_account')}{' '}<a href="#" onClick={e => { e.preventDefault(); goto('signup'); }}>{t('auth.sign_up')}</a></p>
              </section>
            )}

            {/* ── Регистрация ── */}
            {(
              <section className="screen" data-screen="signup">
                <div className="screen-head">
                  <h1 dangerouslySetInnerHTML={{ __html: t('auth.signup_title') }} />
                  <p className="av-sub">{t(fromPlanner ? 'auth.lede_save_trip' : 'auth.signup_lede')}</p>
                </div>
                {error && <AuthError>{error}</AuthError>}
                <div className="social">
                  <button type="button" className="av-btn-social" onClick={handleGoogle} disabled={isLoading}><IconGoogle /><span>{t('auth.oauth_google_signup')}</span></button>
                  <button type="button" className="av-btn-social" onClick={handleApple} disabled={isLoading}><IconApple /><span>{t('auth.oauth_apple_signup')}</span></button>
                </div>
                <div className="or"><span>{t('auth.or_email')}</span></div>
                <form onSubmit={handleSignup} noValidate>
                  <div className={`av-field${errs['s-name'] ? ' invalid' : ''}`}>
                    <div className="field-top"><label htmlFor="s-name">{t('auth.name_label')}</label></div>
                    <div className="control">
                      <LeadUser />
                      <input className="av-input" id="s-name" type="text" autoComplete="name" placeholder={t('auth.name_placeholder')} required aria-invalid={errs['s-name'] ? true : undefined} value={name} onChange={e => { setName(e.target.value); clearFieldErr('s-name'); }} disabled={isLoading} />
                    </div>
                    {errSlot('s-name')}
                  </div>
                  <div className={`av-field${errs['s-email'] ? ' invalid' : ''}`}>
                    <div className="field-top"><label htmlFor="s-email">{t('auth.email_label')}</label></div>
                    <div className="control">
                      <LeadMail />
                      <input className="av-input" id="s-email" type="email" autoComplete="email" placeholder="you@example.com" required aria-invalid={errs['s-email'] ? true : undefined} value={email} onChange={e => { setEmail(e.target.value); clearFieldErr('s-email'); }} disabled={isLoading} />{/* i18n-ignore: пример адреса, как в прототипе */}
                    </div>
                    {errSlot('s-email')}
                  </div>
                  <div className={`av-field${errs['s-pw'] ? ' invalid' : ''}`} data-strength={password ? pwScore : undefined}>
                    <div className="field-top"><label htmlFor="s-pw">{t('auth.password')}</label></div>
                    <div className="control">
                      <LeadLock />
                      <input className="av-input has-toggle" id="s-pw" type={showPw ? 'text' : 'password'} autoComplete="new-password" placeholder={t('auth.newpw_placeholder')} required minLength={8} aria-invalid={errs['s-pw'] ? true : undefined} value={password} onChange={e => { setPassword(e.target.value); clearFieldErr('s-pw'); }} disabled={isLoading} />
                      <button type="button" className="pw-toggle" aria-label={showPw ? t('auth.pw_hide') : t('auth.pw_show')} onClick={() => setShowPw(v => !v)}><IconEye off={showPw} /></button>
                    </div>
                    {errSlot('s-pw')}
                    <div className="strength"><i /><i /><i /><i /></div>
                    <p className="strength-row"><span>{t('auth.pw_strength')}</span><b>{STRENGTH_LABELS[pwScore]}</b></p>
                  </div>
                  <button type="submit" className={`av-btn av-btn-primary av-btn-block${isLoading ? ' loading' : ''}`} disabled={isLoading}>
                    <span className="av-btn-label"><span>{t('auth.create_account')}</span></span>
                    <span className="av-spin" aria-hidden="true" />
                  </button>
                </form>
                <p className="legal">
                  {t('auth.terms_pre')}{' '}
                  <Link to="/terms">{t('auth.terms_link')}</Link> {t('auth.terms_and')} <Link to="/privacy">{t('auth.privacy_link')}</Link>.
                </p>
                {/* nav-exempt: якорь смены экрана внутри страницы, не навигация */}
                <p className="alt">{t('auth.have_account')}{' '}<a href="#" onClick={e => { e.preventDefault(); goto('login'); }}>{t('auth.sign_in')}</a></p>
              </section>
            )}

            {/* ── Восстановление (запрос) ── */}
            {(
              <section className="screen" data-screen="forgot">
                <div className="screen-head">
                  <h1 dangerouslySetInnerHTML={{ __html: t('auth.reset_title') }} />
                  <p className="av-sub">{t('auth.reset_lede')}</p>
                </div>
                {error && <AuthError>{error}</AuthError>}
                <form onSubmit={handleReset} noValidate>
                  <div className={`av-field${errs['r-email'] ? ' invalid' : ''}`}>
                    <div className="field-top"><label htmlFor="r-email">{t('auth.email_label')}</label></div>
                    <div className="control">
                      <LeadMail />
                      <input className="av-input" id="r-email" type="email" autoComplete="email" placeholder="you@example.com" required aria-invalid={errs['r-email'] ? true : undefined} value={email} onChange={e => { setEmail(e.target.value); clearFieldErr('r-email'); }} disabled={isLoading} />{/* i18n-ignore: пример адреса, как в прототипе */}
                    </div>
                    {errSlot('r-email')}
                  </div>
                  <button type="submit" className={`av-btn av-btn-primary av-btn-block${isLoading ? ' loading' : ''}`} disabled={isLoading || resendLeft > 0}>
                    <span className="av-btn-label"><span>{t('auth.reset_submit')}</span></span>
                    <span className="av-spin" aria-hidden="true" />
                  </button>
                </form>
                {/* nav-exempt: якорь смены экрана внутри страницы, не навигация */}
                <p className="alt"><a href="#" onClick={e => { e.preventDefault(); goto('login'); }}>{t('auth.back_to_signin')}</a></p>
              </section>
            )}

            {/* ── Письмо отправлено ── */}
            {(
              <section className="screen" data-screen="sent">
                <div className="status-icon"><IconMail /></div>
                <div className="screen-head">
                  <h1>{t('auth.sent_title')}</h1>
                  <p className="av-sub">{t('auth.sent_to')}</p>
                </div>
                {error && <AuthError>{error}</AuthError>}
                <div className="mailto">
                  <IconMail />
                  <b>{sentEmail}</b>
                </div>
                <div className="av-btn-row">
                  {/* nav-exempt: внешний сервис почты */}
                  <a className="av-btn av-btn-primary av-btn-block" href="https://mail.google.com" target="_blank" rel="noopener noreferrer">
                    <span className="av-btn-label"><span>{t('auth.open_gmail')}</span><IconExternalLink /></span>
                  </a>
                  <button type="button" className={`av-btn av-btn-quiet av-btn-block${isLoading ? ' loading' : ''}`} onClick={handleResend} disabled={isLoading || resendLeft > 0}>
                    <span className="av-btn-label"><IconRefresh /><span>{t('auth.resend')}</span></span>
                    <span className="av-spin" aria-hidden="true" />
                  </button>
                </div>
                <p className="timer">
                  {resendLeft > 0
                    ? <>{t('auth.no_email')}{' '}<b>{t('auth.resend_in').replace('{s}', String(resendLeft))}</b></>
                    : t('auth.sent_spam')}
                </p>
                {/* nav-exempt: якорь смены экрана внутри страницы, не навигация */}
                <p className="alt"><a href="#" onClick={e => { e.preventDefault(); goto('login'); }}>{t('auth.back_to_signin')}</a></p>
              </section>
            )}

            {/* ── Новый пароль ── */}
            {(
              <section className="screen" data-screen="reset">
                <div className="status-icon"><IconLockStatus /></div>
                <div className="screen-head">
                  <h1 dangerouslySetInnerHTML={{ __html: t('auth.newpw_title') }} />
                  <p className="av-sub">{t('auth.newpw_lede')}</p>
                </div>
                {error && <AuthError>{error}</AuthError>}
                <form onSubmit={handleNewPassword} noValidate>
                  <div className={`av-field${errs['rp-pw'] ? ' invalid' : ''}`} data-strength={password ? pwScore : undefined}>
                    <div className="field-top"><label htmlFor="rp-pw">{t('auth.new_password')}</label></div>
                    <div className="control">
                      <LeadLock />
                      <input className="av-input has-toggle" id="rp-pw" type={showPw ? 'text' : 'password'} autoComplete="new-password" placeholder={t('auth.newpw_placeholder')} required minLength={8} aria-invalid={errs['rp-pw'] ? true : undefined} value={password} onChange={e => { setPassword(e.target.value); clearFieldErr('rp-pw'); }} disabled={isLoading} />
                      <button type="button" className="pw-toggle" aria-label={showPw ? t('auth.pw_hide') : t('auth.pw_show')} onClick={() => setShowPw(v => !v)}><IconEye off={showPw} /></button>
                    </div>
                    <div className="strength"><i /><i /><i /><i /></div>
                    <p className="strength-row"><span>{t('auth.pw_strength')}</span><b>{STRENGTH_LABELS[pwScore]}</b></p>
                    <div className="rules">
                      <p className={`rule ${password.length >= 8 ? 'ok' : ''}`}><i><IconCheck /></i><span>{t('auth.rule_len')}</span></p>
                      <p className={`rule ${/[A-Za-zА-Яа-яЁё]/.test(password) ? 'ok' : ''}`}><i><IconCheck /></i><span>{t('auth.rule_letter')}</span></p>
                      <p className={`rule ${/\d/.test(password) ? 'ok' : ''}`}><i><IconCheck /></i><span>{t('auth.rule_num')}</span></p>
                    </div>
                  </div>
                  <div className={`av-field${errs['rp-pw2'] ? ' invalid' : ''}`}>
                    <div className="field-top"><label htmlFor="rp-pw2">{t('auth.repeat_password')}</label></div>
                    <div className="control">
                      <LeadLock />
                      <input className="av-input has-toggle" id="rp-pw2" type={showPw2 ? 'text' : 'password'} autoComplete="new-password" placeholder={t('auth.repeat_placeholder')} required aria-invalid={errs['rp-pw2'] ? true : undefined} value={password2} onChange={e => { setPassword2(e.target.value); clearFieldErr('rp-pw2'); }} disabled={isLoading} />
                      <button type="button" className="pw-toggle" aria-label={showPw2 ? t('auth.pw_hide') : t('auth.pw_show')} onClick={() => setShowPw2(v => !v)}><IconEye off={showPw2} /></button>
                    </div>
                    <div className="rules" aria-live="polite">
                      <p className={`rule ${password.length > 0 && password === password2 ? 'ok' : ''}`}><i><IconCheck /></i><span>{t('auth.rule_match')}</span></p>
                    </div>
                  </div>
                  <button type="submit" className={`av-btn av-btn-primary av-btn-block${isLoading ? ' loading' : ''}`} disabled={isLoading}>
                    <span className="av-btn-label"><span>{t('auth.save_password')}</span></span>
                    <span className="av-spin" aria-hidden="true" />
                  </button>
                </form>
                {/* nav-exempt: якорь смены экрана внутри страницы, не навигация */}
                <p className="alt"><a href="#" onClick={e => { e.preventDefault(); finishToLogin(); }}>{t('auth.back_to_signin')}</a></p>
              </section>
            )}

            {/* ── Пароль обновлён ── */}
            {(
              <section className="screen" data-screen="done">
                <svg className="tick" viewBox="0 0 80 80" aria-hidden="true">
                  <circle cx="40" cy="40" r="33" /><path d="M26 41.5 35.5 51 55 30" />
                </svg>
                <div className="screen-head">
                  <h1>{t('auth.done_title')}</h1>
                  <p className="av-sub">{t('auth.done_lede')}</p>
                </div>
                <div className="av-btn-row">
                  <button type="button" className="av-btn av-btn-primary av-btn-block" onClick={finishToLogin}>
                    <span className="av-btn-label"><span>{t('auth.sign_in')}</span><IconArrow /></span>
                    <span className="av-spin" aria-hidden="true" />
                  </button>
                </div>
              </section>
            )}

    </AuthShell>
  );
}
