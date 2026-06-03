import React from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '@/lib/AuthContext';
import { SystemStub } from '@/lib/PageNotFound';
import { useT } from '@/lib/i18n/I18nContext';

export default function TripAccessDenied() {
  const t = useT();
  const nav = useNavigate();
  const { logout } = useAuth();
  const loginOther = async () => {
    try { await logout?.(false); } catch { /* ignore */ }
    nav('/login');
  };
  return (
    <SystemStub
      icon="lock"
      tone="warm"
      title={t('sys.no_access_title')}
      body={t('sys.no_access_body')}
      primary={{ label: t('sys.to_my_trips'), onClick: () => nav('/trips') }}
      secondary={{ label: t('sys.login_other'), onClick: loginOther }}
    />
  );
}
