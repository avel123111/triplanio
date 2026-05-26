import React from 'react';
import { Link, useLocation, useNavigate, useParams, matchPath } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { ArrowLeft, Menu as MenuIcon, User as UserIcon, Sun, Moon } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { base44 } from '@/api/base44Client';
import { useAuth } from '@/lib/AuthContext';
import { useT } from '@/lib/i18n/I18nContext';
import NotificationsBell from '@/components/notifications/NotificationsBell';
import UserMenu from '@/components/UserMenu';
import { BRAND_NAME, BRAND_LOGO_URL } from '@/lib/brand';
import { useOptionalTripMenu } from '@/components/trips/TripMenuContext';
import { useTheme } from '@/lib/ThemeContext';

/**
 * Global app header used by <Layout/>. Two modes:
 *  - root routes ("/" and "/settings"): brand logo + name on the left.
 *  - all other routes: iOS-style Back button + optional centered title.
 *
 * Back target is computed from the current pathname (NOT browser history) so
 * deep-links from outside the app still land on a sensible parent screen.
 *
 * Title for trip sub-routes (/trip/:id, /trip/:id/edit, /budget, /settings)
 * is the trip's title — fetched here with react-query and dedupes against the
 * `['trip', tripId]` cache populated by the trip pages, so no extra request
 * is made in practice.
 */
export default function AppHeader() {
  const { user } = useAuth();
  const location = useLocation();
  const t = useT();
  const { theme, setTheme } = useTheme();
  const isDark = theme === 'dark' || (theme === 'system' && typeof window !== 'undefined' && window.matchMedia('(prefers-color-scheme: dark)').matches);

  const { backTo, title } = useBackTargetAndTitle(location.pathname);
  const showBack = backTo !== null;
  // Burger appears on mobile only, and only when we're inside a trip route
  // (TripShell mounts the TripMenuProvider). It opens the left side-menu.
  const tripMenu = useOptionalTripMenu();

  return (
    <header
      className="sticky top-0 z-40 border-b border-border bg-background/80 backdrop-blur-lg"
      style={{ paddingTop: 'env(safe-area-inset-top)' }}>
      
      <div className="w-full px-4 sm:px-6 lg:px-8 h-16 flex items-center gap-3 bg-[hsl(var(--card))]">
        {/* LEFT */}
        <div className="flex items-center gap-2 min-w-0 flex-1">
          {showBack ?
          <div className="inline-flex items-center gap-0.5 rounded-lg border border-border bg-card p-0.5">
              <BackButton to={backTo} label={t('common.back')} />
              {tripMenu &&
              <button
                type="button"
                onClick={tripMenu.open}
                aria-label={t('trip_menu.open')}
                className="lg:hidden inline-flex items-center justify-center h-9 w-9 rounded-md text-foreground hover:bg-secondary transition">
                
                  <MenuIcon className="w-5 h-5" />
                </button>
              }
            </div> :

          <Link to="/" className="flex items-center gap-2 group min-w-0">
              <img
              src={BRAND_LOGO_URL}
              alt={BRAND_NAME}
              className="w-9 h-9 shrink-0 group-hover:scale-105 transition-transform" />
            
              <span className="font-display font-bold text-lg tracking-tight truncate">{BRAND_NAME}</span>
            </Link>
          }
        </div>

        {/* CENTER — current trip title on sub-routes */}
        {showBack && title &&
        <div className="hidden sm:block flex-1 min-w-0 text-center">
            <div className="font-semibold text-sm truncate" title={title}>{title}</div>
          </div>
        }

        {/* RIGHT */}
        <div className="flex items-center gap-1 flex-1 justify-end">
          {user && (
            <button
              type="button"
              onClick={() => setTheme(isDark ? 'light' : 'dark')}
              aria-label={isDark ? 'Light theme' : 'Dark theme'}
              className="inline-flex items-center justify-center h-10 w-10 rounded-full text-muted-foreground hover:text-foreground hover:bg-secondary transition"
            >
              {isDark ? <Sun className="w-5 h-5" /> : <Moon className="w-5 h-5" />}
            </button>
          )}
          {user && <NotificationsBell />}
          {user ?
          <UserMenu user={user} /> :

          <Button size="sm" variant="ghost" onClick={() => base44.auth.redirectToLogin()}>
              <UserIcon className="w-4 h-4 mr-1.5" />{t('trips.sign_in')}
            </Button>
          }
        </div>
      </div>

      {/* Mobile title row (under header) — sub-routes only */}
      {showBack && title &&
      <div className="sm:hidden px-4 pb-2 -mt-1">
          <div className="text-sm font-semibold truncate" title={title}>{title}</div>
        </div>
      }
    </header>);

}

function BackButton({ to, label }) {
  const nav = useNavigate();
  return (
    <button
      type="button"
      onClick={() => nav(to)}
      aria-label={label}
      title={label}
      className="inline-flex items-center justify-center h-9 w-9 rounded-md text-foreground hover:bg-secondary transition">
      
      <ArrowLeft className="w-5 h-5" />
    </button>);

}

/**
 * Resolve the iOS-style "parent" route for a given pathname.
 * Returns { backTo: string | null, title: string | null }.
 *  - null backTo means "no back button" (we're on a root screen).
 *  - title is the page title shown in the centered slot (sub-routes only).
 */
function useBackTargetAndTitle(pathname) {
  // Match the various trip sub-routes once.
  const tripMatch =
  matchPath('/trip/:tripId', pathname) ||
  matchPath('/trip/:tripId/edit', pathname) ||
  matchPath('/trip/:tripId/budget', pathname) ||
  matchPath('/trip/:tripId/settings', pathname);
  const tripId = tripMatch?.params?.tripId || null;

  // Fetch the trip's title for sub-routes. react-query dedupes by key, so the
  // trip pages' own `['trip', tripId]` query satisfies this without extra HTTP.
  const { data: trip } = useQuery({
    queryKey: ['trip', tripId],
    queryFn: () => base44.entities.Trip.get(tripId),
    enabled: !!tripId,
    staleTime: 60 * 1000
  });

  // Root screens — no back button.
  if (pathname === '/' || pathname === '/settings') {
    return { backTo: null, title: null };
  }

  // /trip/:id/(edit|budget|settings)  → back to /trip/:id, title = trip title
  if (tripId && pathname !== `/trip/${tripId}`) {
    return { backTo: `/trip/${tripId}`, title: trip?.title || null };
  }
  // /trip/:id  → back to "/", title = trip title
  if (tripId && pathname === `/trip/${tripId}`) {
    return { backTo: '/', title: trip?.title || null };
  }

  // Fallback for any other authenticated route — back to "/".
  return { backTo: '/', title: null };
}