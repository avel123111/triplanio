/**
 * JoinTrip — invite-link landing page (route: /join/:token).
 *
 * Mounted BEFORE the auth gate in App.jsx, so it works for logged-out visitors:
 *   - logged in  → calls redeemTripInviteLink, then redirects to the trip
 *   - logged out → stashes the join path and sends the user to /login
 *                  (Login.postLoginPath brings them back here after sign-in)
 *
 * The role is bound to the token server-side, so it cannot be tampered with
 * via the URL.
 */
import React, { useEffect, useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { supabase } from '@/api/supabaseClient';
import { useI18n } from '@/lib/i18n/I18nContext';
import { BRAND_NAME } from '@/lib/brand';

const PENDING_KEY = 'postLoginRedirect';

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

      const { data, error } = await supabase.functions.invoke('redeemTripInviteLink', { body: { token } });
      if (cancelled) return;

      if (!error && data?.ok && data?.tripId) {
        try { sessionStorage.removeItem(PENDING_KEY); } catch { /* ignore */ }
        nav(`/trip/${data.tripId}`, { replace: true });
        return;
      }

      const reason = data?.reason;
      setErrKey(
        reason === 'expired' ? 'member.join_error_expired'
        : reason === 'revoked' ? 'member.join_error_revoked'
        : 'member.join_error_invalid',
      );
      setState('error');
    })();
    return () => { cancelled = true; };
  }, [token, nav]);

  return (
    <main style={{ minHeight: '100vh', display: 'grid', placeItems: 'center', padding: 24, textAlign: 'center' }}>
      <div style={{ maxWidth: 380 }}>
        <div style={{ fontWeight: 800, fontSize: 22, marginBottom: 16 }}>{BRAND_NAME}</div>

        {state === 'working' && (
          <>
            <span style={{
              display: 'inline-block', width: 22, height: 22,
              border: '3px solid currentColor', borderRightColor: 'transparent',
              borderRadius: '50%', animation: 'spin .7s linear infinite', marginBottom: 14,
            }} />
            <div>{t('member.join_joining')}</div>
          </>
        )}

        {state === 'signin' && (
          <>
            <p style={{ marginBottom: 16 }}>{t('member.join_signin_prompt')}</p>
            <button className="btn-primary" onClick={() => { window.location.href = '/login'; }}>
              {t('member.join_signin_btn')}
            </button>
          </>
        )}

        {state === 'error' && (
          <>
            <p style={{ marginBottom: 16 }}>{t(errKey)}</p>
            <button className="btn-primary" onClick={() => nav('/trips', { replace: true })}>
              {t('member.join_to_app')}
            </button>
          </>
        )}
      </div>
    </main>
  );
}
