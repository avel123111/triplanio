import React, { useEffect, useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { track, setRefTripId } from '@/lib/analytics';
import { supabase } from '@/api/supabaseClient';
import { invokeFn } from '@/lib/invokeFn';
import { useI18n } from '@/lib/i18n/I18nContext';
import { useSiteTheme, useSiteCss } from '@/components/site/SiteChrome';
import AuthShell from '@/components/site/AuthShell';

const PENDING_KEY = 'postLoginRedirect';

// Maps the invite-link edge function's machine `code` to its error i18n key.
// null-prototype: `code` is an external edge value, so a lookup like
// code==='toString' must miss (→ invalid), not return an inherited method.
const ERR_KEY_BY_CODE = {
  __proto__: null,
  expired: 'member.join_error_expired',
  revoked: 'member.join_error_revoked',
  blocked: 'member.join_error_blocked',
};

export default function JoinTrip() {
  const { token } = useParams();
  const nav = useNavigate();
  const { t, lang, setLang } = useI18n();
  useSiteTheme();
  useSiteCss(); // зонная ДС (site.css §AUTH) — join живёт в той же оболочке, что логин
  const [state, setState] = useState('working'); // working | signin | error
  const [errKey, setErrKey] = useState('member.join_error_invalid');

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const { data: { session } } = await supabase.auth.getSession();
      if (cancelled) return;

      if (!session) {
        try { sessionStorage.setItem(PENDING_KEY, `/join/${token}`); } catch { /* ignore */ }
        setState('signin');
        return;
      }

      const { data, error, code } = await invokeFn('redeemTripInviteLink', { body: { token } });
      if (cancelled) return;

      if (!error && data?.ok && data?.tripId) {
        try { sessionStorage.removeItem(PENDING_KEY); } catch { /* ignore */ }
        // the trip a user joined THROUGH is their referral source (K-factor)
        setRefTripId(data.tripId);
        track('trip_invite_joined', { trip_id: data.tripId });
        nav(`/trip/${data.tripId}`, { replace: true });
        return;
      }

      // The invite-link edge function emits a machine `code` in its `{ error, code }`
      // body; supabase-js leaves `data` null on a non-2xx, so read the `code` that
      // invokeFn parsed off the error response (not `data`, which is null here).
      setErrKey(ERR_KEY_BY_CODE[code] || 'member.join_error_invalid');
      setState('error');
    })();
    return () => { cancelled = true; };
  }, [token, nav]);

  return (
    <AuthShell lang={lang} setLang={setLang}>
      {state === 'working' && (
        <section className="screen av-is-active" data-screen="join-working">
          <div className="join-spin" aria-hidden="true" />
          <div className="screen-head">
            <h1 dangerouslySetInnerHTML={{ __html: t('member.join_joining') }} />
            <p className="av-sub">{t('member.join_joining_sub')}</p>
          </div>
        </section>
      )}

      {state === 'signin' && (
        <section className="screen av-is-active" data-screen="join-signin">
          <div className="screen-head">
            <div className="av-brow">{t('member.join_invited')}</div>
            <h1 dangerouslySetInnerHTML={{ __html: t('member.join_signin_title') }} />
            <p className="av-sub">{t('member.join_signin_lede')}</p>
          </div>
          <div className="av-btn-row">
            {/* nav(), не window.location: сохраняет снимок атрибуции в памяти,
                который Login прочитает при регистрации (TRIP-329). Обе кнопки ведут
                на /login (единая дверь входа/регистрации), как и раньше. */}
            <button type="button" className="av-btn av-btn-primary av-btn-block" onClick={() => nav('/login')}>
              <span className="av-btn-label"><span>{t('member.join_signin_btn')}</span><svg viewBox="0 0 24 24" aria-hidden="true"><use href="#i-arrow-r" /></svg></span>
              <span className="av-spin" aria-hidden="true" />
            </button>
            <button type="button" className="av-btn av-btn-quiet av-btn-block" onClick={() => nav('/login')}>
              <span className="av-btn-label"><span>{t('member.join_signin_alt')}</span></span>
              <span className="av-spin" aria-hidden="true" />
            </button>
          </div>
        </section>
      )}

      {state === 'error' && (
        <section className="screen av-is-active" data-screen="join-error">
          <div className="join-badge" aria-hidden="true">
            <svg width="30" height="30" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M10.29 3.86 1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z" />
              <line x1="12" y1="9" x2="12" y2="13" /><line x1="12" y1="17" x2="12.01" y2="17" />
            </svg>
          </div>
          <div className="screen-head">
            <h1>{t('member.join_error_title')}</h1>
            <p className="av-sub">{t(errKey)}</p>
          </div>
          <div className="av-btn-row">
            <button type="button" className="av-btn av-btn-primary av-btn-block" onClick={() => nav('/trips', { replace: true })}>
              <span className="av-btn-label"><span>{t('member.join_to_app')}</span></span>
              <span className="av-spin" aria-hidden="true" />
            </button>
            <button type="button" className="av-btn av-btn-quiet av-btn-block" onClick={() => nav('/')}>
              <span className="av-btn-label"><span>{t('member.join_home')}</span></span>
              <span className="av-spin" aria-hidden="true" />
            </button>
          </div>
        </section>
      )}
    </AuthShell>
  );
}
