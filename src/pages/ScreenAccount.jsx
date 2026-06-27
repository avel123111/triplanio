import React, { useState, useEffect, useRef } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useSearchParams, useNavigate } from 'react-router-dom';
import { Icon } from '../design/icons';
import {
  Badge, Btn, Toggle, Severity, SearchSelect,
} from '../design/index';
import { useAuth } from '@/lib/AuthContext';
import { useI18n, useI18nFormat } from '@/lib/i18n/I18nContext';
import { useTheme } from '@/lib/ThemeContext';
import { isProActive } from '@/lib/subscription';
import { supabase } from '@/api/supabaseClient';
import AppHeader from '@/components/AppHeader';
import TelegramUnlinkDialog from '@/components/common/TelegramUnlinkDialog';
import { avatarGradient } from '@/lib/avatarRamp';
import '../design/app.css';

// ─── Helpers ────────────────────────────────────────────────────────────────

// Searchable, scalable language list (Pavel: not fixed-3 — popover with search).
// Only languages with a real locale bundle are listed; the search/popover UI is
// ready to scale as more bundles land.
const LANGS = [
  { code: 'ru', native: 'Русский', flag: 'RU', sub: 'Russian' },
  { code: 'en', native: 'English', flag: 'EN', sub: 'English' },
  { code: 'es', native: 'Español', flag: 'ES', sub: 'Spanish' },
];

// getUserPlan response → one of: 'no-sub' | 'with-sub' | 'annual' | 'cancelled'
function derivePlanState(plan) {
  if (!plan || plan.plan === 'free') return 'no-sub';
  if (plan.cancelled) return 'cancelled';
  if (plan.subscriptionType === 'pro_yearly') return 'annual';
  return 'with-sub';
}

function fmtDate(iso, locale) {
  if (!iso) return '';
  return new Date(iso).toLocaleDateString(locale || 'ru-RU', {
    day: 'numeric', month: 'long', year: 'numeric',
  });
}

// ─── Subscription module (4 plan faces) ───────────────────────────────────────

