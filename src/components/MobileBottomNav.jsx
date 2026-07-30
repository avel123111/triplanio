/**
 * MobileBottomNav — custom mobile-only bottom navigation (≤640px).
 *
 * A floating frosted-glass "capsule dock" with a raised, glowing primary "+"
 * in the centre. Two context-aware variants, chosen by route:
 *   • trip   (/trip/:id)            — Обзор · Хронология · (+) · Календарь · Ещё
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
import React, { createContext, useContext, useEffect, useMemo, useState } from 'react';
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

  // Chat lens (TRIP-296): the room hands its whole bottom edge to the composer,
  // so the floating nav would sit on top of the send button.
  const onChatLens = /^\/trip\/[^/]+\/?$/.test(path) && sp.get('lens') === 'chat';

  // Routes that own their navigation / aren't app screens → no bottom nav.
  const hidden =
    path === '/' ||
    path.startsWith('/login') ||
    path.startsWith('/reset-password') ||
    path.startsWith('/new-trip') ||
    path.startsWith('/plan-trip-ai') ||
    path.startsWith('/public') ||
    path.startsWith('/join') ||
    /^\/trip\/[^/]+\/edit\/?$/.test(path) ||
    onChatLens;

  // Flag the root while something owns the bottom edge — this dock, or the chat
  // composer on the one lens that hides it. The consent banner is a sibling of
  // the router and can see neither, so it reads this class to know whether to
  // lift (TRIP-311). A class, not `:has()`: the build target includes Firefox
  // 104, which predates it — see the note above `.checkbox input:disabled`.
  const bottomOwned = !hidden || onChatLens;
  useEffect(() => {
    document.documentElement.classList.toggle('has-bottom-dock', bottomOwned);
    return () => document.documentElement.classList.remove('has-bottom-dock');
  }, [bottomOwned]);

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
          <NavItem icon="calendar" label={t('trip_menu.calendar')} active={lens === 'calendar'} onClick={() => go('calendar')} />
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
