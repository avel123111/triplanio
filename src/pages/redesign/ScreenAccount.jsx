import React, { useState, useEffect, useRef } from 'react';
import { useSearchParams, useNavigate } from 'react-router-dom';
import { Icon } from '../../design/icons';
import {
  Badge, Btn, Card, Severity, Toggle, ModalHost,
} from '../../design/index';
import { useAuth } from '@/lib/AuthContext';
import { useI18n } from '@/lib/i18n/I18nContext';
import { useTheme } from '@/lib/ThemeContext';
import { isProActive } from '@/lib/subscription';
import { supabase } from '@/api/supabaseClient';
import HeaderActions from '@/components/HeaderActions';
import '../../design/app.css';

// ─── Avatar helpers (inline so we can render directly into the 76×76 circle) ──

const AVATAR_COLORS = [
  ['#2167e2', '#5a8ff0'], ['#c9603a', '#e08158'], ['#1f8a5b', '#4ab98a'],
  ['#9c4ad9', '#c66ce2'], ['#c98a1a', '#e0a64b'], ['#4a6cd9', '#7a92e8'],
  ['#a83e6a', '#c96792'], ['#3d8aa8', '#5fadc9'],
];
function hashStr(s) { let h = 0; for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) | 0; return Math.abs(h); }

// ─── Other helpers ─────────────────────────────────────────────────────────────

const LANGS = [
  { code: 'ru', native: 'Русский' },
  { code: 'en', native: 'English' },
  { code: 'es', native: 'Español' },
];

/**
 * Map getUserPlan response → one of the 4 display states:
 *   'no-sub' | 'with-sub' | 'annual' | 'cancelled'
 */
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

// ─── Sub-components ───────────────────────────────────────────────────────────

function LegalRow({ icon, title, desc, href, last }) {
  return (
    <a
      href={href}
      target="_blank"
      rel="noreferrer noopener"
      style={{
        display: 'flex', alignItems: 'center', gap: 14, padding: '12px 0',
        borderBottom: last ? 'none' : '1px solid var(--line-2)',
        textDecoration: 'none', color: 'inherit',
      }}
    >
      <div style={{ width: 32, height: 32, borderRadius: 8, background: 'var(--wash)', color: 'var(--muted)', display: 'grid', placeItems: 'center', flexShrink: 0 }}>
        <Icon name={icon} size={14} />
      </div>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ fontWeight: 500, fontSize: 13.5 }}>{title}</div>
        <div className="muted" style={{ fontSize: 12 }}>{desc}</div>
      </div>
      <Icon name="external" size={13} style={{ color: 'var(--muted-2)' }} />
    </a>
  );
}

function SettingRow({ label, desc, on, onChange, last }) {
  return (
    <div style={{
      display: 'flex', alignItems: 'center', gap: 14, padding: '10px 0',
      borderBottom: last ? 'none' : '1px solid var(--line-2)',
    }}>
      <div style={{ flex: 1 }}>
        <div style={{ fontWeight: 500, fontSize: 13.5 }}>{label}</div>
        {desc && <div className="muted" style={{ fontSize: 12 }}>{desc}</div>}
      </div>
      <Toggle on={on} onChange={onChange} />
    </div>
  );
}