function SubscriptionModule({ planState, plan, planLoading, awaitingWebhook, portalLoading, onUpgrade, onManage, locale, prices }) {
  const { t, fmtMoney } = useI18nFormat();
  // Tariff amounts come from Stripe in minor units; format in the active locale,
  // currency from Stripe (fallback usd = the products' real currency).
  const money = (cents, cur) =>
    cents == null ? null : fmtMoney(cents / 100, cur || 'usd', { minFraction: 0, maxFraction: 2 });
  const priceOf = (type) => {
    const p = prices?.[type];
    return (p && p.unit_amount != null) ? money(p.unit_amount, p.currency) : null;
  };
  const yearlyMonthlyEq = () => {
    const p = prices?.pro_yearly;
    return (p && p.unit_amount != null) ? money(Math.round(p.unit_amount / 12), p.currency) : null;
  };
  const monthlyPrice = priceOf('pro_monthly');
  const yearlyPrice = priceOf('pro_yearly');

  // Exact billed amount from the user's Stripe subscription (preferred over catalog).
  const actual = plan?.actualPrice;
  const actualMoney = (actual && actual.amount != null) ? money(actual.amount, actual.currency) : null;
  const actualMonthlyEq = (actual && actual.amount != null && actual.interval === 'year')
    ? money(Math.round(actual.amount / 12), actual.currency) : null;

  if (planLoading) {
    return (
      <div className="card">
        <div style={{ height: 90, display: 'grid', placeItems: 'center' }}>
          <div style={{ width: 22, height: 22, border: '2px solid var(--line)', borderTopColor: 'var(--brand)', borderRadius: '50%', animation: 'spin 0.8s linear infinite' }} />
        </div>
      </div>
    );
  }

  if (planState === 'no-sub') {
    return (
      <div className="card">
        <div className="acct-plan">
          <div className="acct-plan__face acct-plan__face--free">
            <div className="acct-plan__k">{t('account.plan_current')}</div>
            <div className="acct-plan__v">Free</div>
          </div>
          <div className="acct-plan__side">
            <div className="acct-plan__line">{t('account.free_desc')}</div>
            <div className="acct-plan__acts">
              <Btn variant="pro" icon="pro" disabled={awaitingWebhook} onClick={onUpgrade}>
                {t('account.go_to_pro')}
              </Btn>
            </div>
          </div>
        </div>
      </div>
    );
  }

  if (planState === 'with-sub') {
    return (
      <div className="card">
        <div className="acct-plan">
          <div className="acct-plan__face acct-plan__face--mo">
            <span className="blob" aria-hidden="true" />
            <div className="acct-plan__k">{t('account.pro_monthly_sub')}</div>
            <div className="acct-plan__v num">{actualMoney || monthlyPrice || 'Pro'}{(actualMoney || monthlyPrice) && <span style={{ fontSize: 'var(--fs-base)' }}>{t('account.per_month_short')}</span>}</div>
            <div className="acct-plan__p">{t('account.active')}</div>
          </div>
          <div className="acct-plan__side">
            {plan?.subscriptionEnd && (
              <div className="acct-plan__line num">{t('account.next_charge')} <b>{fmtDate(plan.subscriptionEnd, locale)}</b></div>
            )}
            <div className="acct-plan__acts">
              {yearlyPrice && (
                <Btn variant="soft" size="sm" icon="arrow" disabled={portalLoading} onClick={onManage}>
                  {t('account.switch_yearly', { price: yearlyPrice })}
                </Btn>
              )}
              <Btn variant="ghost" size="sm" icon="external" disabled={portalLoading} onClick={onManage}>
                {portalLoading ? t('account.opening') : t('account.billing_portal')}
              </Btn>
            </div>
            <div className="acct-note"><Icon name="info" size={14} /><span>{t('account.after_cancel_access')}</span></div>
          </div>
        </div>
      </div>
    );
  }

  if (planState === 'annual') {
    return (
      <div className="card">
        <div className="acct-plan">
          <div className="acct-plan__face acct-plan__face--yr">
            <span className="blob" aria-hidden="true" />
            <div className="acct-plan__k">{t('account.pro_yearly_sub')}</div>
            <div className="acct-plan__v num">{actualMoney || yearlyPrice || 'Pro'}{(actualMoney || yearlyPrice) && <span style={{ fontSize: 'var(--fs-base)' }}>{t('account.per_year_short')}</span>}</div>
            {(actualMonthlyEq || yearlyMonthlyEq()) && <div className="acct-plan__p num">{t('account.equivalent')} {actualMonthlyEq || yearlyMonthlyEq()}{t('account.per_month_short')}</div>}
          </div>
          <div className="acct-plan__side">
            <div className="acct-plan__line"><Badge variant="success" icon="check">{t('account.active')}</Badge>{plan?.subscriptionEnd && <span className="num">{t('account.renews')} <b>{fmtDate(plan.subscriptionEnd, locale)}</b></span>}</div>
            <div className="acct-plan__acts">
              <Btn variant="ghost" size="sm" icon="external" disabled={portalLoading} onClick={onManage}>
                {portalLoading ? t('account.opening') : t('account.billing_portal')}
              </Btn>
              <button className="acct-linktext" onClick={onManage}>{t('account.cancel_until_year_end')}</button>
            </div>
            <div className="acct-note"><Icon name="info" size={14} /><span>{t('account.yearly_note')}</span></div>
          </div>
        </div>
      </div>
    );
  }

  // cancelled
  return (
    <div className="card">
      <div className="acct-plan">
        <div className="acct-plan__face acct-plan__face--ca">
          <span className="blob" aria-hidden="true" />
          <div className="acct-plan__k">{t('account.cancelled_sub')}</div>
          <div className="acct-plan__v" style={{ fontSize: 'var(--fs-h3)' }}>{t('account.pro_cancelled')}</div>
          {plan?.subscriptionEnd && <div className="acct-plan__p">{fmtDate(plan.subscriptionEnd, locale)}</div>}
        </div>
        <div className="acct-plan__side">
          <div className="acct-plan__line">{t('account.cancelled_desc')}</div>
          <div className="acct-plan__acts">
            <Btn variant="primary" size="sm" icon="refresh" disabled={portalLoading} onClick={onManage}>
              {portalLoading ? t('account.opening') : t('account.resume')}
            </Btn>
          </div>
          <div className="acct-note"><Icon name="info" size={14} /><span>{t('account.cancelled_note')}</span></div>
        </div>
      </div>
    </div>
  );
}

// ─── Reminder channels (Telegram integrations + future channels) ──────────────
// Data: telegramGetMyIntegrations (one row per binding). Connected → collapsible
// list of linked trips; empty → prompt to connect from a trip. The owner unlinks
// via the shared TelegramUnlinkDialog (same as Trip settings).

