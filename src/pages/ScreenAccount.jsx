import React, { useState, useEffect, useRef } from 'react';
import { useSearchParams, useNavigate } from 'react-router-dom';
import { Icon } from '../design/icons';
import {
  Badge, Btn, Card, Severity, Toggle, ModalHost,
} from '../design/index';
import { useAuth } from '@/lib/AuthContext';
import { useI18n, useI18nFormat } from '@/lib/i18n/I18nContext';
import { useTheme } from '@/lib/ThemeContext';
import { isProActive } from '@/lib/subscription';
import { supabase } from '@/api/supabaseClient';
import HeaderActions from '@/components/HeaderActions';
import TelegramUnlinkDialog from '@/components/common/TelegramUnlinkDialog';
import '../design/app.css';

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
        <div style={{ fontWeight: 500, fontSize: 'var(--fs-base)' }}>{title}</div>
        <div className="muted" style={{ fontSize: 'var(--fs-meta)' }}>{desc}</div>
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
        <div style={{ fontWeight: 500, fontSize: 'var(--fs-base)' }}>{label}</div>
        {desc && <div className="muted" style={{ fontSize: 'var(--fs-meta)' }}>{desc}</div>}
      </div>
      <Toggle on={on} onChange={onChange} />
    </div>
  );
}

