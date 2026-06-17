import { Toaster } from "@/components/ui/toaster"
import { QueryClientProvider } from '@tanstack/react-query'
import { queryClientInstance } from '@/lib/query-client'
import { BrowserRouter as Router, Route, Routes, useLocation } from 'react-router-dom';
import AppErrorBoundary from '@/components/AppErrorBoundary';
import PageNotFound from './lib/PageNotFound';
import { AuthProvider, useAuth } from '@/lib/AuthContext';
import { ThemeProvider } from '@/lib/ThemeContext';
import { I18nProvider } from '@/lib/i18n/I18nContext';
import Layout from '@/components/Layout';
import Trips from '@/pages/Trips';
import TripView from '@/pages/TripView';
import TripStructureEdit from '@/pages/TripStructureEdit';
import ScreenAccount from '@/pages/ScreenAccount';
import PublicTrip from '@/pages/PublicTrip';
import JoinTrip from '@/pages/JoinTrip';
import Login from '@/pages/Login';
import LandingPage from '@/pages/Landing/LandingPage';
import ManualPlanner from '@/pages/ManualPlanner';
import Inbox from '@/pages/Inbox';
import Pro from '@/pages/Pro';
import StripeReturnModals from '@/components/common/StripeReturnModals';
import { ConfirmProvider } from '@/components/common/ConfirmProvider';
import { MapProvider } from '@/lib/map/MapProvider';
import MobileBottomNav, { MobileNavProvider } from '@/components/MobileBottomNav';

const AuthenticatedApp = () => {
  const { isLoadingAuth, isLoadingPublicSettings, isAuthenticated } = useAuth();
  const location = useLocation();

  // Public read-only trip page - no auth needed
  const path = location.pathname;
  if (path.startsWith('/public/trip/')) {
    return (
      <Routes>
        <Route path="/public/trip/:tripId" element={<PublicTrip />} />
        <Route path="*" element={<PageNotFound />} />
      </Routes>
    );
  }

  // Invite links — handled before the auth gate. JoinTrip itself decides whether
  // to redeem the token (logged in) or bounce to /login (logged out).
  if (path.startsWith('/join/')) {
    return (
      <Routes>
        <Route path="/join/:token" element={<JoinTrip />} />
        <Route path="*" element={<PageNotFound />} />
      </Routes>
    );
  }

  // Login + password-recovery pages - always accessible (no auth gating).
  // /reset-password is reached from the recovery email; its token creates a
  // session, so it must bypass the authenticated routing below and render the
  // same Login shell (which opens on the new-password form).
  if (path === '/login' || path === '/reset-password') {
    return (
      <Routes>
        <Route path="/login" element={<Login />} />
        <Route path="/reset-password" element={<Login />} />
      </Routes>
    );
  }

  // Landing page at "/" for unauthenticated visitors - only show AFTER auth is resolved
  // (not during loading) so returning OAuth users don't see a flash of the landing.
  if (!isAuthenticated && !isLoadingAuth && path === '/') {
    return (
      <Routes>
        <Route path="/" element={<LandingPage />} />
      </Routes>
    );
  }

  if (isLoadingPublicSettings || isLoadingAuth) {
    return (
      <div className="fixed inset-0 flex items-center justify-center">
        <div className="w-8 h-8 border-4 border-slate-200 border-t-slate-800 rounded-full animate-spin"></div>
      </div>
    );
  }

  // Not authenticated and on a non-root path - send to landing
  if (!isAuthenticated) {
    return (
      <Routes>
        <Route path="/" element={<LandingPage />} />
        <Route path="*" element={<LandingPage />} />
      </Routes>
    );
  }

  return (
    <MobileNavProvider>
      {/* One global Stripe-return handler for the whole logged-in app - shows the
          success/fail modal regardless of which screen Stripe came back to. */}
      <StripeReturnModals />
      <Routes>
      {/* New design - standalone (own app-header, no Layout) */}
      {/* Logged-in users can still view the landing at "/" (no auto-redirect);
          the landing's CTA takes them into the app. */}
      <Route path="/" element={<LandingPage />} />
      <Route path="/trips" element={<Trips />} />
      <Route path="/new-trip" element={<ManualPlanner />} />
      <Route path="/trip/:tripId" element={<TripView />} />
      <Route path="/trip/:tripId/edit" element={<TripStructureEdit />} />
      <Route path="/settings" element={<ScreenAccount />} />
      <Route path="/inbox" element={<Inbox />} />
      <Route path="/pro" element={<Pro />} />

      <Route path="/plan-trip-ai" element={<ManualPlanner initialMethod="ai" />} />

      <Route path="*" element={<PageNotFound />} />
      </Routes>
      {/* Custom mobile bottom nav (≤640px); hides itself on planner / create /
          landing / login routes. */}
      <MobileBottomNav />
    </MobileNavProvider>
  );
};

function App() {
  return (
    <AppErrorBoundary>
      <AuthProvider>
        <ThemeProvider>
          <I18nProvider>
            <QueryClientProvider client={queryClientInstance}>
              <ConfirmProvider>
                {/* One Mapbox instance for the whole app, above the router so it
                    survives route changes (overview ↔ map ↔ editor ↔ planner ↔
                    create ↔ different trip). Lazy: non-map routes pay nothing. */}
                <MapProvider>
                  <Router>
                    <AuthenticatedApp />
                  </Router>
                  <Toaster />
                </MapProvider>
              </ConfirmProvider>
            </QueryClientProvider>
          </I18nProvider>
        </ThemeProvider>
      </AuthProvider>
    </AppErrorBoundary>
  )
}

export default App