function ReminderChannels() {
  const { t } = useI18n();
  const nav = useNavigate();
  const [items, setItems] = useState(null); // null = loading
  const [open, setOpen] = useState(false); // Telegram block collapsed by default
  const [unlinkState, setUnlinkState] = useState(null); // null | { account }

  const load = React.useCallback(async () => {
    const { data, error } = await supabase.functions.invoke('telegramGetMyIntegrations');
    setItems(error ? [] : (data?.integrations ?? []));
  }, []);
  useEffect(() => { load(); }, [load]);

  const nick = (a) =>
    a.telegram_username ? `@${a.telegram_username}` : (a.telegram_first_name || t('telegram.unknown_user'));

  const doUnlink = async (a) => {
    setItems(list => list.filter(x => x.id !== a.id)); // optimistic
    const { error } = await supabase.functions.invoke('telegramDisconnect', {
      body: { tripId: a.trip_id, integrationId: a.id },
    });
    if (error) load();
  };
  const unlink = (a) => setUnlinkState({ account: a });

  const connected = Array.isArray(items) && items.length > 0;

  // future, non-functional channels (visual placeholders)
  const soon = (
    <>
      <div className="acct-chan acct-chan--soon">
        <span className="acct-chan__ic" style={{ background: 'var(--surface-2)', color: 'var(--success)' }}><Icon name="whatsapp" size={20} /></span>
        <div className="acct-chan__main">
          <div className="acct-chan__t">WhatsApp</div>
          <div className="acct-chan__s">{t('account.channel_whatsapp_desc')}</div>
          <Badge variant="quiet">{t('trip.addon_coming_soon')}</Badge>
        </div>
      </div>
      <div className="acct-chan acct-chan--soon">
        <span className="acct-chan__ic" style={{ background: 'var(--surface-2)', color: 'var(--ai)' }}><Icon name="bell" size={20} /></span>
        <div className="acct-chan__main">
          <div className="acct-chan__t">{t('account.channel_push')}</div>
          <div className="acct-chan__s">{t('account.channel_push_desc')}</div>
          <Badge variant="quiet">{t('trip.addon_coming_soon')}</Badge>
        </div>
      </div>
    </>
  );

  return (
    <div className="card">
      <div className="acct-subhead">{t('account.channels_title')}</div>
      <div className="muted" style={{ fontSize: 'var(--fs-meta)', margin: '3px 0 16px' }}>{t('account.channels_desc')}</div>

      <div className="acct-chanlist">
        {items === null ? (
          <div className="muted" style={{ fontSize: 'var(--fs-base)', padding: 8 }}>{t('common.loading')}</div>
        ) : connected ? (
          <div>
            <button className="acct-chan acct-chan--btn" aria-expanded={open} onClick={() => setOpen(v => !v)}>
              <span className="acct-chan__ic" style={{ background: 'var(--info-soft)', color: 'var(--info)' }}><Icon name="telegram" size={20} /></span>
              <span className="acct-chan__main">
                <span className="acct-chan__t">Telegram</span>
                <span className="acct-chan__s">{t('telegram.account_section_subtitle')}</span>
                <Badge variant="success" icon="check">{t('telegram.connected')}</Badge>
              </span>
              <Icon name="chev" size={16} className="acct-chan__chev" />
            </button>
            {open && (
              <div className="acct-tgtrips">
                <div className="acct-tgtrips__lbl">{t('telegram.linked_trips')}</div>
                {items.map((a) => (
                  <div key={a.id} className="acct-tgrow">
                    <span className="acct-tgrow__ic"><Icon name="map" size={15} /></span>
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div className="acct-tgrow__t">
                        <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{a.trip_title}</span>
                        <Badge variant="quiet">{t(`trips.role_${a.role}`)}</Badge>
                      </div>
                      <div className="muted mono" style={{ fontSize: 'var(--fs-micro)', marginTop: 1 }}>{nick(a)}</div>
                    </div>
                    <Btn variant="ghost" size="sm" onClick={() => nav(`/trip/${a.trip_id}?lens=settings`)}>{t('telegram.go_to_trip')}</Btn>
                    <Btn variant="ghost" size="sm" icon="unlink" ariaLabel={t('telegram.unlink')} onClick={() => unlink(a)} />
                  </div>
                ))}
                <div className="acct-tghint"><Icon name="info" size={13} /><span>{t('telegram.account_hint')}</span></div>
              </div>
            )}
          </div>
        ) : (
          <div className="acct-chan">
            <span className="acct-chan__ic" style={{ background: 'var(--surface-2)', color: 'var(--info)' }}><Icon name="telegram" size={20} /></span>
            <div className="acct-chan__main">
              <div className="acct-chan__t">Telegram</div>
              <div className="acct-chan__s">{t('telegram.account_empty_desc')}</div>
            </div>
            <Btn variant="soft" size="sm" onClick={() => nav('/trips')}>{t('telegram.go_to_trips')}</Btn>
          </div>
        )}
        {soon}
        {unlinkState && (
          <TelegramUnlinkDialog
            open={true}
            onOpenChange={(o) => { if (!o) setUnlinkState(null); }}
            handle={nick(unlinkState.account)}
            onConfirm={() => doUnlink(unlinkState.account)}
          />
        )}
      </div>
    </div>
  );
}

// ─── Main component ───────────────────────────────────────────────────────────

