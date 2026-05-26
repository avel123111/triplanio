import { Toaster } from "@/components/ui/toaster"
import { QueryClientProvider } from '@tanstack/react-query'
import { queryClientInstance } from '@/lib/query-client'
import { BrowserRouter as Router, Route, Routes } from 'react-router-dom';
import PageNotFound from './lib/PageNotFound';
import { AuthProvider, useAuth } from '@/lib/AuthContext';
import UserNotRegisteredError from '@/components/UserNotRegisteredError';
import { ThemeProvider } from '@/lib/ThemeContext';
import { I18nProvider } from '@/lib/i18n/I18nContext';
import Layout from '@/components/Layout';
import Trips from '@/pages/Trips';
import TripView from '@/pages/TripView';
import TripBudget from '@/pages/TripBudget';
import TripSettings from '@/pages/TripSettings';
import Settings from '@/pages/Settings';
import PublicTrip from '@/pages/PublicTrip';
import AdminHome from '@/pages/admin/AdminHome';
import AdminNotifications from '@/pages/admin/Notifications';
import AiTripPlanner from '@/pages/AiTripPlanner';
import Login from '@/pages/Login';

const AuthenticatedApp = () => {
  const { isLoadingAuth, isLoadingPublicSettings, authError, isAuthenticated, navigateToLogin } = useAuth();

  // Public read-only trip page must work WITHOUT auth — short-circuit before
  // the auth gate redirects unauthenticated visitors to login.
  const path = window.location.pathname;
  if (path.startsWith('/public/trip/')) {
    return (
      <Routes>
        <Route path="/public/trip/:tripId" element={<PublicTrip />} />
        <Route path="*" element={<PageNotFound />} />
      </Routes>
    );
  }

  // Login page is always accessible without auth
  if (path === '/login') {
    return (
      <Routes>
        <Route path="/login" element={<Login />} />
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

  // Not authenticated — send to login
  if (!isAuthenticated) {
    navigateToLogin();
    return null;
  }

  if (authError) {
    if (authError.type === 'user_not_registered') {
      return <UserNotRegisteredError />;
    } else if (authError.type === 'auth_required') {
      navigateToLogin();
      return null;
    }
  }

  return (
    <Routes>
      <Route element={<Layout />}>
        <Route path="/" element={<Trips />} />
        <Route path="/settings" element={<Settings />} />
        <Route path="/plan-trip-ai" element={<AiTripPlanner />} />
        <Route path="/trip/:tripId" element={<TripView />} />
        <Route path="/trip/:tripId/budget" element={<TripBudget />} />
        <Route path="/trip/:tripId/settings" element={<TripSettings />} />
        <Route path="/admin" element={<AdminHome />} />
        <Route path="/admin/notifications" element={<AdminNotifications />} />
      </Route>
      <Route path="*" element={<PageNotFound />} />
    </Routes>
  );
};

function App() {
  return (
    <AuthProvider>
      <ThemeProvider>
        <I18nProvider>
          <QueryClientProvider client={queryClientInstance}>
            <Router>
              <AuthenticatedApp />
            </Router>
            <Toaster />
          </QueryClientProvider>
        </I18nProvider>
      </ThemeProvider>
    </AuthProvider>
  )
}

export default App