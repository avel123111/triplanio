import React, { useEffect, useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { track, setRefTripId } from '@/lib/analytics';
import { supabase } from '@/api/supabaseClient';
import { invokeFn } from '@/lib/invokeFn';
import { useI18n } from '@/lib/i18n/I18nContext';

const PENDING_KEY = 'postLoginRedirect';
// Own logo served from the repo (public/triplanio-logo.png) rather than
// hotlinked off triplanio.com; same vendoring canon as public/partners (TRIP-245).
const LOGO_URL = '/triplanio-logo.png';

const STYLES = `
.jt-wrap{min-height:100vh;display:flex;align-items:center;justify-content:center;padding:24px;
  font-family:'Golos Text',ui-sans-serif,system-ui,-apple-system,sans-serif;color:#16294A;
  background:radial-gradient(900px 480px at 50% -8%,rgba(33,115,200,.12),transparent 62%),radial-gradient(700px 420px at 100% 110%,rgba(98,166,240,.10),transparent 60%),#F4F7FC;}
.jt-card{width:100%;max-width:440px;background:#fff;border:1px solid #E9E8F2;border-radius:24px;
  box-shadow:0 18px 50px -20px rgba(22,41,74,.28);padding:48px 40px 40px;text-align:center;}
.jt-logo{height:38px;width:auto;margin:0 auto 30px;display:block;}
.jt-card h1{margin:0;}
.jt-lede{color:#7A7689;margin:12px 0 0;}
.jt-btn{color:#fff;
  background:linear-gradient(135deg,#62A6F0 0%,#2173C8 100%);border:none;border-radius:14px;width:100%;
  padding:15px 22px;margin-top:28px;cursor:pointer;box-shadow:0 10px 24px -8px rgba(33,115,200,.55);
  transition:transform .15s,box-shadow .15s;display:inline-flex;align-items:center;justify-content:center;gap:8px;}
.jt-btn:hover{transform:translateY(-2px);box-shadow:0 16px 32px -10px rgba(33,115,200,.62);}
.jt-btn:active{transform:translateY(0);}
.jt-btn--ghost{background:transparent;color:#2173C8;box-shadow:none;border:1.5px solid #E9E8F2;margin-top:14px;}
.jt-btn--ghost:hover{background:rgba(33,115,200,.06);border-color:#62A6F0;transform:none;}
.jt-chip{display:inline-flex;align-items:center;gap:8px;background:rgba(33,115,200,.08);color:#2173C8;
  padding:8px 14px;border-radius:999px;margin-bottom:22px;}
.jt-chip svg{width:15px;height:15px;}
.jt-spinner{width:46px;height:46px;margin:6px auto 22px;border-radius:50%;
  border:4px solid rgba(33,115,200,.16);border-top-color:#2173C8;animation:jt-spin .8s linear infinite;}
@keyframes jt-spin{to{transform:rotate(360deg);}}
.jt-badge{width:64px;height:64px;margin:4px auto 22px;border-radius:50%;background:#FAECE7;
  display:flex;align-items:center;justify-content:center;}
.jt-badge svg{width:30px;height:30px;color:#D85A30;}
@media(max-width:480px){.jt-card{padding:38px 24px 30px;border-radius:20px;}.jt-card h1{font-size:var(--fs-h3);}}
`;

export default function JoinTrip() {
  const { token } = useParams();
  const nav = useNavigate();
  const { t } = useI18n();
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

      const { data, error } = await invokeFn('redeemTripInviteLink', { body: { token } });
      if (cancelled) return;

      if (!error && data?.ok && data?.tripId) {
        try { sessionStorage.removeItem(PENDING_KEY); } catch { /* ignore */ }
        // the trip a user joined THROUGH is their referral source (K-factor)
        setRefTripId(data.tripId);
        track('trip_invite_joined', { trip_id: data.tripId });
        nav(`/trip/${data.tripId}`, { replace: true });
        return;
      }

      const reason = data?.reason;
      setErrKey(
        reason === 'expired' ? 'member.join_error_expired'
        : reason === 'revoked' ? 'member.join_error_revoked'
        : reason === 'blocked' ? 'member.join_error_blocked'
        : 'member.join_error_invalid',
      );
      setState('error');
    })();
    return () => { cancelled = true; };
  }, [token, nav]);

  return (
    <main className="jt-wrap">
      <style>{STYLES}</style>
      <div className="jt-card">
        <img className="jt-logo" src={LOGO_URL} alt="Triplanio" />

        {state === 'working' && (
          <>
            <div className="jt-spinner" />
            <h1 className="t-heading">{t('member.join_joining')}</h1>
            <p className="jt-lede t-body">{t('member.join_joining_sub')}</p>
          </>
        )}

        {state === 'signin' && (
          <>
            <div className="jt-chip t-meta">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M23 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/></svg>
              {t('member.join_invited')}
            </div>
            <h1 className="t-heading">{t('member.join_signin_title')}</h1>
            <p className="jt-lede t-body">{t('member.join_signin_lede')}</p>
            <button className="jt-btn t-label" onClick={() => { window.location.href = '/login'; }}>
              {t('member.join_signin_btn')}
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round"><path d="M5 12h14"/><path d="m13 6 6 6-6 6"/></svg>
            </button>
          </>
        )}

        {state === 'error' && (
          <>
            <div className="jt-badge">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M10.29 3.86 1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"/><line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/></svg>
            </div>
            <h1 className="t-heading">{t('member.join_error_title')}</h1>
            <p className="jt-lede t-body">{t(errKey)}</p>
            <button className="jt-btn t-label" onClick={() => nav('/trips', { replace: true })}>{t('member.join_to_app')}</button>
            <button className="jt-btn jt-btn--ghost t-label" onClick={() => { window.location.href = '/'; }}>{t('member.join_home')}</button>
          </>
        )}
      </div>
    </main>
  );
}
