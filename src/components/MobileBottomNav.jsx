/**
 * MobileBottomNav — custom mobile-only bottom navigation (≤640px).
 *
 * A floating frosted-glass "capsule dock" with a raised, glowing primary "+"
 * in the centre. Two context-aware variants, chosen by route:
 *   • trip   (/trip/:id)            — Обзор · Карта · (+) · Профиль · Ещё
 *   • app    (/trips /settings …)   — Поездки · (+) · Профиль
 *
 * Hidden on focused full-screen flows that own their navigation: the structure
 * planner (/trip/:id/edit), the create wizard (/new-trip, /plan-trip-ai), and
 * the public/landing/login routes.
 *
 * Trip-only actions (open the "…" menu sheet, open the add sheet) live in
 * <TripView>; it publishes them through MobileNavContext so this global nav can
 * trigger them. Lens navigation reuses the existing window.__navigate bridge.
 */
import React, { createContext, useContext, useMemo, useState } from 'react';
import { useNavigate, useLocation, useSearchParams } from 'react-router-dom';
import { Icon } from '@/design/icons';
import { Avatar } from '@/design/index';
import { useAuth } from '@/lib/AuthContext';
import { displayName } from '@/lib/displayName';
import { useT } from '@/lib/i18n/I18nContext';
import { useCreateTrip } from '@/components/create/CreateTripProvider';

// ─── Context bridge ──────────────────────────────────────────────────────────
// TripView registers { openMenu, openAdd } while mounted; the global nav reads
// them for the trip variant. null when no trip screen is active.
const MobileNavContext = createContext({ tripCtx: null, setTripCtx: () => {} });

export function MobileNavProvider({ children }) {
  const [tripCtx, setTripCtx] = useState(null);
  const value = useMemo(() => ({ tripCtx, setTripCtx }), [tripCtx]);
  return <MobileNavContext.Provider value={value}>{children}</MobileNavContext.Provider>;
}

export const useMobileNav = () => useContext(MobileNavContext);

// ─── Items ───────────────────────────────────────────────────────────────────
function NavItem({ icon, label, active, onClick, avatar }) {
  return (
    <button
      type="button"
      className={'mbnav__item' + (active ? ' is-active' : '')}
      onClick={onClick}
      aria-label={label}
      aria-current={active ? 'page' : undefined}
    >
      <span className="mbnav__ico">{avatar || <Icon name={icon} size={21} />}</span>
      <span className="mbnav__lbl">{label}</span>
    </button>
  );
}

// ─── Bottom nav ──────────────────────────────────────────────────────────────
export default function MobileBottomNav() {
  const t = useT();
  const nav = useNavigate();
  const loc = useLocation();
  const [sp] = useSearchParams();
  const { user } = useAuth();
  const { tripCtx } = useMobileNav();
  const { openChoice } = useCreateTrip();
  const path = loc.pathname;

  // Routes that own their navigation / aren't app screens → no bottom nav.
  const hidden =
    path === '/' ||
    path.startsWith('/login') ||
    path.startsWith('/reset-password') ||
    path.startsWith('/new-trip') ||
    path.startsWith('/plan-trip-ai') ||
    path.startsWith('/public') ||
    path.startsWith('/join') ||
    /^\/trip\/[^/]+\/edit\/?$/.test(path);
  if (hidden) return null;

  const onTrip = /^\/trip\/[^/]+\/?$/.test(path);
  const avatarEl = (
    <Avatar className="mbnav__avatar" name={displayName(user?.email, user?.full_name)} photo={user?.avatar_url} size="sm" />
  );

  if (onTrip) {
    const lens = sp.get('lens') || 'overview';
    const go = (target) => window.__navigate?.(target);
    return (
      <nav className="mbnav" aria-label={t('nav.trips')}>
        <div className="mbnav__dock">
          <NavItem icon="grid" label={t('trip_menu.overview')} active={lens === 'overview'} onClick={() => go('overview')} />
          <NavItem icon="list" label={t('trip_menu.timeline')} active={lens === 'timeline'} onClick={() => go('timeline')} />
          <span className="mbnav__center">
            <button type="button" className="mbnav__fab" aria-label={t('common.add')} onClick={() => tripCtx?.openAdd?.()}>
              <Icon name="plus" size={26} />
            </button>
          </span>
          <NavItem label={t('nav.account')} active={false} avatar={avatarEl} onClick={() => nav('/settings')} />
          <NavItem icon="more" label={t('common.more')} active={false} onClick={() => tripCtx?.openMenu?.()} />
        </div>
      </nav>
    );
  }

  // App (non-trip) variant.
  return (
    <nav className="mbnav" aria-label={t('nav.trips')}>
      <div className="mbnav__dock mbnav__dock--app">
        <NavItem icon="grid" label={t('nav.trips')} active={path.startsWith('/trips')} onClick={() => nav('/trips')} />
        <span className="mbnav__center">
          <button type="button" className="mbnav__fab" aria-label={t('trips.new')} onClick={() => openChoice()}>
            <Icon name="plus" size={26} />
          </button>
        </span>
        <NavItem label={t('nav.account')} active={path.startsWith('/settings')} avatar={avatarEl} onClick={() => nav('/settings')} />
      </div>
    </nav>
  );
}