export default function ScreenAccount() {
  const { user, checkUserAuth, logout } = useAuth();
  const { t } = useI18nFormat();
  const { lang, setLang, units, setUnits } = useI18n();
  const { theme, setTheme } = useTheme();
  const nav = useNavigate();

  // In-app notifications — reuse the bell's query key so the cache is shared
  // (no extra fetch) and the unread count stays in sync across the app.
  const { data: inboxNotifs = [] } = useQuery({
    queryKey: ['notifications', user?.email],
    queryFn: async () => {
      if (!user?.email) return [];
      const { data, error } = await supabase
        .from('notifications')
        .select('*')
        .order('created_at', { ascending: false })
        .limit(30);
      if (error) throw error;
      return data || [];
    },
    enabled: !!user?.email,
  });
  const unreadCount = inboxNotifs.filter(n => !n.read).length;

  let searchParams;
  try {
    // eslint-disable-next-line react-hooks/rules-of-hooks
    [searchParams] = useSearchParams();
  } catch {
    searchParams = new URLSearchParams();
  }

  const avatarInputRef = useRef(null);

  // ── Plan ───────────────────────────────────────────────────────────────────
  const [plan, setPlan] = useState(null);
  const [planLoading, setPlanLoading] = useState(true);
  const [prices, setPrices] = useState(null);

  // ── Profile form ───────────────────────────────────────────────────────────
  const [fullName, setFullName] = useState('');
  const [avatarUrl, setAvatarUrl] = useState('');
  const [notifyInvites, setNotifyInvites] = useState(true);
  const [notifyUpdates, setNotifyUpdates] = useState(true);

  // ── UI ─────────────────────────────────────────────────────────────────────
  const [saving, setSaving] = useState(false);
  const [uploadingAvatar, setUploadingAvatar] = useState(false);
  const [savedFlash, setSavedFlash] = useState(false);
  const [portalLoading, setPortalLoading] = useState(false);
  const [activeSec, setActiveSec] = useState('profile');
  const openUpgrade = () => nav('/pro?hidePerTrip=1');
  const [errorMsg, setErrorMsg] = useState(null);

  // Delete account flow: null | 'confirm' | 'blocked'
  const [deleteState, setDeleteState] = useState(null);
  const [deleteInput, setDeleteInput] = useState('');
  const [deletingAccount, setDeletingAccount] = useState(false);

  const planState = derivePlanState(plan);

  const localeMap = { ru: 'ru-RU', en: 'en-US', es: 'es-ES' };
  const locale = localeMap[lang] || 'ru-RU';

  const avatarName = fullName || user?.email || '?';
  const avatarInitials = avatarName.split(/\s+/).map(p => p[0]).join('').slice(0, 2).toUpperCase();
  const avatarBgStyle = avatarUrl
    ? { backgroundImage: `url(${avatarUrl})` }
    : { background: avatarGradient(avatarName) };

  // ── Seed form from user profile ────────────────────────────────────────────
  useEffect(() => {
    if (!user) return;
    setFullName(user.full_name || '');
    setAvatarUrl(user.avatar_url || '');
    setNotifyInvites(user.notify_email_invites !== false);
    setNotifyUpdates(user.notify_email_updates !== false);
    loadPlan();
  }, [user]); // eslint-disable-line

  // Stripe-return polling + user refresh is owned globally by StripeReturnModals
  // (single handler). It keeps `stripe_status` in the URL until the webhook
  // flips Pro, then refreshes AuthContext.user — which re-seeds `plan` here via
  // the [user] effect above. We only read that URL flag (below) to disable the
  // upgrade button meanwhile, so a double-tap can't trigger a second checkout.

  // ── Scroll-spy: highlight the nav item for the section in view ──────────────
  useEffect(() => {
    const ids = ['profile', 'plan', 'appearance', 'notify', 'help', 'session'];
    const els = ids.map(id => document.getElementById(`acct-${id}`)).filter(Boolean);
    if (!els.length) return;
    const obs = new IntersectionObserver((ents) => {
      ents.forEach(en => { if (en.isIntersecting) setActiveSec(en.target.id.replace('acct-', '')); });
    }, { rootMargin: '-20% 0px -70% 0px' });
    els.forEach(el => obs.observe(el));
    return () => obs.disconnect();
  }, [user, planLoading]);

  // ── API ────────────────────────────────────────────────────────────────────
  const loadPlan = async () => {
    try {
      const { data } = await supabase.functions.invoke('getUserPlan');
      setPlan(data ?? null);
    } catch (e) { console.error('getUserPlan error:', e); }
    finally { setPlanLoading(false); }
  };

  useEffect(() => {
    let cancelled = false;
    supabase.functions.invoke('getStripePrices', { body: {} })
      .then((res) => { if (!cancelled) setPrices(res.data?.prices || null); })
      .catch((e) => console.error('getStripePrices error:', e));
    return () => { cancelled = true; };
  }, []);

  const handleSave = async () => {
    setSaving(true);
    setErrorMsg(null);
    try {
      const { error } = await supabase
        .from('users')
        .update({
          full_name:            fullName,
          avatar_url:           avatarUrl,
          notify_email_invites: notifyInvites,
          notify_email_updates: notifyUpdates,
        })
        .eq('id', user.id);
      if (error) throw error;
      await checkUserAuth?.();
      setSavedFlash(true);
      setTimeout(() => setSavedFlash(false), 1500);
    } catch (e) {
      console.error('save profile error:', e);
      setErrorMsg(t('account.err_save') + (e.message || String(e)));
    } finally {
      setSaving(false);
    }
  };

  const handleAvatarUpload = async (file) => {
    if (!file || !user) return;
    setUploadingAvatar(true);
    setErrorMsg(null);
    try {
      const ext = (file.name.split('.').pop() || 'png').toLowerCase();
      const path = `${user.id}/avatar.${ext}`;
      const { error: uploadErr } = await supabase.storage
        .from('avatars')
        .upload(path, file, { upsert: true, contentType: file.type || undefined });
      if (uploadErr) throw uploadErr;
      const { data: { publicUrl } } = supabase.storage.from('avatars').getPublicUrl(path);
      const url = `${publicUrl}?t=${Date.now()}`;
      const { error: dbErr } = await supabase.from('users').update({ avatar_url: url }).eq('id', user.id);
      if (dbErr) throw dbErr;
      setAvatarUrl(url);
      await checkUserAuth?.();
    } catch (e) {
      console.error('avatar upload error:', e);
      setErrorMsg(t('account.err_avatar_upload') + (e.message || String(e)));
    } finally {
      setUploadingAvatar(false);
    }
  };

  const handleRemoveAvatar = async () => {
    if (!user) return;
    setErrorMsg(null);
    const prev = avatarUrl;
    setAvatarUrl(''); // optimistic
    try {
      const { error } = await supabase.from('users').update({ avatar_url: null }).eq('id', user.id);
      if (error) throw error;
      try {
        const { data: files } = await supabase.storage.from('avatars').list(user.id);
        if (files?.length) await supabase.storage.from('avatars').remove(files.map(f => `${user.id}/${f.name}`));
      } catch { /* ignore */ }
      await checkUserAuth?.();
    } catch (e) {
      console.error('avatar remove error:', e);
      setAvatarUrl(prev);
      setErrorMsg(t('account.err_avatar_remove') + (e.message || String(e)));
    }
  };

  const handleManageSubscription = async () => {
    try { if (window.self !== window.top) {
      setErrorMsg(t('account.err_portal_iframe'));
      return;
    }} catch { return; }
    setPortalLoading(true);
    setErrorMsg(null);
    try {
      const { data, error } = await supabase.functions.invoke('createBillingPortal', {
        body: { returnPath: '/settings' },
      });
      if (error) throw error;
      if (data?.url) window.open(data.url, '_blank', 'noopener');
      else setErrorMsg(t('account.err_portal_open'));
    } catch (e) {
      console.error('billing portal error:', e);
      setErrorMsg(t('account.err_billing') + (e.message || String(e)));
    } finally {
      setPortalLoading(false);
    }
  };

  const handleDeleteAccount = () => {
    const hasActiveSub = plan?.plan === 'pro' && !plan?.cancelled;
    setDeleteState(hasActiveSub ? 'blocked' : 'confirm');
    setDeleteInput('');
  };

  const performDeleteAccount = async () => {
    setDeletingAccount(true);
    setErrorMsg(null);
    try {
      const { data, error } = await supabase.functions.invoke('deleteMyAccount');
      if (error) {
        // supabase-js puts the real response body on FunctionsHttpError.context
        // (a Response); .message is only the useless "non-2xx status code".
        let code = '';
        try { code = (await error.context?.json())?.code || ''; } catch { /* no body */ }
        if (code === 'active_subscription') { setDeleteState('blocked'); return; }
        setErrorMsg(t(code === 'unauthorized' ? 'account.err_delete_unauthorized' : 'account.err_delete_failed'));
        setDeleteState(null);
        return;
      }
      if (data?.code && data.code !== 'ok') {
        setErrorMsg(t('account.err_delete_failed'));
        setDeleteState(null);
        return;
      }
      await logout();
    } catch (e) {
      console.error('deleteMyAccount error:', e);
      setErrorMsg(t('account.err_delete_failed'));
      setDeleteState(null);
    } finally {
      setDeletingAccount(false);
    }
  };

  // ── Guard ──────────────────────────────────────────────────────────────────
  if (!user) {
    return (
      <div style={{ display: 'flex', justifyContent: 'center', paddingTop: 60 }}>
        <div style={{ width: 24, height: 24, border: '2px solid var(--line)', borderTopColor: 'var(--brand)', borderRadius: '50%', animation: 'spin 0.8s linear infinite' }} />
      </div>
    );
  }

  const isPro = isProActive(user);
  // Checkout just returned and the webhook hasn't flipped Pro yet: StripeReturnModals
  // holds `stripe_status` in the URL while it polls. Disable the upgrade button in
  // this window so a second tap can't start another checkout (no own poller).
  const awaitingWebhook = searchParams?.get('stripe_status') === 'success' && !isPro;
  const isDark = theme === 'dark';

  const planBadge =
    planState === 'with-sub' ? <Badge variant="pro" icon="pro">{t('account.badge_pro_sub')}</Badge>
    : planState === 'annual' ? <Badge variant="pro" icon="pro">{t('account.badge_pro_yearly')}</Badge>
    : planState === 'cancelled' ? <Badge variant="quiet" icon="warning">{t('account.badge_pro_cancelled')}</Badge>
    : null;

  const NAV = [
    { id: 'profile', label: t('account.identity'), icon: 'user' },
    { id: 'plan', label: t('account.subscription'), icon: 'pro' },
    { id: 'appearance', label: t('account.preferences'), icon: 'globe' },
    { id: 'notify', label: t('account.email_notifs'), icon: 'bell' },
    { id: 'help', label: t('account.nav_help'), icon: 'shield' },
    { id: 'session', label: t('account.nav_session'), icon: 'trash' },
  ];
  const go = (id) => {
    setActiveSec(id);
    document.getElementById(`acct-${id}`)?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  };

  // ── Render ─────────────────────────────────────────────────────────────────
  return (
    <div className="app-shell" style={{ display: 'flex', flexDirection: 'column', minHeight: '100vh', background: 'var(--bg, var(--wash))' }}>

      {/* ── APP HEADER ── */}
      <AppHeader
        user={user}
        isPro={isPro}
        isDark={isDark}
        onToggleTheme={() => setTheme(theme === 'dark' ? 'light' : 'dark')}
        onBack={() => nav('/trips')}
        backTitle={t('notif.to_collection')}
        title={t('account.title')}
      />

      {/* Payment / action error banner (full width, above the workspace) */}
      {errorMsg && (
        <div style={{ maxWidth: 1120, margin: '16px auto 0', padding: '0 24px', width: '100%', boxSizing: 'border-box' }}>
          <Severity level="error" title={t('account.error_title')}
            action={<Btn variant="ghost" size="sm" onClick={() => setErrorMsg(null)}>{t('common.close')}</Btn>}>
            {errorMsg}
          </Severity>
        </div>
      )}

      {/* ── TWO-PANE WORKSPACE ── */}
      <div className="acct-shell">
        <h1 className="sr-only" style={{ position: 'absolute', width: 1, height: 1, overflow: 'hidden', clip: 'rect(0 0 0 0)' }}>{t('account.title')}</h1>

        {/* LEFT NAV (sticky, scroll-spy) */}
        <nav className="acct-nav" aria-label={t('account.title')}>
          {NAV.map(item => (
            <a key={item.id} className={activeSec === item.id ? 'active' : ''} onClick={() => go(item.id)}>
              <Icon name={item.icon} size={17} /> {item.label}
            </a>
          ))}
        </nav>

        {/* CONTENT */}
        <div className="acct-content">

          {/* ░░ PROFILE ░░ */}
          <section id="acct-profile">
            <h2 className="acct-sectitle">{t('account.identity')}</h2>
            <div className="acct-hero">
              <div className="acct-hero__band" aria-hidden="true"><span className="blob b1" /><span className="blob b2" /></div>
              {planBadge && <div className="acct-hero__plan">{planBadge}</div>}
              <div className="acct-hero__row">
                <div
                  className="acct-hero__av"
                  role="button" tabIndex={0}
                  aria-label={t('account.remove_avatar')}
                  style={avatarBgStyle}
                  onClick={() => avatarInputRef.current?.click()}
                >
                  {!avatarUrl && avatarInitials}
                  {uploadingAvatar
                    ? <span className="ov" style={{ opacity: 1 }}><div style={{ width: 20, height: 20, border: '2px solid rgba(255,255,255,.4)', borderTopColor: '#fff', borderRadius: '50%', animation: 'spin 0.8s linear infinite' }} /></span>
                    : <span className="ov"><Icon name="cam" size={18} /></span>}
                </div>
                <input
                  ref={avatarInputRef}
                  type="file"
                  accept="image/png,image/jpeg,image/gif,image/webp,image/svg+xml"
                  style={{ display: 'none' }}
                  onChange={e => handleAvatarUpload(e.target.files?.[0])}
                />
                <div className="acct-hero__id">
                  <div className="acct-hero__name">{fullName || user.email}</div>
                  <div className="acct-hero__mail">{user.email}</div>
                  <div className="acct-hero__actions">
                    <Btn variant="secondary" size="sm" icon="cam" onClick={() => avatarInputRef.current?.click()}>{t('common.upload')}</Btn>
                    {avatarUrl && (
                      <Btn variant="danger" size="sm" icon="trash" onClick={handleRemoveAvatar}>{t('account.remove_avatar')}</Btn>
                    )}
                  </div>
                </div>
              </div>
              <div className="acct-hero__edit">
                <div>
                  <label className="acct-flabel" htmlFor="acct-dispname">{t('account.display_name')}</label>
                  <input id="acct-dispname" className="input" value={fullName} onChange={e => setFullName(e.target.value)} />
                </div>
                <div>
                  <label className="acct-flabel" htmlFor="acct-mail">E-mail <Badge variant="quiet">{t('account.readonly')}</Badge></label>
                  <input id="acct-mail" className="input" value={user.email} readOnly />
                </div>
                <Btn variant="primary" icon={saving ? undefined : 'check'} disabled={saving} onClick={handleSave}>
                  {saving ? t('auth.saving') : t('common.save')}
                </Btn>
              </div>
            </div>
            {savedFlash && <div style={{ marginTop: 8 }}><Badge variant="success" icon="check">{t('settings.saved')}</Badge></div>}
          </section>

          {/* ░░ SUBSCRIPTION ░░ */}
          <section id="acct-plan">
            <h2 className="acct-sectitle">{t('account.subscription')} <small>{t('account.pro_monthly_sub')}</small></h2>
            <SubscriptionModule
              planState={planState}
              plan={plan}
              planLoading={planLoading}
              awaitingWebhook={awaitingWebhook}
              portalLoading={portalLoading}
              locale={locale}
              prices={prices}
              onUpgrade={openUpgrade}
              onManage={handleManageSubscription}
            />
          </section>

          {/* ░░ PREFERENCES (variant C — single-card list) ░░ */}
          <section id="acct-appearance">
            <h2 className="acct-sectitle">{t('account.preferences')}</h2>
            <div className="card">

              {/* Language */}
              <div className="acct-divrow">
                <span className="acct-ic-tile" style={{ background: 'var(--primary-soft)', color: 'var(--brand)' }}><Icon name="globe" size={16} /></span>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div className="acct-divrow__t">{t('account.pref_language')}</div>
                  <div className="acct-divrow__s">{t('account.pref_language_sub')}</div>
                </div>
                <div className="acct-prefctl">
                  <SearchSelect
                    value={lang}
                    onChange={setLang}
                    options={LANGS}
                    getKey={(l) => l.code}
                    matches={(l, q) => l.native.toLowerCase().includes(q) || l.sub.toLowerCase().includes(q) || l.code.includes(q)}
                    renderValue={(l) => (
                      <span style={{ display: 'inline-flex', alignItems: 'center', gap: 8 }}>
                        <span className="acct-lang__flag">{l.flag}</span>{l.native}
                      </span>
                    )}
                    renderOption={(l) => (
                      <>
                        <span className="acct-lang__flag">{l.flag}</span>
                        <span>{l.native}</span>
                        <span style={{ fontSize: 'var(--fs-meta)', color: 'var(--muted)' }}>{l.sub}</span>
                      </>
                    )}
                    searchPlaceholder={t('common.search')}
                    emptyText={t('common.not_found')}
                    title={t('settings.language')}
                    triggerClassName="input"
                    width={240}
                  />
                </div>
              </div>

              {/* Theme */}
              <div className="acct-divrow">
                <span className="acct-ic-tile" style={{ background: 'var(--ai-soft)', color: 'var(--ai)' }}><Icon name="sun" size={16} /></span>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div className="acct-divrow__t">{t('settings.theme')}</div>
                  <div className="acct-divrow__s">{t('account.pref_theme_sub')}</div>
                </div>
                <div className="acct-prefctl">
                  <div className="seg" role="group" aria-label={t('settings.theme')}>
                    <button aria-pressed={theme === 'light'} onClick={() => setTheme('light')}>{t('settings.theme_light')}</button>
                    <button aria-pressed={theme === 'dark'} onClick={() => setTheme('dark')}>{t('settings.theme_dark')}</button>
                    <button aria-pressed={theme === 'system'} onClick={() => setTheme('system')}>{t('settings.theme_system')}</button>
                  </div>
                </div>
              </div>

              {/* Unit system */}
              <div className="acct-divrow">
                <span className="acct-ic-tile" style={{ background: 'var(--primary-soft)', color: 'var(--brand)' }}><Icon name="route" size={16} /></span>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div className="acct-divrow__t">{t('account.units')}</div>
                  <div className="acct-divrow__s">{t('account.units_sub')}</div>
                </div>
                <div className="acct-prefctl">
                  <div className="seg" role="group" aria-label={t('account.units')}>
                    <button aria-pressed={units === 'metric'} onClick={() => setUnits('metric')}>{t('units.km')}</button>
                    <button aria-pressed={units === 'imperial'} onClick={() => setUnits('imperial')}>{t('units.mi')}</button>
                  </div>
                </div>
              </div>
            </div>
          </section>

          {/* ░░ NOTIFICATIONS + CHANNELS ░░ */}
          <section id="acct-notify">
            <h2 className="acct-sectitle">{t('account.email_notifs')}</h2>

            {/* In-app notifications — quick link to the inbox with unread count */}
            <button type="button" className="acct-inbox" style={{ marginBottom: 16 }} onClick={() => nav('/inbox')}>
              <span className="acct-inbox__ic"><Icon name="bell" size={18} /></span>
              <span className="acct-inbox__bd">
                <span className="acct-inbox__t">{t('account.inbox_title')}</span>
                <span className="acct-inbox__s">{t('account.inbox_sub')}</span>
              </span>
              {unreadCount > 0 && (
                <span className="acct-inbox__count" aria-label={t('account.inbox_unread', { count: unreadCount })}>
                  {unreadCount > 99 ? '99+' : unreadCount}
                </span>
              )}
              <Icon name="arrowR" size={16} />
            </button>

            <div className="card" style={{ marginBottom: 16 }}>
              <div className="acct-subhead" style={{ marginBottom: 6 }}>E-mail</div>
              <div className="acct-divrow">
                <div style={{ flex: 1 }}>
                  <div className="acct-divrow__t">{t('account.notif_invites')}</div>
                  <div className="acct-divrow__s">{t('account.notif_invites_desc')}</div>
                </div>
                <Toggle on={notifyInvites} onChange={setNotifyInvites} />
              </div>
              <div className="acct-divrow">
                <div style={{ flex: 1 }}>
                  <div className="acct-divrow__t">{t('account.notif_updates')}</div>
                  <div className="acct-divrow__s">{t('account.notif_updates_desc')}</div>
                </div>
                <Toggle on={notifyUpdates} onChange={setNotifyUpdates} />
              </div>
            </div>

            <ReminderChannels />
          </section>

          {/* ░░ HELP & LEGAL ░░ */}
          <section id="acct-help">
            <h2 className="acct-sectitle">{t('account.nav_help')}</h2>
            <div className="card">
              <div className="acct-divrow">
                <span className="acct-ic-tile" style={{ background: 'var(--primary-soft)', color: 'var(--brand)' }}><Icon name="chat" size={18} /></span>
                <div style={{ flex: 1, minWidth: 160 }}>
                  <div className="acct-divrow__t">{t('account.contact_us')}</div>
                  <div className="acct-divrow__s">
                    <a href="mailto:support@triplanio.com" style={{ color: 'var(--brand)' }}>support@triplanio.com</a> · {t('account.support_reply')}
                  </div>
                </div>
                <Btn variant="secondary" size="sm" icon="send" onClick={() => { window.location.href = 'mailto:support@triplanio.com'; }}>{t('account.write')}</Btn>
              </div>
              <a className="acct-divrow" href="/privacy" target="_blank" rel="noreferrer noopener" style={{ color: 'inherit', textDecoration: 'none' }}>
                <span className="acct-ic-tile" style={{ background: 'var(--wash)', color: 'var(--muted)' }}><Icon name="shield" size={18} /></span>
                <div style={{ flex: 1 }}>
                  <div className="acct-divrow__t">{t('account.privacy_title')}</div>
                  <div className="acct-divrow__s">{t('account.privacy_desc')}</div>
                </div>
                <Icon name="external" size={13} style={{ color: 'var(--muted-2)' }} />
              </a>
              <a className="acct-divrow" href="/terms" target="_blank" rel="noreferrer noopener" style={{ color: 'inherit', textDecoration: 'none' }}>
                <span className="acct-ic-tile" style={{ background: 'var(--wash)', color: 'var(--muted)' }}><Icon name="file" size={18} /></span>
                <div style={{ flex: 1 }}>
                  <div className="acct-divrow__t">{t('account.terms_title')}</div>
                  <div className="acct-divrow__s">{t('account.terms_desc')}</div>
                </div>
                <Icon name="external" size={13} style={{ color: 'var(--muted-2)' }} />
              </a>
            </div>
          </section>

          {/* ░░ SESSION & DANGER ░░ */}
          <section id="acct-session">
            <h2 className="acct-sectitle">{t('account.nav_session')}</h2>

            <div className="card card--danger" style={{ marginBottom: 16 }}>
              <div className="acct-divrow" style={{ border: 'none', padding: 0 }}>
                <span className="acct-ic-tile" style={{ background: 'var(--danger-soft)', color: 'var(--danger-ink)' }}><Icon name="trash" size={18} /></span>
                <div style={{ flex: 1, minWidth: 160 }}>
                  <div className="acct-divrow__t">{t('settings.delete_account')}</div>
                  <div className="acct-divrow__s">{t('account.delete_desc')}</div>
                </div>
                <Btn variant="danger" disabled={deletingAccount} onClick={handleDeleteAccount}>{t('settings.delete_account')}</Btn>
              </div>

              {deleteState === 'blocked' && (
                <Severity level="warning" title={t('account.cancel_sub_first')}>
                  {t('account.delete_blocked_desc')}
                  <div style={{ marginTop: 8 }}>
                    <Btn variant="ghost" size="sm" icon="external" disabled={portalLoading} onClick={handleManageSubscription}>
                      {portalLoading ? t('account.opening') : t('account.open_billing_portal')}
                    </Btn>
                  </div>
                </Severity>
              )}

              {deleteState === 'confirm' && (
                <Severity level="error" icon="trash" title={t('account.confirm_delete')}>
                  {t('account.confirm_delete_desc_1')} <b>{t('account.delete_word')}</b> {t('account.confirm_delete_desc_2')}
                  <div style={{ marginTop: 10, display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                    <input className="input" placeholder={t('account.delete_word')} value={deleteInput} onChange={e => setDeleteInput(e.target.value)} style={{ flex: 1, minWidth: 150 }} />
                    <Btn variant="danger-solid" size="sm" disabled={deleteInput !== t('account.delete_word') || deletingAccount} onClick={performDeleteAccount}>
                      {deletingAccount ? t('account.deleting') : t('account.delete_forever')}
                    </Btn>
                    <Btn variant="ghost" size="sm" onClick={() => setDeleteState(null)}>{t('common.cancel')}</Btn>
                  </div>
                </Severity>
              )}
            </div>

            <div className="card">
              <div className="acct-divrow" style={{ border: 'none', padding: 0 }}>
                <span className="acct-ic-tile" style={{ background: 'var(--surface-2)', color: 'var(--ink-2)' }}><Icon name="arrow" size={18} /></span>
                <div style={{ flex: 1, minWidth: 160 }}>
                  <div className="acct-divrow__t">{t('account.logout_title')}</div>
                  <div className="acct-divrow__s">{t('account.logout_desc')}</div>
                </div>
                <Btn variant="secondary" icon="arrow" onClick={logout}>{t('auth.logout')}</Btn>
              </div>
            </div>
          </section>

        </div>
      </div>
    </div>
  );
}
