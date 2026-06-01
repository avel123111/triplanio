import React, { useEffect, useState } from 'react';
import { Outlet, NavLink, useSearchParams, useNavigate } from 'react-router-dom';
import { useQueryClient } from '@tanstack/react-query';
import { Compass, Settings as SettingsIcon } from 'lucide-react';
import { useT } from '@/lib/i18n/I18nContext';
import { useAuth } from '@/lib/AuthContext';
import { useTheme } from '@/lib/ThemeContext';
import { isProActive } from '@/lib/subscription';
import { supabase } from '@/api/supabaseClient';
import HeaderActions from '@/components/HeaderActions';
import PaymentSuccessDialog from '@/components/common/PaymentSuccessDialog';
import PaymentFailDialog from '@/components/common/PaymentFailDialog';

// Theme toggle has been moved into UserMenu (see components/UserMenu.jsx) so
// it's reachable on mobile without taking header space, and the dropdown is
// consistent across breakpoints.

export default function Layout() {
  const { user } = useAuth();
  const { isDark, toggle: toggleTheme } = useTheme();
  const t = useT();
  const [searchParams, setSearchParams] = useSearchParams();
  const qc = useQueryClient();
  const nav = useNavigate();
  const [payModal, setPayModal] = useState(null); // 'success' | 'fail' | null
  const [planLabel, setPlanLabel] = useState(null);
  const [priceLabel, setPriceLabel] = useState(null);

  // Centralised handling of Stripe return — works regardless of which page the
  // upgrade started from. ONE success modal + ONE fail modal, app-wide.
  useEffect(() => {
    const status = searchParams.get('stripe_status');
    if (!status) return;
    if (status === 'success') {
      setPayModal('success');
      qc.invalidateQueries({ queryKey: ['my-pro-status'] });
      qc.invalidateQueries({ queryKey: ['me'] });
      // Best-effort plan + price for the success chip (optional).
      (async () => {
        try {
          const planRes = await supabase.functions.invoke('getUserPlan');
          const type = planRes.data?.subscriptionType;
          const label = type === 'pro_monthly' ? 'Pro Monthly' : type === 'pro_yearly' ? 'Pro Yearly' : null;
          setPlanLabel(label);
          if (type) {
            const priceRes = await supabase.functions.invoke('getStripePrices', { body: {} });
            const p = priceRes.data?.prices?.[type];
            if (p?.unit_amount != null) {
              const amt = new Intl.NumberFormat('ru-RU', {
                style: 'currency', currency: (p.currency || 'eur').toUpperCase(),
                minimumFractionDigits: 0, maximumFractionDigits: 2,
              }).format(p.unit_amount / 100);
              const per = p.recurring_interval === 'month' ? '/мес' : p.recurring_interval === 'year' ? '/год' : '';
              setPriceLabel(amt + per);
            }
          }
        } catch { /* chip is optional */ }
      })();
    } else if (status === 'cancel') {
      setPayModal('fail');
    }
    searchParams.delete('stripe_status');
    searchParams.delete('session_id');
    setSearchParams(searchParams, { replace: true });
  }, [searchParams, setSearchParams, qc]);

  // Layout now serves only the non-trip admin routes; trip/new-design pages
  // are standalone and render their own header. Bottom-nav shown for logged-in
  // users on these pages (mobile).
  const showBottomNav = !!user;

  const body = (
    <>
      <header className="app-header">
        <div className="app-header__brand" onClick={() => nav('/trips')} style={{ cursor: 'pointer' }}>
          <img src="/triplanio-logo.svg" alt="Triplanio" style={{ width: 28, height: 28, borderRadius: 7, flexShrink: 0 }} />
          <span className="app-header__brand-name">Triplanio</span>
        </div>
        <HeaderActions user={user} isPro={isProActive(user)} isDark={isDark} onToggleTheme={toggleTheme} />
      </header>
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

      <PaymentSuccessDialog
        open={payModal === 'success'}
        onOpenChange={(o) => { if (!o) setPayModal(null); }}
        planLabel={planLabel}
        priceLabel={priceLabel}
      />
      <PaymentFailDialog
        open={payModal === 'fail'}
        onOpenChange={(o) => { if (!o) setPayModal(null); }}
        onRetry={() => { setPayModal(null); nav('/pro'); }}
      />
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