import React from 'react';
import { useNavigate } from 'react-router-dom';
import { Icon } from '@/design/icons';
import { Avatar } from '@/design/index';
import NotificationsBell from '@/components/notifications/NotificationsBell';
import { useT } from '@/lib/i18n/I18nContext';

/**
 * Right-hand utility cluster of the unified <AppHeader>: theme toggle ·
 * notifications · account avatar (+ PRO badge). Always rendered inside the
 * brand-gradient `.app-header`, so the buttons use the on-brand white-on-glass
 * styling defined in app.css (`.app-header .icon-btn`, `.app-header__account`).
 *
 * The PRO badge sits next to the avatar and is hidden on mobile via CSS
 * (`.app-header__pro`).
 *
 * Props:
 *   user          - current user (avatar + label)
 *   isPro         - boolean; renders the PRO badge by the avatar
 *   isDark        - boolean; picks sun/moon icon
 *   onToggleTheme - () => void
 */
export default function HeaderActions({ user, isPro, isDark, onToggleTheme }) {
  const t = useT();
  const nav = useNavigate();
  return (
    <div className="app-header__util">
      <button className="icon-btn" title={t('nav.toggle_theme')} aria-label={t('nav.toggle_theme')} onClick={onToggleTheme} type="button">
        <Icon name={isDark ? 'sun' : 'moon'} size={17} />
      </button>
      <NotificationsBell triggerClassName="icon-btn" />
      <button
        className="app-header__account"
        title={user?.full_name || user?.email || t('nav.account')}
        aria-label={user?.full_name || user?.email || t('nav.account')}
        onClick={() => nav('/settings')}
        type="button"
      >
        <Avatar className="app-header__avatar" name={user?.full_name || user?.email || '?'} photo={user?.avatar_url} size="sm" />
        {isPro && <span className="app-header__pro">PRO</span>}
      </button>
    </div>
  );
}
