import React, { useState, useEffect, useRef } from 'react';
import { useAuth } from '@/lib/AuthContext';
import { useSearchParams } from 'react-router-dom';
import { useI18n, useI18nFormat } from '@/lib/i18n/I18nContext';
import { useTheme } from '@/lib/ThemeContext';
import { base44 } from '@/api/base44Client';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Loader2, Upload, User as UserIcon, Languages, Palette, BellRing, ShieldAlert, Check, Crown, ExternalLink, Sparkles, Infinity as InfinityIcon, FileText } from 'lucide-react';
import { useQueryClient } from '@tanstack/react-query';
import UserAvatar from '@/components/UserAvatar';
import ProBadge from '@/components/subscriptions/ProBadge';
import UpgradePlanDialog from '@/components/subscriptions/UpgradePlanDialog';
import ConfirmDialog from '@/components/common/ConfirmDialog';

export default function Settings() {
  const { user, checkUserAuth } = useAuth();
  const { t, lang, setLang, languages } = useI18n();
  // Locale tag (e.g. "en-US", "ru-RU") — needed so the "Next charge" date is
  // formatted in the active interface language instead of the browser default.
  const { locale } = useI18nFormat();
  const { theme, setTheme } = useTheme();
  const qc = useQueryClient();
  const [searchParams, setSearchParams] = useSearchParams();
  const avatarInputRef = useRef(null);

  const [fullName, setFullName] = useState('');
  const [avatarUrl, setAvatarUrl] = useState('');
  const [notifyInvites, setNotifyInvites] = useState(true);
  const [notifyUpdates, setNotifyUpdates] = useState(true);
  const [saving, setSaving] = useState(false);
  const [uploadingAvatar, setUploadingAvatar] = useState(false);
  const [savedFlash, setSavedFlash] = useState(false);
  const [plan, setPlan] = useState(null);
  const [planLoading, setPlanLoading] = useState(true);
  // True while we're polling getUserPlan after a Stripe success redirect,
  // waiting for the webhook to upgrade the user. Blocks the Upgrade button
  // so a double-click can't create a second subscription.
  const [awaitingWebhook, setAwaitingWebhook] = useState(false);
  const [alertDialog, setAlertDialog] = useState({ open: false, title: '', description: '' });
  const [confirmDeleteAcc, setConfirmDeleteAcc] = useState(false);
  const [deletingAccount, setDeletingAccount] = useState(false);
  const showAlert = (title, description) => setAlertDialog({ open: true, title, description });

  useEffect(() => {
    if (!user) return;
    setFullName(user.full_name || '');
    setAvatarUrl(user.avatar_url || '');
    setNotifyInvites(user.notify_email_invites !== false);
    setNotifyUpdates(user.notify_email_updates !== false);
    loadPlan();
  }, [user]);

  // Stripe return is handled centrally in <Layout/> (Welcome-to-Pro dialog +
  // query param cleanup). On success we poll getUserPlan until the webhook
  // flips the user to Pro (max ~20s) and block the Upgrade button in the
  // meantime to prevent double-charges on race conditions.
  useEffect(() => {
    if (searchParams.get('stripe_status') !== 'success') return;
    let cancelled = false;
    setAwaitingWebhook(true);
    const start = Date.now();
    const tick = async () => {
      if (cancelled) return;
      try {
        const res = await base44.functions.invoke('getUserPlan', {});
        if (cancelled) return;
        setPlan(res.data);
        setPlanLoading(false);
        if (res.data?.plan === 'pro') {
          setAwaitingWebhook(false);
          return;
        }
      } catch (e) { console.error(e); }
      if (Date.now() - start >= 20000) {
        setAwaitingWebhook(false);
        return;
      }
      setTimeout(tick, 1500);
    };
    tick();
    return () => { cancelled = true; };
  }, [searchParams]);

  const loadPlan = async () => {
    try {
      const res = await base44.functions.invoke('getUserPlan', {});
      setPlan(res.data);
    } catch (e) { console.error(e); }
    finally { setPlanLoading(false); }
  };

  const [portalLoading, setPortalLoading] = useState(false);
  const handleManageSubscription = async () => {
    let isIframe = false;
    try { isIframe = window.self !== window.top; } catch { isIframe = true; }
    if (isIframe) {
      showAlert(t('common.notice'), t('settings.plan_portal_iframe_error'));
      return;
    }
    try {
      setPortalLoading(true);
      const res = await base44.functions.invoke('createBillingPortal', {
        returnPath: '/settings',
      });
      if (res.data?.url) {
        window.location.href = res.data.url;
      } else {
        showAlert(t('common.notice'), t('settings.plan_portal_error'));
        setPortalLoading(false);
      }
    } catch (e) {
      console.error(e);
      showAlert(t('settings.plan_error_prefix'), e?.response?.data?.error || e.message);
      setPortalLoading(false);
    }
  };

  const [upgradeOpen, setUpgradeOpen] = useState(false);

  const handleUpgrade = () => {
    setUpgradeOpen(true);
  };

  const flashSaved = () => {
    setSavedFlash(true);
    setTimeout(() => setSavedFlash(false), 1500);
  };

  const handleSave = async () => {
    setSaving(true);
    try {
      await base44.auth.updateMe({
        full_name: fullName,
        avatar_url: avatarUrl,
        notify_email_invites: notifyInvites,
        notify_email_updates: notifyUpdates,
      });
      qc.invalidateQueries({ queryKey: ['me'] });
      // The AuthContext caches `user` from the initial me() call — without
      // re-reading it, the header / sidebar / other pages keep showing the
      // old name & avatar until a full page reload.
      try { await checkUserAuth?.(); } catch { /* ignore */ }
      flashSaved();
    } finally {
      setSaving(false);
    }
  };

  const handleAvatarUpload = async (file) => {
    if (!file) return;
    setUploadingAvatar(true);
    try {
      const { file_url } = await base44.integrations.Core.UploadFile({ file });
      setAvatarUrl(file_url);
    } finally {
      setUploadingAvatar(false);
    }
  };

  const handleDeleteAccount = () => {
    setConfirmDeleteAcc(true);
  };

  // Real account deletion. The backend function performs cascade delete of
  // all trip data owned by the user, removes their memberships from other
  // trips, then deletes the User record. If the user has an active recurring
  // Stripe subscription, the function returns 409 and we ask them to cancel
  // it first via the billing portal.
  const performDeleteAccount = async () => {
    setDeletingAccount(true);
    try {
      await base44.functions.invoke('deleteMyAccount', {});
      // Account is gone — log out and redirect to login.
      try { await base44.auth.logout('/'); } catch { window.location.href = '/'; }
    } catch (e) {
      console.error(e);
      const code = e?.response?.data?.error;
      if (code === 'active_subscription') {
        showAlert(
          t('settings.delete_account_blocked_title'),
          t('settings.delete_account_blocked_msg')
        );
      } else {
        showAlert(t('settings.plan_error_prefix'), e?.message || String(e));
      }
    } finally {
      setDeletingAccount(false);
    }
  };

  if (!user) {
    return <div className="flex justify-center py-20"><Loader2 className="w-6 h-6 animate-spin" /></div>;
  }

  return (
    <div className="max-w-2xl mx-auto space-y-3">
      <div className="flex items-center justify-between">
        <h1 className="font-display text-3xl font-bold">{t('settings.title')}</h1>
        {savedFlash && (
          <span className="inline-flex items-center gap-1 text-sm text-green-600">
            <Check className="w-4 h-4" />{t('settings.saved')}
          </span>
        )}
      </div>

      {/* Profile */}
      <section className="rounded-2xl border bg-card p-4 space-y-3">
        <div className="flex items-center gap-2 text-sm font-semibold">
          <UserIcon className="w-4 h-4 text-primary" />{t('settings.profile')}
        </div>
        <div className="flex items-center gap-4">
          <UserAvatar
            name={fullName}
            email={user.email}
            avatarUrl={avatarUrl}
            size="xl"
            ring={false}
          />
          <div>
            <input
              ref={avatarInputRef}
              type="file"
              accept="image/*"
              className="hidden"
              onChange={e => handleAvatarUpload(e.target.files?.[0])}
            />
            <Button variant="outline" size="sm" onClick={() => avatarInputRef.current?.click()} disabled={uploadingAvatar}>
              {uploadingAvatar ? <Loader2 className="w-3 h-3 mr-1.5 animate-spin" /> : <Upload className="w-3 h-3 mr-1.5" />}
              {t('settings.profile_avatar')}
            </Button>
            {avatarUrl && (
              <button onClick={() => setAvatarUrl('')} className="ml-2 text-xs text-muted-foreground hover:text-destructive">
                {t('common.remove')}
              </button>
            )}
          </div>
        </div>
        <div>
          <Label>{t('settings.profile_name')}</Label>
          <Input value={fullName} onChange={e => setFullName(e.target.value)} />
        </div>
        <div className="text-xs text-muted-foreground">Email: {user.email}</div>
      </section>

      {/* Language */}
      <section className="rounded-2xl border bg-card p-4 space-y-2">
        <div className="flex items-center gap-2 text-sm font-semibold">
          <Languages className="w-4 h-4 text-primary" />{t('settings.language')}
        </div>
        <Select value={lang} onValueChange={setLang}>
          <SelectTrigger><SelectValue /></SelectTrigger>
          <SelectContent>
            {languages.map(l => (
              <SelectItem key={l.code} value={l.code}>
                <span className="mr-2">{l.flag}</span>{l.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </section>

      {/* Theme */}
      <section className="rounded-2xl border bg-card p-4 space-y-2">
        <div className="flex items-center gap-2 text-sm font-semibold">
          <Palette className="w-4 h-4 text-primary" />{t('settings.theme')}
        </div>
        <div className="grid grid-cols-3 gap-2">
          {[
            { value: 'light', label: t('settings.theme_light') },
            { value: 'dark', label: t('settings.theme_dark') },
            { value: 'system', label: t('settings.theme_system') },
          ].map(opt => (
            <button
              key={opt.value}
              onClick={() => setTheme(opt.value)}
              className={`px-3 py-2 rounded-lg border text-sm font-medium transition ${
                theme === opt.value ? 'border-primary bg-primary/10 text-primary' : 'border-border hover:border-primary/50'
              }`}
            >
              {opt.label}
            </button>
          ))}
        </div>
      </section>

      {/* Plan & Subscription */}
      <section className="rounded-2xl border bg-card p-4 space-y-3">
        <div className="flex items-center gap-2 text-sm font-semibold">
          <Crown className="w-4 h-4 text-primary" />{t('settings.plan')}
        </div>
        {planLoading ? (
          <div className="flex justify-center py-4"><Loader2 className="w-6 h-6 animate-spin" /></div>
        ) : (
          <div className="space-y-3">
            <div className="flex items-center justify-between">
              <div>
                <div className="flex items-center gap-2">
                  <span className="font-medium">
                    {plan?.plan === 'pro' ? t('settings.plan_pro') : t('settings.plan_free')}
                  </span>
                  {plan?.plan === 'pro' && <ProBadge size="sm" />}
                </div>
                {plan?.plan === 'pro' && plan?.subscriptionType && (
                  <div className="text-xs text-muted-foreground mt-0.5">
                    {plan.subscriptionType === 'pro_yearly' ? t('settings.plan_yearly') : t('settings.plan_monthly')}
                  </div>
                )}
              </div>
              {plan?.plan === 'pro' && plan?.subscriptionEnd && (
                <div className="text-xs text-right">
                  <div className={plan.cancelled ? 'text-amber-600 font-medium' : 'text-muted-foreground'}>
                    {plan.cancelled ? t('settings.plan_cancelled_until') : t('settings.plan_next_charge')}
                  </div>
                  <div className="text-muted-foreground">
                    {new Date(plan.subscriptionEnd).toLocaleDateString(locale, { day: 'numeric', month: 'long', year: 'numeric' })}
                  </div>
                </div>
              )}
            </div>
            {plan?.plan === 'free' ? (
              <div className="rounded-xl border border-primary/30 bg-gradient-to-br from-primary/5 to-accent/5 p-3 space-y-2.5">
                <div className="text-xs font-semibold text-foreground/90">{t('settings.plan_pro_intro')}</div>
                <ul className="space-y-1.5 text-xs text-foreground/80">
                  <li className="flex items-start gap-2">
                    <InfinityIcon className="w-3.5 h-3.5 text-primary shrink-0 mt-0.5" />
                    <span>{t('settings.plan_pro_feature_unlimited')}</span>
                  </li>
                  <li className="flex items-start gap-2">
                    <Sparkles className="w-3.5 h-3.5 text-primary shrink-0 mt-0.5" />
                    <span>{t('settings.plan_pro_feature_ai')}</span>
                  </li>
                  <li className="flex items-start gap-2">
                    <FileText className="w-3.5 h-3.5 text-primary shrink-0 mt-0.5" />
                    <span>{t('settings.plan_pro_feature_past')}</span>
                  </li>
                  <li className="flex items-start gap-2">
                    <Crown className="w-3.5 h-3.5 text-primary shrink-0 mt-0.5" />
                    <span>{t('settings.plan_pro_feature_members')}</span>
                  </li>
                </ul>
                <Button size="sm" onClick={handleUpgrade} disabled={awaitingWebhook} className="w-full sm:w-auto">
                  {awaitingWebhook ? (
                    <>
                      <Loader2 className="w-3.5 h-3.5 mr-1.5 animate-spin" />
                      {t('sub.activating_pro')}
                    </>
                  ) : (
                    <>
                      <Crown className="w-3.5 h-3.5 mr-1.5" />{t('settings.plan_upgrade_btn')}
                    </>
                  )}
                </Button>
              </div>
            ) : (
              <Button size="sm" variant="outline" onClick={handleManageSubscription} disabled={portalLoading} className="w-full sm:w-auto">
                {portalLoading ? <Loader2 className="w-3.5 h-3.5 mr-1.5 animate-spin" /> : <ExternalLink className="w-3.5 h-3.5 mr-1.5" />}
                {t('settings.plan_manage_btn')}
              </Button>
            )}
          </div>
        )}
      </section>

      <UpgradePlanDialog
        open={upgradeOpen}
        onOpenChange={setUpgradeOpen}
        hidePerTrip
      />

      {/* Notifications */}
      <section className="rounded-2xl border bg-card p-4 space-y-3">
        <div className="flex items-center gap-2 text-sm font-semibold">
          <BellRing className="w-4 h-4 text-primary" />{t('settings.notifications')}
        </div>
        <div className="flex items-center justify-between gap-3">
          <Label htmlFor="ni" className="font-normal cursor-pointer">{t('settings.notify_invites')}</Label>
          <Switch id="ni" checked={notifyInvites} onCheckedChange={setNotifyInvites} />
        </div>
        <div className="flex items-center justify-between gap-3">
          <Label htmlFor="nu" className="font-normal cursor-pointer">{t('settings.notify_updates')}</Label>
          <Switch id="nu" checked={notifyUpdates} onCheckedChange={setNotifyUpdates} />
        </div>
      </section>

      <div className="flex justify-end">
        <Button onClick={handleSave} disabled={saving}>
          {saving && <Loader2 className="w-3 h-3 mr-1.5 animate-spin" />}{t('common.save')}
        </Button>
      </div>

      {/* Danger zone */}
      <section className="rounded-2xl border border-destructive/40 bg-destructive/5 p-4 space-y-2">
        <div className="flex items-center gap-2 text-sm font-semibold text-destructive">
          <ShieldAlert className="w-4 h-4" />{t('settings.danger_zone')}
        </div>
        <Button variant="destructive" size="sm" onClick={handleDeleteAccount} disabled={deletingAccount}>
          {deletingAccount && <Loader2 className="w-3 h-3 mr-1.5 animate-spin" />}
          {t('settings.delete_account')}
        </Button>
      </section>

      <ConfirmDialog
        open={confirmDeleteAcc}
        onOpenChange={setConfirmDeleteAcc}
        title={t('common.delete_confirm_title')}
        description={t('settings.delete_account_confirm')}
        confirmLabel={t('common.delete')}
        variant="destructive"
        onConfirm={() => {
          setConfirmDeleteAcc(false);
          performDeleteAccount();
        }}
      />

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