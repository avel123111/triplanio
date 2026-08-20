// @ts-check
import React from 'react';
import { useNavigate } from 'react-router-dom';
import { Avatar, IconBtn } from '@/design/index';
import { ActionMenu } from '@/components/ui/ActionMenu';
import NotificationsBell from '@/components/notifications/NotificationsBell';
import { useT } from '@/lib/i18n/I18nContext';
import { useAuth } from '@/lib/AuthContext';
import { displayName } from '@/lib/displayName';

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
// Состав меню аккаунта — ЕДИНСТВЕННЫЙ источник для обеих точек показа: аватар
// в шапке (ниже) и аватар в нижнем кластере рейла (RailUtilities в AppShell).
// «Профиль» ведёт на аккаунт-экран, «Выйти» — logout из AuthContext (прямое
// действие, без confirm — как кнопка выхода в ScreenAccount).
export function useAccountMenuItems() {
  const t = useT();
  const nav = useNavigate();
  const { logout } = useAuth();
  return [
    { icon: 'user', label: t('nav.profile'), onSelect: () => nav('/settings') },
    { icon: 'logout', label: t('auth.logout'), onSelect: () => logout() },
  ];
}

export default function HeaderActions({ user, isPro, isDark, onToggleTheme }) {
  const t = useT();
  const accountItems = useAccountMenuItems();
  return (
    <div className="row row--g4">
      {/* ★TRIP-344: сторону этим двум кнопкам задаёт не ступень, а контекстное
          правило `.app-header .icon-btn` (38px, круг) — намеренное локальное
          исключение шапки, апрув Pavel: диаметр совпадает с аватаром рядом, и
          ступень 40 разъехалась бы с ним. Выражено оно РУЧКОЙ `--tile`, то есть
          это ДЕФОЛТ шапки, а не перебивка: явный `size` его перекроет (ступень
          весит столько же и стоит ниже по файлу). Поэтому `size` тут и не
          пишется — 38px держится ровно до тех пор, пока его никто не назвал. */}
      <IconBtn
        icon={isDark ? 'sun' : 'moon'}
        title={t('nav.toggle_theme')}
        ariaLabel={t('nav.toggle_theme')}
        onClick={onToggleTheme}
      />
      <NotificationsBell />
      {/* Клик по профилю → канон-меню (ActionMenu); состав пунктов — общий
          useAccountMenuItems (тот же в рейле). */}
      <ActionMenu
        align="end"
        title={t('nav.account')}
        trigger={(
          <button
            className="app-header__account"
            title={user?.email ? displayName(user.email, user.full_name) : t('nav.account')}
            aria-label={user?.email ? displayName(user.email, user.full_name) : t('nav.account')}
            type="button"
          >
            <Avatar className="app-header__avatar" name={displayName(user?.email, user?.full_name)} photo={user?.avatar_url} seed={user?.id} size="sm" />
            {isPro && <span className="app-header__pro">PRO</span>}
          </button>
        )}
        items={accountItems}
      />
    </div>
  );
}
