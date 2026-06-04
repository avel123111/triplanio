import React from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '@/lib/AuthContext';
import { Icon } from '@/design/icons';
import { Btn } from '@/design/index';
import { useT } from '@/lib/i18n/I18nContext';

// Shared system-stub layout - one visual family with the no-access page
// (mirrors ScreenSystem.jsx §33): icon-in-circle + title + explanation + action.
export function SystemStub({ icon, tone = 'brand', title, body, primary, secondary }) {
  const colors = {
    brand:   ['var(--brand-soft)',   'var(--brand)'],
    warm:    ['var(--warm-soft, var(--brand-soft))', 'var(--warm)'],
    warning: ['var(--warning-soft)', 'var(--warning)'],
  };
  const [bg, fg] = colors[tone] || colors.brand;
  return (
    <div style={{
      display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center',
      minHeight: 'calc(100vh - 120px)', padding: 32, textAlign: 'center',
    }}>
      <div style={{
        width: 96, height: 96, borderRadius: 24, background: bg, color: fg,
        display: 'grid', placeItems: 'center', marginBottom: 28,
      }}>
        <Icon name={icon} size={42} />
      </div>
      <h1 style={{ fontSize: 32, marginBottom: 12, maxWidth: 520 }}>{title}</h1>
      <div className="muted" style={{ fontSize: 'var(--fs-strong)', maxWidth: 480, lineHeight: 1.55, marginBottom: 24 }}>{body}</div>
      <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', justifyContent: 'center' }}>
        {primary && <Btn variant="primary" size="lg" onClick={primary.onClick}>{primary.label}</Btn>}
        {secondary && <Btn variant="ghost" size="lg" onClick={secondary.onClick}>{secondary.label}</Btn>}
      </div>
    </div>
  );
}

export default function PageNotFound() {
  const t = useT();
  const nav = useNavigate();
  const { user } = useAuth();
  // Logged in → back to the trip collection; otherwise → public landing.
  const goHome = () => nav(user ? '/trips' : '/');
  return (
    <SystemStub
      icon="search"
      tone="brand"
      title={t('sys.not_found_title')}
      body={t('sys.not_found_body')}
      primary={{ label: user ? t('sys.to_my_trips') : t('sys.to_home'), onClick: goHome }}
    />
  );
}