function SubscriptionCard({ planState, plan, planLoading, awaitingWebhook, portalLoading, onUpgrade, onManage, locale, prices, switchingPlan, onSwitchYearly }) {
  // Format the live price for a plan; null if not loaded yet.
  const money = (cents, cur) => {
    try {
      return new Intl.NumberFormat(locale || 'ru-RU', {
        style: 'currency', currency: (cur || 'eur').toUpperCase(),
        minimumFractionDigits: 0, maximumFractionDigits: 2,
      }).format(cents / 100);
    } catch { return null; }
  };
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

  // Exact amount the user is actually billed (from their Stripe subscription),
  // not the public catalog price. Prefer it whenever getUserPlan returned it.
  const actual = plan?.actualPrice;
  const actualMoney = (actual && actual.amount != null) ? money(actual.amount, actual.currency) : null;
  const actualMonthlyEq = (actual && actual.amount != null && actual.interval === 'year')
    ? money(Math.round(actual.amount / 12), actual.currency) : null;

  if (planLoading) {
    return (
      <Card title="Подписка" style={{ marginBottom: 16 }}>
        <div style={{ height: 60, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
          <div style={{ width: 22, height: 22, border: '2px solid var(--line)', borderTopColor: 'var(--brand)', borderRadius: '50%', animation: 'spin 0.8s linear infinite' }} />
        </div>
      </Card>
    );
  }

  if (planState === 'no-sub') {
    return (
      <Card title="Подписка" subtitle="Сейчас Free" className="ai-card" style={{ marginBottom: 16 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 16, flexWrap: 'wrap' }}>
          <div style={{ width: 48, height: 48, borderRadius: 12, background: 'var(--wash)', color: 'var(--muted)', display: 'grid', placeItems: 'center' }}>
            <Icon name="user" size={22} />
          </div>
          <div style={{ flex: 1, minWidth: 180 }}>
            <div style={{ fontWeight: 600, marginBottom: 4 }}>Free тариф</div>
            <div className="muted" style={{ fontSize: 12.5 }}>1 активный трип · без ИИ-помощника, ИИ-парсера и календарной линзы.</div>
          </div>
          <Btn
            variant="primary"
            icon={awaitingWebhook ? undefined : 'pro'}
            disabled={awaitingWebhook}
            onClick={onUpgrade}
          >
            {awaitingWebhook ? 'Активируем Pro…' : 'Перейти к Pro'}
          </Btn>
        </div>
      </Card>
    );
  }

  if (planState === 'with-sub') {
    return (
      <Card title="Подписка" subtitle="Pro · ежемесячная" style={{ marginBottom: 16 }}>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
          <div style={{ padding: 14, background: 'var(--brand-soft)', borderRadius: 12, display: 'flex', alignItems: 'center', gap: 14, flexWrap: 'wrap' }}>
            <div style={{ width: 44, height: 44, borderRadius: 11, background: 'var(--brand)', color: 'white', display: 'grid', placeItems: 'center' }}>
              <Icon name="pro" size={22} />
            </div>
            <div style={{ flex: 1, minWidth: 200 }}>
              <div style={{ fontWeight: 600 }}>Pro Monthly</div>
              <div className="muted num" style={{ fontSize: 12.5 }}>
                {(actualMoney || monthlyPrice) ? `${actualMoney || monthlyPrice}/мес` : 'Pro'}
                {plan?.subscriptionEnd && (
                  <> · следующее списание <b style={{ color: 'var(--ink-2)', fontWeight: 600 }}>{fmtDate(plan.subscriptionEnd, locale)}</b></>
                )}
              </div>
            </div>
            {yearlyPrice && (
              <Btn variant="ghost" size="sm" icon="arrow" disabled={switchingPlan} onClick={onSwitchYearly}>
                {switchingPlan ? 'Переключаем…' : `Перейти на годовой · ${yearlyPrice}/год`}
              </Btn>
            )}
            <Btn variant="ghost" size="sm" icon="external" disabled={portalLoading} onClick={onManage}>
              {portalLoading ? 'Открываем…' : 'Биллинг-портал'}
            </Btn>
          </div>
          <div className="muted" style={{ fontSize: 12.5 }}>
            После отмены доступ сохраняется до конца оплаченного периода.
          </div>
        </div>
      </Card>
    );
  }

  if (planState === 'annual') {
    return (
      <Card title="Подписка" subtitle="Pro · годовая · ✓ экономия 33%" style={{ marginBottom: 16, borderColor: 'var(--success)' }}>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
          <div style={{ padding: 14, background: 'var(--success-soft)', borderRadius: 12, display: 'flex', alignItems: 'center', gap: 14, flexWrap: 'wrap' }}>
            <div style={{ width: 44, height: 44, borderRadius: 11, background: 'var(--success)', color: 'white', display: 'grid', placeItems: 'center' }}>
              <Icon name="pro" size={22} />
            </div>
            <div style={{ flex: 1, minWidth: 200 }}>
              <div style={{ fontWeight: 600, display: 'flex', alignItems: 'center', gap: 6 }}>
                Pro Yearly <Badge variant="success">Активна</Badge>
              </div>
              <div className="muted num" style={{ fontSize: 12.5 }}>
                {(actualMoney || yearlyPrice) ? `${actualMoney || yearlyPrice}/год` : 'Pro'}
                {plan?.subscriptionEnd && (
                  <> · обновится <b style={{ color: 'var(--ink-2)', fontWeight: 600 }}>{fmtDate(plan.subscriptionEnd, locale)}</b></>
                )}
                {(actualMonthlyEq || yearlyMonthlyEq()) && ` · эквивалент ${actualMonthlyEq || yearlyMonthlyEq()}/мес`}
              </div>
            </div>
            <Btn variant="ghost" size="sm" icon="external" disabled={portalLoading} onClick={onManage}>
              {portalLoading ? 'Открываем…' : 'Биллинг-портал'}
            </Btn>
          </div>
          <div style={{ padding: 12, background: 'var(--wash)', borderRadius: 10, display: 'flex', alignItems: 'center', gap: 10 }}>
            <Icon name="info" size={14} style={{ color: 'var(--muted)' }} />
            <span className="muted" style={{ fontSize: 12.5 }}>Годовая подписка платится раз в год и не списывается ежемесячно.</span>
          </div>
          <div className="muted" style={{ fontSize: 12.5 }}>
            <button onClick={onManage} style={{ background: 'none', border: 'none', color: 'var(--brand)', cursor: 'pointer', fontSize: 12.5 }}>
              Отменить — будет действовать до конца года
            </button>
          </div>
        </div>
      </Card>
    );
  }

  if (planState === 'cancelled') {
    return (
      <Card title="Подписка" subtitle="Отменена" style={{ marginBottom: 16, borderColor: 'var(--warning-soft)' }}>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
          <div style={{ padding: 14, background: 'var(--warning-soft)', borderRadius: 12, display: 'flex', alignItems: 'center', gap: 14, flexWrap: 'wrap' }}>
            <div style={{ width: 44, height: 44, borderRadius: 11, background: 'var(--warning)', color: 'white', display: 'grid', placeItems: 'center' }}>
              <Icon name="warning" size={22} />
            </div>
            <div style={{ flex: 1, minWidth: 200 }}>
              <div style={{ fontWeight: 600 }}>
                Pro отменена{plan?.subscriptionEnd ? ` — действует до ${fmtDate(plan.subscriptionEnd, locale)}` : ''}
              </div>
              <div className="muted" style={{ fontSize: 12.5, marginTop: 2 }}>
                Все Pro-фичи доступны до этой даты. Потом аккаунт перейдёт на Free.
              </div>
            </div>
            <Btn variant="primary" size="sm" icon="refresh" disabled={portalLoading} onClick={onManage}>
              {portalLoading ? 'Открываем…' : 'Возобновить'}
            </Btn>
          </div>
          <div style={{ padding: 12, background: 'var(--wash)', borderRadius: 10, fontSize: 12.5, color: 'var(--muted)', lineHeight: 1.5 }}>
            После окончания периода доступ к ИИ-помощнику, парсингу и календарю исчезнет в трипах без отдельного Pro-апгрейда.
          </div>
        </div>
      </Card>
    );
  }

  return null;
}

// ─── Main component ───────────────────────────────────────────────────────────

export default function ScreenAccount() {
  const { user, checkUserAuth, logout } = useAuth();
  const { lang, setLang } = useI18n();
  const { theme, setTheme } = useTheme();
  const nav = useNavigate();

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
  const [awaitingWebhook, setAwaitingWebhook] = useState(false);
  const [prices, setPrices] = useState(null);          // live Stripe prices per plan
  const [switchingPlan, setSwitchingPlan] = useState(false);

  // ── Profile form ───────────────────────────────────────────────────────────
  const [fullName, setFullName] = useState('');
  const [avatarUrl, setAvatarUrl] = useState('');
  const [avatarHover, setAvatarHover] = useState(false);
  const [notifyInvites, setNotifyInvites] = useState(true);
  const [notifyUpdates, setNotifyUpdates] = useState(true);

  // ── UI ─────────────────────────────────────────────────────────────────────
  const [saving, setSaving] = useState(false);
  const [uploadingAvatar, setUploadingAvatar] = useState(false);
  const [savedFlash, setSavedFlash] = useState(false);
  const [portalLoading, setPortalLoading] = useState(false);
  const [langOpen, setLangOpen] = useState(false);
  const openUpgrade = () => nav('/pro?hidePerTrip=1');
  const [errorMsg, setErrorMsg] = useState(null);

  // Delete account flow: null | 'confirm' | 'blocked'
  const [deleteState, setDeleteState] = useState(null);
  const [deleteInput, setDeleteInput] = useState('');
  const [deletingAccount, setDeletingAccount] = useState(false);

  // ── Design-preview subscription state override (/ui tweaks panel) ──────────
  const previewState = typeof window !== 'undefined' ? window.__accountState : null;
  const planState = previewState || derivePlanState(plan);

  const localeMap = { ru: 'ru-RU', en: 'en-US', es: 'es-ES' };
  const locale = localeMap[lang] || 'ru-RU';

  // ── Avatar background (fills the 76×76 circle exactly) ────────────────────
  const avatarName = fullName || user?.email || '?';
  const avatarInitials = avatarName.split(/\s+/).map(p => p[0]).join('').slice(0, 2).toUpperCase();
  const [ac1, ac2] = AVATAR_COLORS[hashStr(avatarName) % AVATAR_COLORS.length];
  const avatarBgStyle = avatarUrl
    ? { backgroundImage: `url(${avatarUrl})`, backgroundSize: 'cover', backgroundPosition: 'center' }
    : { background: `linear-gradient(135deg, ${ac1}, ${ac2})` };

  // ── Seed form from user profile ────────────────────────────────────────────
  useEffect(() => {
    if (!user) return;
    setFullName(user.full_name || '');
    setAvatarUrl(user.avatar_url || '');
    setNotifyInvites(user.notify_email_invites !== false);
    setNotifyUpdates(user.notify_email_updates !== false);
    loadPlan();
  }, [user]); // eslint-disable-line

  // ── Stripe success: poll getUserPlan until webhook flips plan to Pro ────────
  useEffect(() => {
    if (searchParams?.get('stripe_status') !== 'success') return;
    let cancelled = false;
    setAwaitingWebhook(true);
    const start = Date.now();
    const tick = async () => {
      if (cancelled) return;
      try {
        const { data } = await supabase.functions.invoke('getUserPlan');
        if (cancelled) return;
        setPlan(data ?? null);
        setPlanLoading(false);
        if (data?.plan === 'pro') { setAwaitingWebhook(false); return; }
      } catch (e) { console.error('getUserPlan poll error:', e); }
      if (Date.now() - start >= 20000) { setAwaitingWebhook(false); return; }
      setTimeout(tick, 1500);
    };
    tick();
    return () => { cancelled = true; };
  }, [searchParams]); // eslint-disable-line

  // ── API ────────────────────────────────────────────────────────────────────

  const loadPlan = async () => {
    try {
      const { data } = await supabase.functions.invoke('getUserPlan');
      setPlan(data ?? null);
    } catch (e) { console.error('getUserPlan error:', e); }
    finally { setPlanLoading(false); }
  };

  // Live Stripe prices → show the user's actual subscription cost (no hardcode).
  useEffect(() => {
    let cancelled = false;
    supabase.functions.invoke('getStripePrices', { body: {} })
      .then((res) => { if (!cancelled) setPrices(res.data?.prices || null); })
      .catch((e) => console.error('getStripePrices error:', e));
    return () => { cancelled = true; };
  }, []);

  // Switch the active monthly subscription to yearly (Stripe proration).
  const handleSwitchToYearly = async () => {
    setSwitchingPlan(true);
    setErrorMsg(null);
    try {
      const { data, error } = await supabase.functions.invoke('changeSubscriptionPlan', {
        body: { targetPlan: 'pro_yearly' },
      });
      if (error) throw error;
      if (!data?.ok) { setErrorMsg('Не удалось сменить план: ' + (data?.code || 'ошибка')); return; }
      await loadPlan();
    } catch (e) {
      console.error('changeSubscriptionPlan error:', e);
      setErrorMsg('Ошибка смены плана: ' + (e.message || String(e)));
    } finally {
      setSwitchingPlan(false);
    }
  };

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
      setErrorMsg('Ошибка сохранения: ' + (e.message || String(e)));
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
      // Persist immediately to the users row so the avatar survives a reload
      // WITHOUT needing a separate "Сохранить" click, and refresh the auth
      // context so it shows everywhere (header, members, chat) right away.
      const { error: dbErr } = await supabase.from('users').update({ avatar_url: url }).eq('id', user.id);
      if (dbErr) throw dbErr;
      setAvatarUrl(url);
      await checkUserAuth?.();
    } catch (e) {
      console.error('avatar upload error:', e);
      setErrorMsg('Ошибка загрузки аватара: ' + (e.message || String(e)));
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
      // Best-effort storage cleanup (don't fail the action if this part errors).
      try {
        const { data: files } = await supabase.storage.from('avatars').list(user.id);
        if (files?.length) await supabase.storage.from('avatars').remove(files.map(f => `${user.id}/${f.name}`));
      } catch { /* ignore */ }
      await checkUserAuth?.();
    } catch (e) {
      console.error('avatar remove error:', e);
      setAvatarUrl(prev);
      setErrorMsg('Ошибка удаления аватара: ' + (e.message || String(e)));
    }
  };

  const handleManageSubscription = async () => {
    try { if (window.self !== window.top) {
      setErrorMsg('Для управления подпиской открой Triplanio в отдельной вкладке.');
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
      else setErrorMsg('Не удалось открыть биллинг-портал. Попробуй позже.');
    } catch (e) {
      console.error('billing portal error:', e);
      setErrorMsg('Ошибка биллинга: ' + (e.message || String(e)));
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
      if (error) throw error;
      if (data?.error) {
        const msg = String(data.error).toLowerCase();
        if (msg.includes('subscription') || msg.includes('cancel')) {
          setDeleteState('blocked');
          return;
        }
        throw new Error(data.error);
      }
      await logout();
    } catch (e) {
      console.error('deleteMyAccount error:', e);
      setErrorMsg('Ошибка удаления: ' + (e.message || String(e)));
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

  const currentLang = LANGS.find(l => l.code === lang) || LANGS[0];

  const isPro = isProActive(user);
  const isDark = theme === 'dark';

  // ── Render ─────────────────────────────────────────────────────────────────
  return (
    <div style={{ display: 'flex', flexDirection: 'column', minHeight: '100vh', background: 'var(--bg, var(--wash))' }}>
      <ModalHost />

      {/* ── APP HEADER — standard pattern (back / brand / crumb / actions) ── */}
      <header className="app-header" style={{ position: 'sticky', top: 0, zIndex: 50 }}>
        <button className="app-header__crumb-back" onClick={() => nav('/trips')} title="К коллекции">
          <Icon name="back" size={14} />
        </button>
        <div className="app-header__brand" onClick={() => nav('/trips')} style={{ cursor: 'pointer' }}>
          <img src="/triplanio-logo.svg" alt="Triplanio" style={{ width: 28, height: 28, borderRadius: 7, flexShrink: 0 }} />
          <span className="app-header__brand-name">Triplanio</span>
        </div>
        <div className="app-header__crumb">
          <span className="app-header__crumb-sep">/</span>
          <span style={{ fontSize: 13.5, fontWeight: 500, color: 'var(--ink-2)' }}>Настройки аккаунта</span>
        </div>
        <HeaderActions
          user={user}
          isPro={isPro}
          isDark={isDark}
          onToggleTheme={() => setTheme(theme === 'dark' ? 'light' : 'dark')}
        />
      </header>

      {/* ── PAGE CONTENT ────────────────────────────────────────────────── */}
      <main style={{ flex: 1, padding: '32px 28px', maxWidth: 760, margin: '0 auto', width: '100%', boxSizing: 'border-box' }}>

        {/* Page title row — Cancel + Save sit here, matching the design */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 22, flexWrap: 'wrap' }}>
          <h1 style={{ flex: 1, marginBottom: 0 }}>
            Настройки аккаунта
            {planState === 'with-sub'  && <Badge variant="warm" icon="pro" style={{ marginLeft: 10, verticalAlign: 4, fontSize: 11 }}>Pro · подписка</Badge>}
            {planState === 'annual'    && <Badge variant="warm" icon="pro" style={{ marginLeft: 10, verticalAlign: 4, fontSize: 11 }}>Pro · годовая</Badge>}
            {planState === 'cancelled' && <Badge variant="quiet" icon="warning" style={{ marginLeft: 10, verticalAlign: 4, fontSize: 11 }}>Pro · отменена</Badge>}
          </h1>
          {savedFlash && <Badge variant="success" icon="check">Сохранено</Badge>}
          <Btn variant="ghost" onClick={() => nav('/trips')} disabled={saving}>Отмена</Btn>
          <Btn variant="primary" icon={saving ? undefined : 'check'} disabled={saving} onClick={handleSave}>
            {saving ? 'Сохранение…' : 'Сохранить'}
          </Btn>
        </div>

        {/* Identity */}
        <Card title="Идентичность" style={{ marginBottom: 16 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 18, marginBottom: 16 }}>

            {/* Avatar — background fills the circle, no inner component gap */}
            <div
              onMouseEnter={() => setAvatarHover(true)}
              onMouseLeave={() => setAvatarHover(false)}
              onClick={() => avatarInputRef.current?.click()}
              style={{
                position: 'relative',
                width: 76, height: 76,
                borderRadius: '50%',
                overflow: 'hidden',
                cursor: 'pointer',
                flexShrink: 0,
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                color: 'white',
                fontWeight: 700,
                fontSize: 22,
                userSelect: 'none',
                ...avatarBgStyle,
              }}
            >
              {!avatarUrl && avatarInitials}

              {/* Hover / upload overlay */}
              {(avatarHover || uploadingAvatar) && (
                <div style={{
                  position: 'absolute', inset: 0,
                  background: 'rgba(15,23,42,.65)',
                  display: 'flex', flexDirection: 'column',
                  alignItems: 'center', justifyContent: 'center',
                  gap: 4, color: 'white', fontSize: 11, fontWeight: 600,
                }}>
                  {uploadingAvatar
                    ? <div style={{ width: 20, height: 20, border: '2px solid rgba(255,255,255,.4)', borderTopColor: 'white', borderRadius: '50%', animation: 'spin 0.8s linear infinite' }} />
                    : <><Icon name="cam" size={20} /><span>Загрузить</span></>
                  }
                </div>
              )}
            </div>

            <input
              ref={avatarInputRef}
              type="file"
              accept="image/png,image/jpeg,image/gif,image/webp,image/svg+xml"
              style={{ display: 'none' }}
              onChange={e => handleAvatarUpload(e.target.files?.[0])}
            />

            <div style={{ flex: 1 }}>
              <div style={{ fontWeight: 600, fontSize: 15 }}>{fullName || user.email}</div>
              <div className="muted" style={{ fontSize: 12.5, marginTop: 2 }}>Наведи на аватар, чтобы заменить</div>
              {avatarUrl && (
                <div style={{ marginTop: 8 }}>
                  <button
                    onClick={handleRemoveAvatar}
                    style={{ display: 'inline-flex', alignItems: 'center', gap: 5, padding: '4px 10px', background: 'transparent', border: 'none', color: 'var(--danger)', fontSize: 12, fontWeight: 500, cursor: 'pointer', borderRadius: 6, lineHeight: 1 }}
                    onMouseEnter={e => e.currentTarget.style.background = 'var(--danger-soft)'}
                    onMouseLeave={e => e.currentTarget.style.background = 'transparent'}
                  >
                    <Icon name="trash" size={12} />
                    <span>Удалить аватар</span>
                  </button>
                </div>
              )}
            </div>
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
            <div>
              <label style={{ fontSize: 12.5, fontWeight: 500, marginBottom: 4, display: 'block' }}>Отображаемое имя</label>
              <input className="input" value={fullName} onChange={e => setFullName(e.target.value)} />
            </div>
            <div>
              <label style={{ fontSize: 12.5, fontWeight: 500, marginBottom: 4, display: 'block' }}>
                E-mail <Badge variant="quiet" style={{ marginLeft: 4 }}>нередактируемо</Badge>
              </label>
              <input className="input" value={user.email} readOnly style={{ background: 'var(--wash)', color: 'var(--muted)' }} />
            </div>
          </div>
        </Card>

        {/* Preferences */}
        <Card title="Предпочтения" style={{ marginBottom: 16 }}>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>

            {/* Language */}
            <div>
              <label style={{ fontSize: 12.5, fontWeight: 500, marginBottom: 6, display: 'block' }}>Язык интерфейса</label>
              <div style={{ position: 'relative', maxWidth: 260 }}>
                <button
                  onClick={() => setLangOpen(v => !v)}
                  className="select"
                  style={{ width: '100%', textAlign: 'left', display: 'flex', alignItems: 'center', gap: 8, cursor: 'pointer' }}
                >
                  <span>{currentLang.native}</span>
                  <span style={{ flex: 1 }} />
                  <Icon name={langOpen ? 'chevD' : 'chev'} size={13} style={{ color: 'var(--muted)' }} />
                </button>
                {langOpen && (
                  <div style={{
                    position: 'absolute', top: 'calc(100% + 4px)', left: 0, right: 0,
                    background: 'var(--surface)', border: '1px solid var(--line)', borderRadius: 10,
                    boxShadow: 'var(--shadow-pop)', padding: 4, zIndex: 10,
                  }}>
                    {LANGS.map(l => (
                      <button
                        key={l.code}
                        onClick={() => { setLang(l.code); setLangOpen(false); }}
                        style={{
                          width: '100%', padding: '8px 10px', textAlign: 'left',
                          border: 'none', background: l.code === lang ? 'var(--brand-soft)' : 'transparent',
                          color: l.code === lang ? 'var(--brand)' : 'var(--ink)',
                          borderRadius: 6, cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 8, fontSize: 13.5,
                        }}
                      >
                        {l.code === lang && <Icon name="checkSm" size={13} />}
                        <span style={{ width: l.code === lang ? 'auto' : 20 }}>{l.native}</span>
                      </button>
                    ))}
                  </div>
                )}
              </div>
            </div>

            {/* Theme */}
            <div>
              <label style={{ fontSize: 12.5, fontWeight: 500, marginBottom: 6, display: 'block' }}>Тема</label>
              <div className="tweaks__seg">
                <button className={theme === 'light'  ? 'active' : ''} onClick={() => setTheme('light')}>Светлая</button>
                <button className={theme === 'dark'   ? 'active' : ''} onClick={() => setTheme('dark')}>Тёмная</button>
                <button className={theme === 'system' ? 'active' : ''} onClick={() => setTheme('system')}>Как в системе</button>
              </div>
            </div>

          </div>
        </Card>

        {/* Subscription */}
        <SubscriptionCard
          planState={planState}
          plan={plan}
          planLoading={planLoading}
          awaitingWebhook={awaitingWebhook}
          portalLoading={portalLoading}
          locale={locale}
          prices={prices}
          switchingPlan={switchingPlan}
          onUpgrade={openUpgrade}
          onManage={handleManageSubscription}
          onSwitchYearly={handleSwitchToYearly}
        />

        {/* Payment error banner — directly under the subscription section */}
        {errorMsg && (
          <div style={{ marginBottom: 16 }}>
            <Severity level="error" title="Ошибка" action={
              <Btn variant="ghost" size="sm" onClick={() => setErrorMsg(null)}>Закрыть</Btn>
            }>
              {errorMsg}
            </Severity>
          </div>
        )}

        {/* Email notifications */}
        <Card title="E-mail уведомления" style={{ marginBottom: 16 }}>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 0 }}>
            <SettingRow
              label="Приглашения в трипы"
              desc="Когда тебя добавляют в новый трип."
              on={notifyInvites}
              onChange={setNotifyInvites}
            />
            <SettingRow
              label="Обновления трипа"
              desc="Изменения в трипах, где ты участник."
              on={notifyUpdates}
              onChange={setNotifyUpdates}
              last
            />
          </div>
        </Card>

        {/* Support */}
        <Card title="Поддержка" style={{ marginBottom: 16 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 14, flexWrap: 'wrap' }}>
            <div style={{ width: 36, height: 36, borderRadius: 9, background: 'var(--brand-soft)', color: 'var(--brand)', display: 'grid', placeItems: 'center', flexShrink: 0 }}>
              <Icon name="chat" size={16} />
            </div>
            <div style={{ flex: 1, minWidth: 200 }}>
              <div style={{ fontWeight: 600, fontSize: 13.5 }}>Напиши нам</div>
              <div className="muted" style={{ fontSize: 12.5, marginTop: 2 }}>
                <a href="mailto:support@triplanio.com" style={{ color: 'var(--brand)' }}>support@triplanio.com</a>
                {' '}— отвечаем в течение суток.
              </div>
            </div>
            <Btn variant="ghost" icon="send" onClick={() => { window.location.href = 'mailto:support@triplanio.com'; }}>
              Написать
            </Btn>
          </div>
        </Card>

        {/* Legal */}
        <Card title="Правовая информация" style={{ marginBottom: 16 }}>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 0 }}>
            <LegalRow
              icon="shield"
              title="Политика конфиденциальности"
              desc="Как мы обрабатываем твои данные."
              href="/privacy"
            />
            <LegalRow
              icon="file"
              title="Условия использования"
              desc="Правила сервиса, ответственность, оплата."
              href="/terms"
              last
            />
          </div>
        </Card>

        {/* Session */}
        <Card title="Сессия" style={{ marginBottom: 16 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 14, flexWrap: 'wrap' }}>
            <div style={{ flex: 1, minWidth: 200 }}>
              <div style={{ fontWeight: 600, fontSize: 13.5 }}>Выйти из аккаунта</div>
              <div className="muted" style={{ fontSize: 12.5, marginTop: 2 }}>
                Тебе придётся снова войти, чтобы открыть свои трипы. Локальные черновики сохранятся.
              </div>
            </div>
            <Btn variant="ghost" icon="arrow" onClick={logout}>
              Выйти
            </Btn>
          </div>
        </Card>

        {/* Danger zone */}
        <Card title="Опасная зона" style={{ borderColor: 'var(--danger-soft)' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
            <div style={{ flex: 1, minWidth: 200 }}>
              <div style={{ fontWeight: 600 }}>Удалить аккаунт</div>
              <div className="muted" style={{ fontSize: 12.5 }}>
                Безвозвратно. Все твои трипы, документы и история чатов будут удалены.
              </div>
            </div>
            <Btn variant="danger-solid" onClick={handleDeleteAccount} disabled={deletingAccount}>
              Удалить аккаунт
            </Btn>
          </div>

          {deleteState === 'blocked' && (
            <div style={{ marginTop: 14 }}>
              <Severity level="error" title="Сначала отмени подписку">
                У тебя активная Pro-подписка. Удаление аккаунта заблокировано, пока подписка не закрыта.
                <div style={{ marginTop: 8 }}>
                  <Btn variant="ghost" size="sm" icon="external" disabled={portalLoading} onClick={handleManageSubscription}>
                    {portalLoading ? 'Открываем…' : 'Открыть биллинг-портал'}
                  </Btn>
                </div>
              </Severity>
            </div>
          )}

          {deleteState === 'confirm' && (
            <div style={{ marginTop: 14 }}>
              <Severity level="error" title="Подтверди удаление">
                Действие необратимо. Введи слово <b>УДАЛИТЬ</b> для подтверждения.
                <div style={{ marginTop: 8, display: 'flex', gap: 8 }}>
                  <input
                    className="input"
                    placeholder="УДАЛИТЬ"
                    value={deleteInput}
                    onChange={e => setDeleteInput(e.target.value)}
                    style={{ flex: 1 }}
                  />
                  <Btn
                    variant="danger-solid"
                    disabled={deleteInput !== 'УДАЛИТЬ' || deletingAccount}
                    onClick={performDeleteAccount}
                  >
                    {deletingAccount ? 'Удаляем…' : 'Удалить навсегда'}
                  </Btn>
                </div>
              </Severity>
            </div>
          )}
        </Card>

      </main>
    </div>
  );
}
