import React, { useEffect, useState } from 'react';
import { Outlet, NavLink, useSearchParams, useLocation } from 'react-router-dom';
import { useQueryClient } from '@tanstack/react-query';
import { Compass, Settings as SettingsIcon } from 'lucide-react';
import { useT } from '@/lib/i18n/I18nContext';
import { useAuth } from '@/lib/AuthContext';
import AppHeader from '@/components/AppHeader';
import WelcomeToProDialog from '@/components/subscriptions/WelcomeToProDialog';
import { TripMenuProvider } from '@/components/trips/TripMenuContext';

// Theme toggle has been moved into UserMenu (see components/UserMenu.jsx) so
// it's reachable on mobile without taking header space, and the dropdown is
// consistent across breakpoints.

export default function Layout() {
  const { user } = useAuth();
  const t = useT();
  const [searchParams, setSearchParams] = useSearchParams();
  const qc = useQueryClient();
  const [welcomeOpen, setWelcomeOpen] = useState(false);
  const location = useLocation();

  // Centralised handling of Stripe return — works regardless of which page
  // the user started the upgrade from (Trips / TripView / Settings). We show
  // the "Welcome to Pro" dialog on success and silently strip the query
  // params on cancel.
  useEffect(() => {
    const status = searchParams.get('stripe_status');
    if (!status) return;
    if (status === 'success') {
      setWelcomeOpen(true);
      qc.invalidateQueries({ queryKey: ['my-pro-status'] });
      qc.invalidateQueries({ queryKey: ['me'] });
    }
    searchParams.delete('stripe_status');
    searchParams.delete('session_id');
    setSearchParams(searchParams, { replace: true });
  }, [searchParams, setSearchParams, qc]);

  // Hide bottom-nav while inside a trip — those screens have their own
  // left-side nav (TripSideMenu).
  const isTripRoute = location.pathname.startsWith('/trip/');
  const showBottomNav = !!user && !isTripRoute;

  // Trip routes need the TripMenuProvider to wrap BOTH the header (the
  // burger button calls `open()` on the context) AND the page content
  // (TripShell mounts the menu Sheet). Putting the provider inside
  // TripShell only would hide the context from the header above.
  const body = (
    <>
      <AppHeader />
      {isTripRoute ? (
        <Outlet />
      ) : (
        <main
          className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-6 sm:py-10"
          style={showBottomNav ? { paddingBottom: 'calc(env(safe-area-inset-bottom) + 80px)' } : undefined}
        >
          <Outlet />
        </main>
      )}
    </>
  );

  return (
    <div className="min-h-screen bg-background">
      {isTripRoute ? <TripMenuProvider>{body}</TripMenuProvider> : body}

      {/* Mobile bottom navigation — hidden on sm+ where the header has the user menu. */}
      {showBottomNav && (
        <nav
          className="sm:hidden fixed bottom-0 inset-x-0 z-40 border-t border-border bg-background/95 backdrop-blur-lg"
          style={{ paddingBottom: 'env(safe-area-inset-bottom)' }}
        >
          <div className="flex items-stretch justify-around h-16">
            <BottomNavItem to="/" icon={Compass} label={t('nav.trips')} end />
            <BottomNavItem to="/settings" icon={SettingsIcon} label={t('nav.settings')} />
          </div>
        </nav>
      )}

      <WelcomeToProDialog open={welcomeOpen} onOpenChange={setWelcomeOpen} />
    </div>
  );
}

function BottomNavItem({ to, icon: Icon, label, end }) {
  return (
    <NavLink
      to={to}
      end={end}
      className={({ isActive }) =>
        `nav-link flex-1 flex flex-col items-center justify-center gap-1 text-[11px] font-medium transition-colors ${
          isActive ? 'text-primary' : 'text-muted-foreground hover:text-foreground'
        }`
      }
    >
      <Icon className="w-5 h-5" />
      <span>{label}</span>
    </NavLink>
  );
}