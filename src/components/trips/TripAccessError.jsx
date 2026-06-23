import React from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '@/lib/AuthContext';
import { useI18n } from '@/lib/i18n/I18nContext';
import { SystemStub } from '@/lib/PageNotFound';

// Shared "no access to this trip" screen. Rendered identically by TripView and
// the structure editor (TripStructureEdit) whenever the trip can't be loaded
// for the current user (403 / not a member / deleted). Single source so the
// two screens never diverge — extracted verbatim from TripView's ErrorScreen.
export default function TripAccessError({ onBack }) {
  const { t } = useI18n();
  const nav = useNavigate();
  const { logout } = useAuth();
  const loginOther = async () => {
    try { await logout?.(false); } catch { /* ignore */ }
    nav('/login');
  };
  const goBack = onBack || (() => nav('/trips'));
  return (
    <div style={{ minHeight: '100vh', background: 'var(--bg)' }}>
      <SystemStub
        icon="lock"
        tone="warm"
        title={t('trip.no_access_title')}
        body={t('trip.no_access_desc')}
        primary={{ label: t('trip.to_my_trips'), onClick: goBack }}
        secondary={{ label: t('trip.login_other'), onClick: loginOther }}
      />
    </div>
  );
}
