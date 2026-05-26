import React, { useState } from 'react';
import { useNavigate, useLocation } from 'react-router-dom';
import {
  List as ListIcon,
  Map as MapIcon,
  Calendar as CalendarIcon,
  Wallet,
  FileText,
  MessageSquare,
  Users,
  Settings as SettingsIcon,
  Share2,
  Crown,
} from 'lucide-react';
import { useT } from '@/lib/i18n/I18nContext';
import { Sheet, SheetContent } from '@/components/ui/sheet';
import { useOptionalTripMenu } from './TripMenuContext';
import { ADDON_KEYS, isAddonEnabled } from '@/lib/tripAddons';
import { useUnreadChatCount } from '@/lib/chat';
import ShareTripDialog from './ShareTripDialog';

/**
 * Left navigation for any trip route.
 *
 * Desktop: fixed column on the left (~240px), always visible.
 * Mobile:  hidden — opens as a Sheet from the burger in AppHeader.
 *
 * The "active" item is computed from the current pathname + ?lens= search
 * param so links can be bookmarked/shared.
 */
export default function TripSideMenu({ trip, tripId, access, isFreeTrip = false, onUpgrade }) {
  const t = useT();
  const nav = useNavigate();
  const location = useLocation();
  const [shareOpen, setShareOpen] = useState(false);
  // Provider is mounted in <Layout/> for trip routes — use the safe hook
  // so the menu also works in storybook-like isolated usage.
  const menuCtx = useOptionalTripMenu();
  const mobileOpen = menuCtx?.mobileOpen || false;
  const setMobileOpen = menuCtx?.setMobileOpen || (() => {});

  const role = access?.role;
  const isOwnerOrAdmin = role === 'owner' || role === 'admin';

  // Lens query param (only meaningful on /trip/:id — the "view" route).
  const params = new URLSearchParams(location.search);
  const lens = params.get('lens') || 'timeline';

  // Addon gates — same logic as in TripView.
  const calendarVisible = trip && isAddonEnabled(trip, ADDON_KEYS.CALENDAR_VIEW);
  const budgetVisible = trip && isAddonEnabled(trip, ADDON_KEYS.BUDGET);
  const chatVisible = trip && isAddonEnabled(trip, ADDON_KEYS.CHAT);
  const unreadChat = useUnreadChatCount(tripId, { enabled: !!chatVisible });

  // Active calculation
  const onViewRoute = location.pathname === `/trip/${tripId}`;
  const onBudgetRoute = location.pathname === `/trip/${tripId}/budget`;
  const onSettingsRoute = location.pathname === `/trip/${tripId}/settings`;

  const goLens = (l) => {
    nav(`/trip/${tripId}?lens=${l}`);
    setMobileOpen(false);
  };
  const goBudget = () => {
    nav(`/trip/${tripId}/budget`);
    setMobileOpen(false);
  };
  const goSettings = () => {
    nav(`/trip/${tripId}/settings`);
    setMobileOpen(false);
  };

  const lensItems = [
    { key: 'timeline', label: t('trip_menu.timeline'), icon: ListIcon, active: onViewRoute && lens === 'timeline', onClick: () => goLens('timeline') },
    { key: 'map', label: t('trip_menu.map'), icon: MapIcon, active: onViewRoute && lens === 'map', onClick: () => goLens('map') },
    ...(calendarVisible ? [{ key: 'calendar', label: t('trip_menu.calendar'), icon: CalendarIcon, active: onViewRoute && lens === 'calendar', onClick: () => goLens('calendar') }] : []),
    ...(budgetVisible ? [{ key: 'budget', label: t('trip_menu.budget'), icon: Wallet, active: onBudgetRoute, onClick: goBudget }] : []),
    { key: 'documents', label: t('trip_menu.documents'), icon: FileText, active: onViewRoute && lens === 'documents', onClick: () => goLens('documents') },
    ...(chatVisible ? [{ key: 'chat', label: t('trip_menu.chat'), icon: MessageSquare, active: onViewRoute && lens === 'chat', onClick: () => goLens('chat'), badge: unreadChat }] : []),
  ];

  const manageItems = [
    ...(isOwnerOrAdmin ? [{
      key: 'members', label: t('trip_menu.members'), icon: Users,
      active: false, onClick: () => { /* not implemented yet */ }, disabled: true,
    }] : []),
    ...(isOwnerOrAdmin ? [{
      key: 'settings', label: t('trip_menu.settings'), icon: SettingsIcon,
      active: onSettingsRoute, onClick: goSettings,
    }] : []),
    {
      key: 'share', label: t('trip_menu.share'), icon: Share2,
      active: false, onClick: () => { setShareOpen(true); setMobileOpen(false); },
    },
  ];

  const menuBody = (
    <nav className="flex flex-col gap-6 p-3">
      <MenuSection title={t('trip_menu.section_lenses')} items={lensItems} />
      <MenuSection title={t('trip_menu.section_manage')} items={manageItems} />
      {isFreeTrip && <FreeTripUpgradeCard t={t} onUpgrade={onUpgrade} />}
    </nav>
  );

  return (
    <>
      <ShareTripDialog open={shareOpen} onOpenChange={setShareOpen} tripId={tripId} />

      {/* Desktop sidebar — FIXED on the left below the AppHeader (h-16=64px),
          pinned to the top so it does NOT scroll with the page content.
          Internal scroll kicks in only if the menu itself overflows. */}
      <aside
        className="hidden lg:block fixed left-0 z-30 border-r border-border bg-card"
        style={{ top: '4rem', bottom: 0, width: '240px', overflowY: 'auto' }}
        aria-label="Trip navigation"
      >
        {menuBody}
      </aside>

      {/* Mobile sheet — opened by the burger in AppHeader. */}
      <Sheet open={mobileOpen} onOpenChange={setMobileOpen}>
        <SheetContent side="left" className="p-0 w-72 bg-card">
          <div className="pt-2">{menuBody}</div>
        </SheetContent>
      </Sheet>
    </>
  );
}