function SubscriptionCard({ planState, plan, planLoading, awaitingWebhook, portalLoading, onUpgrade, onManage, locale, prices, switchingPlan, onSwitchYearly }) {
  const { t } = useI18nFormat();
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
      <Card title={t('account.subscription')} style={{ marginBottom: 16 }}>
        <div style={{ height: 60, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
          <div style={{ width: 22, height: 22, border: '2px solid var(--line)', borderTopColor: 'var(--brand)', borderRadius: '50%', animation: 'spin 0.8s linear infinite' }} />
        </div>
      </Card>
    );
  }

  if (planState === 'no-sub') {
    return (
      <Card title={t('account.subscription')} subtitle={t('account.now_free')} className="ai-card" style={{ marginBottom: 16 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 16, flexWrap: 'wrap' }}>
          <div style={{ width: 48, height: 48, borderRadius: 12, background: 'var(--wash)', color: 'var(--muted)', display: 'grid', placeItems: 'center' }}>
            <Icon name="user" size={22} />
          </div>
          <div style={{ flex: 1, minWidth: 180 }}>
            <div style={{ fontWeight: 600, marginBottom: 4 }}>{t('account.free_plan')}</div>
            <div className="muted" style={{ fontSize: 'var(--fs-meta)' }}>{t('account.free_desc')}</div>
          </div>
          <Btn
            variant="primary"
            icon={awaitingWebhook ? undefined : 'pro'}
            disabled={awaitingWebhook}
            onClick={onUpgrade}
          >
            {awaitingWebhook ? t('account.activating_pro') : t('account.go_to_pro')}
          </Btn>
        </div>
      </Card>
    );
  }

  if (planState === 'with-sub') {
    return (
      <Card title={t('account.subscription')} subtitle={t('account.pro_monthly_sub')} style={{ marginBottom: 16 }}>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
          <div style={{ padding: 14, background: 'var(--brand-soft)', borderRadius: 12, display: 'flex', alignItems: 'center', gap: 14, flexWrap: 'wrap' }}>
            <div style={{ width: 44, height: 44, borderRadius: 11, background: 'var(--brand)', color: 'white', display: 'grid', placeItems: 'center' }}>
              <Icon name="pro" size={22} />
            </div>
            <div style={{ flex: 1, minWidth: 200 }}>
              <div style={{ fontWeight: 600 }}>Pro Monthly</div>
              <div className="muted num" style={{ fontSize: 'var(--fs-meta)' }}>
                {(actualMoney || monthlyPrice) ? `${actualMoney || monthlyPrice}${t('account.per_month_short')}` : 'Pro'}
                {plan?.subscriptionEnd && (
                  <> · {t('account.next_charge')} <b style={{ color: 'var(--ink-2)', fontWeight: 600 }}>{fmtDate(plan.subscriptionEnd, locale)}</b></>
                )}
              </div>
            </div>
            {yearlyPrice && (
              <Btn variant="ghost" size="sm" icon="arrow" disabled={switchingPlan} onClick={onSwitchYearly}>
                {switchingPlan ? t('account.switching') : t('account.switch_yearly', { price: yearlyPrice })}
              </Btn>
            )}
            <Btn variant="ghost" size="sm" icon="external" disabled={portalLoading} onClick={onManage}>
              {portalLoading ? t('account.opening') : t('account.billing_portal')}
            </Btn>
          </div>
          <div className="muted" style={{ fontSize: 'var(--fs-meta)' }}>
            {t('account.after_cancel_access')}
          </div>
        </div>
      </Card>
    );
  }

  if (planState === 'annual') {
    return (
      <Card title={t('account.subscription')} subtitle={t('account.pro_yearly_sub')} style={{ marginBottom: 16, borderColor: 'var(--success)' }}>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
          <div style={{ padding: 14, background: 'var(--success-soft)', borderRadius: 12, display: 'flex', alignItems: 'center', gap: 14, flexWrap: 'wrap' }}>
            <div style={{ width: 44, height: 44, borderRadius: 11, background: 'var(--success)', color: 'white', display: 'grid', placeItems: 'center' }}>
              <Icon name="pro" size={22} />
            </div>
            <div style={{ flex: 1, minWidth: 200 }}>
              <div style={{ fontWeight: 600, display: 'flex', alignItems: 'center', gap: 6 }}>
                Pro Yearly <Badge variant="success">{t('account.active')}</Badge>
              </div>
              <div className="muted num" style={{ fontSize: 'var(--fs-meta)' }}>
                {(actualMoney || yearlyPrice) ? `${actualMoney || yearlyPrice}${t('account.per_year_short')}` : 'Pro'}
                {plan?.subscriptionEnd && (
                  <> · {t('account.renews')} <b style={{ color: 'var(--ink-2)', fontWeight: 600 }}>{fmtDate(plan.subscriptionEnd, locale)}</b></>
                )}
                {(actualMonthlyEq || yearlyMonthlyEq()) && ` · ${t('account.equivalent')} ${actualMonthlyEq || yearlyMonthlyEq()}${t('account.per_month_short')}`}
              </div>
            </div>
            <Btn variant="ghost" size="sm" icon="external" disabled={portalLoading} onClick={onManage}>
              {portalLoading ? t('account.opening') : t('account.billing_portal')}
            </Btn>
          </div>
          <div style={{ padding: 12, background: 'var(--wash)', borderRadius: 10, display: 'flex', alignItems: 'center', gap: 10 }}>
            <Icon name="info" size={14} style={{ color: 'var(--muted)' }} />
            <span className="muted" style={{ fontSize: 'var(--fs-meta)' }}>{t('account.yearly_note')}</span>
          </div>
          <div className="muted" style={{ fontSize: 'var(--fs-meta)' }}>
            <button onClick={onManage} style={{ background: 'none', border: 'none', color: 'var(--brand)', cursor: 'pointer', fontSize: 'var(--fs-meta)' }}>
              {t('account.cancel_until_year_end')}
            </button>
          </div>
        </div>
      </Card>
    );
  }

  if (planState === 'cancelled') {
    return (
      <Card title={t('account.subscription')} subtitle={t('account.cancelled_sub')} style={{ marginBottom: 16, borderColor: 'var(--warning-soft)' }}>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
          <div style={{ padding: 14, background: 'var(--warning-soft)', borderRadius: 12, display: 'flex', alignItems: 'center', gap: 14, flexWrap: 'wrap' }}>
            <div style={{ width: 44, height: 44, borderRadius: 11, background: 'var(--warning)', color: 'white', display: 'grid', placeItems: 'center' }}>
              <Icon name="warning" size={22} />
            </div>
            <div style={{ flex: 1, minWidth: 200 }}>
              <div style={{ fontWeight: 600 }}>
                {t('account.pro_cancelled')}{plan?.subscriptionEnd ? t('account.active_until_suffix', { date: fmtDate(plan.subscriptionEnd, locale) }) : ''}
              </div>
              <div className="muted" style={{ fontSize: 'var(--fs-meta)', marginTop: 2 }}>
                {t('account.cancelled_desc')}
              </div>
            </div>
            <Btn variant="primary" size="sm" icon="refresh" disabled={portalLoading} onClick={onManage}>
              {portalLoading ? t('account.opening') : t('account.resume')}
            </Btn>
          </div>
          <div style={{ padding: 12, background: 'var(--wash)', borderRadius: 10, fontSize: 'var(--fs-meta)', color: 'var(--muted)', lineHeight: 1.5 }}>
            {t('account.cancelled_note')}
          </div>
        </div>
      </Card>
    );
  }

  return null;
}

