import React, { useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { base44 } from '@/api/base44Client';
import { Bell, FlaskConical, ShieldAlert, Loader2, ChevronRight, Wrench } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { useT, useI18n } from '@/lib/i18n/I18nContext';
import ConfirmDialog from '@/components/common/ConfirmDialog';

/**
 * Admin hub — the entry point for /admin. Lists admin tools as cards so we
 * can grow this section without touching the navigation. Visible to admins
 * only; non-admins see a Forbidden card.
 */
export default function AdminHome() {
  const t = useT();
  const { lang } = useI18n();
  const navigate = useNavigate();
  const [user, setUser] = useState(null);
  const [loading, setLoading] = useState(true);

  // Stripe test checkout state — admin-only smoke test, used to be in Settings.
  const [testCheckoutLoading, setTestCheckoutLoading] = useState(false);
  const [alertDialog, setAlertDialog] = useState({ open: false, title: '', description: '' });
  const showAlert = (title, description) => setAlertDialog({ open: true, title, description });

  useEffect(() => {
    let cancelled = false;
    base44.auth.me()
      .then((u) => { if (!cancelled) { setUser(u); setLoading(false); } })
      .catch(() => { if (!cancelled) { setUser(null); setLoading(false); } });
    return () => { cancelled = true; };
  }, []);

  const handleTestCheckout = async () => {
    let isIframe = false;
    try { isIframe = window.self !== window.top; } catch { isIframe = true; }
    if (isIframe) {
      showAlert(t('common.notice'), t('settings.plan_portal_iframe_error'));
      return;
    }
    try {
      setTestCheckoutLoading(true);
      const res = await base44.functions.invoke('createTestCheckout', {
        returnPath: '/admin',
        locale: lang,
      });
      if (res.data?.url) {
        window.location.href = res.data.url;
      } else {
        setTestCheckoutLoading(false);
        showAlert(t('settings.plan_error_prefix'), res.data?.error || 'No URL');
      }
    } catch (e) {
      setTestCheckoutLoading(false);
      showAlert(t('settings.plan_error_prefix'), e?.response?.data?.error || e.message);
    }
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center py-16">
        <Loader2 className="w-6 h-6 animate-spin text-muted-foreground" />
      </div>
    );
  }

  if (user?.role !== 'admin') {
    return (
      <div className="max-w-md mx-auto mt-16 p-6 rounded-2xl border bg-card text-center">
        <ShieldAlert className="w-10 h-10 mx-auto text-destructive mb-3" />
        <h2 className="font-display text-xl font-bold mb-1">{t('admin.notifications.forbidden_title')}</h2>
        <p className="text-sm text-muted-foreground mb-4">{t('admin.notifications.forbidden_desc')}</p>
        <button onClick={() => navigate('/')} className="text-sm text-primary hover:underline">
          {t('admin.notifications.back_home')}
        </button>
      </div>
    );
  }

  return (
    <div className="max-w-4xl mx-auto px-4 sm:px-6 py-8 space-y-6">
      <div>
        <div className="flex items-center gap-2 mb-1">
          <Wrench className="w-5 h-5 text-primary" />
          <h1 className="font-display text-3xl font-bold">{t('admin.home.title')}</h1>
        </div>
        <p className="text-sm text-muted-foreground">{t('admin.home.subtitle')}</p>
      </div>

      {/* Tools grid */}
      <div className="grid sm:grid-cols-2 gap-3">
        <Link
          to="/admin/notifications"
          className="group rounded-2xl border bg-card p-5 hover:border-primary/40 hover:shadow-soft transition flex items-start gap-3"
        >
          <div className="w-10 h-10 rounded-xl bg-blue-100 dark:bg-blue-950/40 text-blue-700 dark:text-blue-300 flex items-center justify-center shrink-0">
            <Bell className="w-5 h-5" />
          </div>
          <div className="flex-1 min-w-0">
            <div className="font-semibold flex items-center gap-1">
              {t('admin.home.notifications_title')}
              <ChevronRight className="w-4 h-4 text-muted-foreground group-hover:text-primary transition" />
            </div>
            <div className="text-sm text-muted-foreground mt-0.5">{t('admin.home.notifications_desc')}</div>
          </div>
        </Link>

        <div className="rounded-2xl border border-amber-500/40 bg-amber-500/5 p-5 flex items-start gap-3">
          <div className="w-10 h-10 rounded-xl bg-amber-100 dark:bg-amber-950/40 text-amber-700 dark:text-amber-300 flex items-center justify-center shrink-0">
            <FlaskConical className="w-5 h-5" />
          </div>
          <div className="flex-1 min-w-0">
            <div className="font-semibold">{t('settings.admin_tools')}</div>
            <p className="text-xs text-muted-foreground mt-1 mb-3">{t('settings.test_subscription_hint')}</p>
            <Button variant="outline" size="sm" onClick={handleTestCheckout} disabled={testCheckoutLoading}>
              {testCheckoutLoading ? <Loader2 className="w-3 h-3 mr-1.5 animate-spin" /> : <FlaskConical className="w-3 h-3 mr-1.5" />}
              {t('settings.test_subscription_btn')}
            </Button>
          </div>
        </div>
      </div>

      <ConfirmDialog
        open={alertDialog.open}
        onOpenChange={(o) => setAlertDialog((s) => ({ ...s, open: o }))}
        title={alertDialog.title}
        description={alertDialog.description}
        singleButton
      />
    </div>
  );
}