function FreeTripUpgradeCard({ t, onUpgrade }) {
  return (
    <div className="mx-1 rounded-2xl bg-orange-50/80 dark:bg-orange-950/20 p-5 border border-orange-100/70 dark:border-orange-900/40">
      <h3 className="text-lg font-bold text-orange-600 dark:text-orange-300 mb-3">{t('trip_menu.free_trip_title')}</h3>
      <p className="text-sm leading-relaxed text-foreground mb-5">{t('trip_menu.free_trip_desc')}</p>
      <button
        type="button"
        onClick={onUpgrade}
        className="w-full h-10 rounded-lg bg-primary text-primary-foreground font-medium text-sm shadow-md shadow-primary/15 hover:bg-primary/90 transition flex items-center justify-center gap-2"
      >
        <Crown className="w-3.5 h-3.5" />{t('trip_menu.upgrade_trip')}
      </button>
    </div>
  );
}

function MenuSection({ title, items }) {
  if (!items || items.length === 0) return null;
  return (
    <div>
      <div className="px-3 mb-1.5 text-[11px] uppercase tracking-wider font-semibold text-muted-foreground">
        {title}
      </div>
      <div className="flex flex-col gap-0.5">
        {items.map((it) => (
          <MenuItem key={it.key} item={it} />
        ))}
      </div>
    </div>
  );
}

function MenuItem({ item }) {
  const { label, icon: Icon, active, onClick, disabled, badge } = item;
  return (
    <button
      type="button"
      onClick={disabled ? undefined : onClick}
      disabled={disabled}
      aria-current={active ? 'page' : undefined}
      className={`group w-full flex items-center gap-2.5 px-3 py-2 rounded-lg text-sm font-medium transition-colors
        ${active
          ? 'bg-accent text-primary'
          : 'text-foreground hover:bg-secondary'}
        ${disabled ? 'opacity-50 cursor-not-allowed hover:bg-transparent' : ''}
      `}
    >
      <Icon className={`w-4 h-4 shrink-0 ${active ? 'text-primary' : 'text-muted-foreground group-hover:text-foreground'}`} />
      <span className="flex-1 text-left truncate">{label}</span>
      {badge > 0 && (
        <span className="inline-flex items-center justify-center min-w-[20px] h-[20px] px-1.5 rounded-full bg-destructive text-destructive-foreground text-[10px] font-semibold leading-none">
          {badge > 99 ? '99+' : badge}
        </span>
      )}
    </button>
  );
}