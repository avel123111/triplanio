import React from 'react';
import { Outlet, NavLink, useNavigate } from 'react-router-dom';
import { Compass, Settings as SettingsIcon } from 'lucide-react';
import { useT } from '@/lib/i18n/I18nContext';
import { useAuth } from '@/lib/AuthContext';
import { useTheme } from '@/lib/ThemeContext';
import { isProActive } from '@/lib/subscription';
import AppHeader from '@/components/AppHeader';

// Theme toggle has been moved into UserMenu (see components/UserMenu.jsx) so
// it's reachable on mobile without taking header space, and the dropdown is
// consistent across breakpoints.

export default function Layout() {
  const { user } = useAuth();
  const { isDark, toggle: toggleTheme } = useTheme();
  const t = useT();
  const nav = useNavigate();

  // Stripe-return success/fail modal is handled globally by <StripeReturnModals>
  // (mounted once in App), so Layout no longer duplicates it.

  // Layout now serves only the non-trip admin routes; trip/new-design pages
  // are standalone and render their own header. Bottom-nav shown for logged-in
  // users on these pages (mobile).
  const showBottomNav = !!user;

  const body = (
    <>
      <AppHeader user={user} isPro={isProActive(user)} isDark={isDark} onToggleTheme={toggleTheme} />
      <main
        className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-6 sm:py-10"
        style={showBottomNav ? { paddingBottom: 'calc(env(safe-area-inset-bottom) + 80px)' } : undefined}
      >
        <Outlet />
      </main>
    </>
  );

  return (
    <div className="min-h-screen bg-background">
      {body}

      {/* Mobile bottom navigation - hidden on sm+ where the header has the user menu. */}
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

    </div>
  );
}

function BottomNavItem({ to, icon: Icon, label, end }) {
  return (
    <NavLink
      to={to}
      end={end}
      className={({ isActive }) =>
        `nav-link flex-1 flex flex-col items-center justify-center gap-1 text-[length:var(--fs-micro)] font-medium transition-colors ${
          isActive ? 'text-primary' : 'text-muted-foreground hover:text-foreground'
        }`
      }
    >
      <Icon className="w-5 h-5" />
      <span>{label}</span>
    </NavLink>
  );
}