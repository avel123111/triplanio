import React from 'react';
import { useNavigate } from 'react-router-dom';
import { Icon } from '@/design/icons';
import { Avatar } from '@/design/index';
import NotificationsBell from '@/components/notifications/NotificationsBell';

/**
 * Shared right-hand header cluster for the new-design pages
 * (Trips, TripView, ManualPlanner): theme toggle · notifications · account.
 *
 * The PRO badge sits next to the avatar (top-right), matching the design -  * not in the trip breadcrumb.
 *
 * Props:
 *   user          - current user (for avatar + label)
 *   isPro         - boolean; renders the PRO badge by the avatar
 *   isDark        - boolean; picks sun/moon icon
 *   onToggleTheme - () => void
 */
export default function HeaderActions({ user, isPro, isDark, onToggleTheme }) {
  const nav = useNavigate();
  return (
    <div className="app-header__right">
      <button className="icon-btn" title="Сменить тему" onClick={onToggleTheme}>
        <Icon name={isDark ? 'sun' : 'moon'} size={17} />
      </button>
      <NotificationsBell triggerClassName="icon-btn" />
      <button
        className="icon-btn"
        title={user?.full_name || user?.email || 'Аккаунт'}
        onClick={() => nav('/settings')}
        style={{ width: 'auto', padding: '0 4px 0 2px', display: 'flex', alignItems: 'center', gap: 6 }}
      >
        <Avatar name={user?.full_name || user?.email || '?'} photo={user?.avatar_url} size="sm" />
        {isPro && (
          <span style={{ background: 'var(--warm-tint)', color: 'var(--warm)', padding: '1px 7px', borderRadius: 999, fontSize: 10.5, fontWeight: 700, letterSpacing: '.04em' }}>PRO</span>
        )}
      </button>
    </div>
  );
}