// ─── ConnectedAccountsSection ───────────────────────────────────────────────
// Account-level view of the user's Telegram bindings across ALL trips.
// Data: telegramGetMyIntegrations (one row per binding). Empty / collapsed /
// expanded states match the design. Unlink reuses the shared TelegramUnlinkDialog
// + telegramDisconnect (same modal as Trip settings).

const TG_BLUE = '#0088cc';

function ConnectedAccountsSection() {
  const { t, plural } = useI18nFormat();
  const nav = useNavigate();
  const [items, setItems] = useState(null); // null = loading
  const [open, setOpen] = useState(false);   // collapsed by default

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
  const unlink = (a) => window.__openModal?.(
    <TelegramUnlinkDialog handle={nick(a)} onConfirm={() => doUnlink(a)} />
  );

  if (items === null) {
    return (
      <Card title={t('telegram.account_section_title')} subtitle={t('telegram.account_section_subtitle')} style={{ marginBottom: 16 }}>
        <div className="muted" style={{ fontSize: 'var(--fs-base)', padding: 8 }}>{t('common.loading')}</div>
      </Card>
    );
  }

  // ── Empty state ──
  if (items.length === 0) {
    return (
      <Card title={t('telegram.account_section_title')} subtitle={t('telegram.account_section_subtitle')} style={{ marginBottom: 16 }}>
        <div style={{
          position: 'relative', overflow: 'hidden',
          border: '1px dashed var(--line)', borderRadius: 14,
          background: 'linear-gradient(160deg, color-mix(in srgb, var(--ai) 6%, var(--surface)) 0%, var(--surface) 60%)',
          padding: '28px 24px', textAlign: 'center',
        }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', marginBottom: 16 }}>
            <div style={{ width: 52, height: 52, borderRadius: 14, background: TG_BLUE, color: 'white', display: 'grid', placeItems: 'center', zIndex: 2, border: '2.5px solid var(--surface)', boxShadow: '0 8px 20px -8px ' + TG_BLUE }}>
              <Icon name="telegram" size={24} />
            </div>
            <div style={{ width: 48, height: 48, borderRadius: 13, marginLeft: -12, background: 'linear-gradient(135deg, var(--ai) 0%, #c66ce2 100%)', color: 'white', display: 'grid', placeItems: 'center', zIndex: 1, border: '2.5px solid var(--surface)', boxShadow: '0 8px 20px -8px var(--ai)' }}>
              <Icon name="sparkles" size={21} />
            </div>
          </div>
          <div style={{ fontWeight: 700, fontSize: 'var(--fs-lg)', marginBottom: 8 }}>{t('telegram.account_empty_title')}</div>
          <div className="muted" style={{ fontSize: 'var(--fs-base)', lineHeight: 1.6, maxWidth: 420, margin: '0 auto 18px' }}>
            {t('telegram.account_empty_desc')}
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8, maxWidth: 360, margin: '0 auto 20px', textAlign: 'left' }}>
            {[
              { icon: 'bell', text: t('telegram.account_empty_benefit_reminders') },
              { icon: 'sparkles', text: t('telegram.account_empty_benefit_ai') },
              { icon: 'chat', text: t('telegram.account_empty_benefit_chat') },
            ].map((r, i) => (
              <div key={i} style={{ display: 'flex', alignItems: 'flex-start', gap: 10, fontSize: 'var(--fs-meta)', color: 'var(--ink-2)' }}>
                <span style={{ width: 22, height: 22, borderRadius: 7, background: 'var(--ai-soft)', color: 'var(--ai)', display: 'grid', placeItems: 'center', flexShrink: 0 }}>
                  <Icon name={r.icon} size={12} />
                </span>
                <span style={{ lineHeight: 1.45, paddingTop: 2 }}>{r.text}</span>
              </div>
            ))}
          </div>
          <Btn variant="primary" icon="arrow" onClick={() => nav('/trips')}>{t('telegram.go_to_trips')}</Btn>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8, marginTop: 20, paddingTop: 16, borderTop: '1px solid var(--line-2)', flexWrap: 'wrap' }}>
            <Icon name="telegram" size={14} style={{ color: TG_BLUE }} />
            <span style={{ fontSize: 'var(--fs-micro)', color: 'var(--ink-2)' }}>Telegram</span>
            <span className="muted" style={{ fontSize: 'var(--fs-micro)' }}>{t('telegram.coming_soon')}</span>
          </div>
        </div>
      </Card>
    );
  }

  // ── Connected: expandable Telegram node ──
  const tripCount = new Set(items.map(i => i.trip_id)).size;

  return (
    <Card title={t('telegram.account_section_title')} subtitle={t('telegram.account_section_subtitle')} style={{ marginBottom: 16 }}>
      <div
        onClick={() => setOpen(o => !o)}
        style={{ display: 'flex', alignItems: 'center', gap: 12, padding: 14, border: '1px solid var(--line)', borderRadius: 12, background: 'var(--surface)', cursor: 'pointer' }}
      >
        <div style={{ width: 42, height: 42, borderRadius: 11, background: TG_BLUE + '22', color: TG_BLUE, display: 'grid', placeItems: 'center', flexShrink: 0 }}>
          <Icon name="telegram" size={20} />
        </div>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
            <span style={{ fontWeight: 600, fontSize: 'var(--fs-strong)' }}>Telegram</span>
            <Badge variant="success" icon="check">{t('telegram.connected')}</Badge>
          </div>
          <div className="muted" style={{ fontSize: 'var(--fs-meta)', marginTop: 2 }}>
            {plural(tripCount, 'telegram.tg_trips', { count: tripCount })}
          </div>
        </div>
        <Icon name={open ? 'chevD' : 'chev'} size={15} style={{ color: 'var(--muted)', flexShrink: 0 }} />
      </div>

      {open && (
        <div style={{ marginTop: 12 }}>
          <div className="eyebrow" style={{ marginBottom: 8, paddingLeft: 2 }}>{t('telegram.linked_trips')}</div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            {items.map((a) => (
              <div key={a.id} style={{ display: 'flex', alignItems: 'center', gap: 12, padding: 10, border: '1px solid var(--line)', borderRadius: 10, background: 'var(--surface)' }}>
                <div style={{ width: 38, height: 38, borderRadius: 9, flexShrink: 0, background: 'var(--brand-soft)', color: 'var(--brand)', display: 'grid', placeItems: 'center' }}>
                  <Icon name="map" size={16} />
                </div>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 7, flexWrap: 'wrap' }}>
                    <span style={{ fontWeight: 600, fontSize: 'var(--fs-base)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{a.trip_title}</span>
                    <Badge variant="quiet">{t(`trips.role_${a.role}`)}</Badge>
                  </div>
                  <div className="muted mono" style={{ fontSize: 'var(--fs-micro)', marginTop: 1 }}>{nick(a)}</div>
                </div>
                <Btn variant="ghost" size="sm" icon="arrow" onClick={() => nav(`/trip/${a.trip_id}?lens=settings`)}>{t('telegram.go_to_trip')}</Btn>
                <Btn variant="quiet" size="sm" icon="unlink" onClick={() => unlink(a)} />
              </div>
            ))}
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 12, fontSize: 'var(--fs-micro)', color: 'var(--muted)' }}>
            <Icon name="info" size={13} />
            <span>{t('telegram.account_hint')}</span>
          </div>
        </div>
      )}
    </Card>
  );
}

