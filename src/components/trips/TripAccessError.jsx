import React from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '@/lib/AuthContext';
import { useI18n } from '@/lib/i18n/I18nContext';
import { SystemStub } from '@/lib/PageNotFound';
import { useZoneHref } from '@/components/site/zoneCta';
import { LOGIN_PATH } from '@/lib/authEntry';

// Shared "no access to this trip" screen. Rendered identically by TripView and
// the structure editor (TripStructureEdit) whenever the trip can't be loaded
// for the current user (403 / not a member / deleted). Single source so the
// two screens never diverge — extracted verbatim from TripView's ErrorScreen.
export default function TripAccessError({ onBack }) {
  const { t } = useI18n();
  const nav = useNavigate();
  const zoneHref = useZoneHref();
  const { logout } = useAuth();
  const loginOther = async () => {
    try { await logout?.(false); } catch { /* ignore */ }
    // Адрес входа — через резолвер зоны, а не голым `/login` (TRIP-533; почему
    // именно так — в докблоке `useZoneHref`).
    nav(zoneHref(LOGIN_PATH));
  };
  const goBack = onBack || (() => nav('/trips'));
  return (
    <div style={{ minHeight: '100vh' }}>
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