// ─── Main component ───────────────────────────────────────────────────────────

export default function ScreenAccount() {
  const { user, checkUserAuth, logout } = useAuth();
  const { t } = useI18nFormat();
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
      if (!data?.ok) { setErrorMsg(t('account.err_switch_plan') + (data?.code || t('account.error_title'))); return; }
      await loadPlan();
    } catch (e) {
      console.error('changeSubscriptionPlan error:', e);
      setErrorMsg(t('account.err_switch_plan_generic') + (e.message || String(e)));
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
      // Persist immediately to the users row so the avatar survives a reload
      // WITHOUT needing a separate "Сохранить" click, and refresh the auth
      // context so it shows everywhere (header, members, chat) right away.
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
      // Best-effort storage cleanup (don't fail the action if this part errors).
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
      setErrorMsg(t('account.err_delete') + (e.message || String(e)));
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

      {/* ── APP HEADER - standard pattern (back / brand / crumb / actions) ── */}
      <header className="app-header" style={{ position: 'sticky', top: 0, zIndex: 50 }}>
        <button className="app-header__crumb-back" onClick={() => nav('/trips')} title={t('notif.to_collection')}>
          <Icon name="back" size={14} />
        </button>
        <div className="app-header__brand" onClick={() => nav('/trips')} style={{ cursor: 'pointer' }}>
          <img src="/triplanio-logo.svg" alt="Triplanio" style={{ width: 28, height: 28, borderRadius: 7, flexShrink: 0 }} />
          <span className="app-header__brand-name">Triplanio</span>
        </div>
        <div className="app-header__crumb">
          <span className="app-header__crumb-sep">/</span>
          <span style={{ fontSize: 'var(--fs-base)', fontWeight: 500, color: 'var(--ink-2)' }}>{t('account.title')}</span>
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

        {/* Page title row - Cancel + Save sit here, matching the design */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 22, flexWrap: 'wrap' }}>
          <h1 style={{ flex: 1, marginBottom: 0 }}>
            {t('account.title')}
            {planState === 'with-sub'  && <Badge variant="warm" icon="pro" style={{ marginLeft: 10, verticalAlign: 4, fontSize: 'var(--fs-micro)' }}>{t('account.badge_pro_sub')}</Badge>}
            {planState === 'annual'    && <Badge variant="warm" icon="pro" style={{ marginLeft: 10, verticalAlign: 4, fontSize: 'var(--fs-micro)' }}>{t('account.badge_pro_yearly')}</Badge>}
            {planState === 'cancelled' && <Badge variant="quiet" icon="warning" style={{ marginLeft: 10, verticalAlign: 4, fontSize: 'var(--fs-micro)' }}>{t('account.badge_pro_cancelled')}</Badge>}
          </h1>
          {savedFlash && <Badge variant="success" icon="check">{t('settings.saved')}</Badge>}
          <Btn variant="ghost" onClick={() => nav('/trips')} disabled={saving}>{t('common.cancel')}</Btn>
          <Btn variant="primary" icon={saving ? undefined : 'check'} disabled={saving} onClick={handleSave}>
            {saving ? t('auth.saving') : t('common.save')}
          </Btn>
        </div>

        {/* Identity */}
        <Card title={t('account.identity')} style={{ marginBottom: 16 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 18, marginBottom: 16 }}>

            {/* Avatar - background fills the circle, no inner component gap */}
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
                fontSize: 'var(--fs-h2)',
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
                  gap: 4, color: 'white', fontSize: 'var(--fs-micro)', fontWeight: 600,
                }}>
                  {uploadingAvatar
                    ? <div style={{ width: 20, height: 20, border: '2px solid rgba(255,255,255,.4)', borderTopColor: 'white', borderRadius: '50%', animation: 'spin 0.8s linear infinite' }} />
                    : <><Icon name="cam" size={20} /><span>{t('common.upload')}</span></>
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
              <div style={{ fontWeight: 600, fontSize: 'var(--fs-strong)' }}>{fullName || user.email}</div>
              <div className="muted" style={{ fontSize: 'var(--fs-meta)', marginTop: 2 }}>{t('account.avatar_hint')}</div>
              {avatarUrl && (
                <div style={{ marginTop: 8 }}>
                  <button
                    onClick={handleRemoveAvatar}
                    style={{ display: 'inline-flex', alignItems: 'center', gap: 5, padding: '4px 10px', background: 'transparent', border: 'none', color: 'var(--danger)', fontSize: 'var(--fs-meta)', fontWeight: 500, cursor: 'pointer', borderRadius: 6, lineHeight: 1 }}
                    onMouseEnter={e => e.currentTarget.style.background = 'var(--danger-soft)'}
                    onMouseLeave={e => e.currentTarget.style.background = 'transparent'}
                  >
                    <Icon name="trash" size={12} />
                    <span>{t('account.remove_avatar')}</span>
                  </button>
                </div>
              )}
            </div>
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
            <div>
              <label style={{ fontSize: 'var(--fs-meta)', fontWeight: 500, marginBottom: 4, display: 'block' }}>{t('account.display_name')}</label>
              <input className="input" value={fullName} onChange={e => setFullName(e.target.value)} />
            </div>
            <div>
              <label style={{ fontSize: 'var(--fs-meta)', fontWeight: 500, marginBottom: 4, display: 'block' }}>
                E-mail <Badge variant="quiet" style={{ marginLeft: 4 }}>{t('account.readonly')}</Badge>
              </label>
              <input className="input" value={user.email} readOnly style={{ background: 'var(--wash)', color: 'var(--muted)' }} />
            </div>
          </div>
        </Card>

        {/* Preferences */}
        <Card title={t('account.preferences')} style={{ marginBottom: 16 }}>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>

            {/* Language */}
            <div>
              <label style={{ fontSize: 'var(--fs-meta)', fontWeight: 500, marginBottom: 6, display: 'block' }}>{t('settings.language')}</label>
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
                          borderRadius: 6, cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 8, fontSize: 'var(--fs-base)',
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
              <label style={{ fontSize: 'var(--fs-meta)', fontWeight: 500, marginBottom: 6, display: 'block' }}>{t('settings.theme')}</label>
              <div className="tweaks__seg">
                <button className={theme === 'light'  ? 'active' : ''} onClick={() => setTheme('light')}>{t('settings.theme_light')}</button>
                <button className={theme === 'dark'   ? 'active' : ''} onClick={() => setTheme('dark')}>{t('settings.theme_dark')}</button>
                <button className={theme === 'system' ? 'active' : ''} onClick={() => setTheme('system')}>{t('account.theme_system')}</button>
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

        {/* Payment error banner - directly under the subscription section */}
        {errorMsg && (
          <div style={{ marginBottom: 16 }}>
            <Severity level="error" title={t('account.error_title')} action={
              <Btn variant="ghost" size="sm" onClick={() => setErrorMsg(null)}>{t('common.close')}</Btn>
            }>
              {errorMsg}
            </Severity>
          </div>
        )}

        {/* Email notifications */}
        <Card title={t('account.email_notifs')} style={{ marginBottom: 16 }}>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 0 }}>
            <SettingRow
              label={t('account.notif_invites')}
              desc={t('account.notif_invites_desc')}
              on={notifyInvites}
              onChange={setNotifyInvites}
            />
            <SettingRow
              label={t('account.notif_updates')}
              desc={t('account.notif_updates_desc')}
              on={notifyUpdates}
              onChange={setNotifyUpdates}
              last
            />
          </div>
        </Card>

        {/* Connected accounts (Telegram) */}
        <ConnectedAccountsSection />

        {/* Support */}
        <Card title={t('account.support')} style={{ marginBottom: 16 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 14, flexWrap: 'wrap' }}>
            <div style={{ width: 36, height: 36, borderRadius: 9, background: 'var(--brand-soft)', color: 'var(--brand)', display: 'grid', placeItems: 'center', flexShrink: 0 }}>
              <Icon name="chat" size={16} />
            </div>
            <div style={{ flex: 1, minWidth: 200 }}>
              <div style={{ fontWeight: 600, fontSize: 'var(--fs-base)' }}>{t('account.contact_us')}</div>
              <div className="muted" style={{ fontSize: 'var(--fs-meta)', marginTop: 2 }}>
                <a href="mailto:support@triplanio.com" style={{ color: 'var(--brand)' }}>support@triplanio.com</a>
                {' '}{t('account.support_reply')}
              </div>
            </div>
            <Btn variant="ghost" icon="send" onClick={() => { window.location.href = 'mailto:support@triplanio.com'; }}>
              {t('account.write')}
            </Btn>
          </div>
        </Card>

        {/* Legal */}
        <Card title={t('account.legal')} style={{ marginBottom: 16 }}>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 0 }}>
            <LegalRow
              icon="shield"
              title={t('account.privacy_title')}
              desc={t('account.privacy_desc')}
              href="/privacy"
            />
            <LegalRow
              icon="file"
              title={t('account.terms_title')}
              desc={t('account.terms_desc')}
              href="/terms"
              last
            />
          </div>
        </Card>

        {/* Session */}
        <Card title={t('account.session')} style={{ marginBottom: 16 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 14, flexWrap: 'wrap' }}>
            <div style={{ flex: 1, minWidth: 200 }}>
              <div style={{ fontWeight: 600, fontSize: 'var(--fs-base)' }}>{t('account.logout_title')}</div>
              <div className="muted" style={{ fontSize: 'var(--fs-meta)', marginTop: 2 }}>
                {t('account.logout_desc')}
              </div>
            </div>
            <Btn variant="ghost" icon="arrow" onClick={logout}>
              {t('auth.logout')}
            </Btn>
          </div>
        </Card>

        {/* Danger zone */}
        <Card title={t('settings.danger_zone')} style={{ borderColor: 'var(--danger-soft)' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
            <div style={{ flex: 1, minWidth: 200 }}>
              <div style={{ fontWeight: 600 }}>{t('settings.delete_account')}</div>
              <div className="muted" style={{ fontSize: 'var(--fs-meta)' }}>
                {t('account.delete_desc')}
              </div>
            </div>
            <Btn variant="danger-solid" onClick={handleDeleteAccount} disabled={deletingAccount}>
              {t('settings.delete_account')}
            </Btn>
          </div>

          {deleteState === 'blocked' && (
            <div style={{ marginTop: 14 }}>
              <Severity level="error" title={t('account.cancel_sub_first')}>
                {t('account.delete_blocked_desc')}
                <div style={{ marginTop: 8 }}>
                  <Btn variant="ghost" size="sm" icon="external" disabled={portalLoading} onClick={handleManageSubscription}>
                    {portalLoading ? t('account.opening') : t('account.open_billing_portal')}
                  </Btn>
                </div>
              </Severity>
            </div>
          )}

          {deleteState === 'confirm' && (
            <div style={{ marginTop: 14 }}>
              <Severity level="error" title={t('account.confirm_delete')}>
                {t('account.confirm_delete_desc_1')} <b>{t('account.delete_word')}</b> {t('account.confirm_delete_desc_2')}
                <div style={{ marginTop: 8, display: 'flex', gap: 8 }}>
                  <input
                    className="input"
                    placeholder={t('account.delete_word')}
                    value={deleteInput}
                    onChange={e => setDeleteInput(e.target.value)}
                    style={{ flex: 1 }}
                  />
                  <Btn
                    variant="danger-solid"
                    disabled={deleteInput !== t('account.delete_word') || deletingAccount}
                    onClick={performDeleteAccount}
                  >
                    {deletingAccount ? t('account.deleting') : t('account.delete_forever')}
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
