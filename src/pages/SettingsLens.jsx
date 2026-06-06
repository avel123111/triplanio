/**
 * SettingsLens - trip settings tab inside TripView.
 *
 * Props:
 *   tripId      - string
 *   trip        - trip object
 *   members     - array of trip member rows
 *   myRole      - 'owner' | 'admin' | 'viewer'
 *   isPro       - boolean
 *   queryClient - react-query QueryClient (for invalidation)
 */
import React, { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { supabase } from '@/api/supabaseClient';
import { useAuth } from '@/lib/AuthContext';
import { useI18n } from '@/lib/i18n/I18nContext';
import { TRIP_SHELL_KEY } from '@/lib/trip-data';
import { Icon } from '../design/icons';
import { Avatar, Badge, Btn, Card, Dialog, Field, Toggle } from '../design/index';
import ProLockedDialog from '@/components/common/ProLockedDialog';
import TripProInfoDialog from '@/components/common/TripProInfoDialog';
import TelegramUnlinkDialog from '@/components/common/TelegramUnlinkDialog';
import { useConfirm } from '@/components/common/ConfirmProvider';
import { telegram as tgBrand } from '@/lib/externalBrands';
import CurrencySelect from '@/components/budget/CurrencySelect';

// ─── Feature flags ────────────────────────────────────────────────────────────
// `addon` is the key persisted under trip.details.addons (matches TripView lens ids
// for the gateable lenses: calendar / budget / chat).

// Pro flags MUST match the backend definition (lib/tripAddons.js PRO_ONLY_ADDONS):
// pro = budget, chat, telegram_assistant. calendar is NOT pro. hotels_selection
// is "coming soon" (locked). There is no personal-AI addon. docs is a core lens,
// not an optional addon, so it's not listed here.
const FEATURES = [
  { id: 'cal',    addon: 'calendar',            icon: 'calendar',  color: 'var(--brand)',   labelKey: 'trip.addon_calendar_title', descKey: 'settings.feat_calendar_desc'                              },
  { id: 'budget', addon: 'budget',              icon: 'wallet',    color: 'var(--success)', labelKey: 'settings.feat_budget_title', descKey: 'settings.feat_budget_desc',             pro: true  },
  { id: 'chat',   addon: 'chat',                icon: 'chat',      color: 'var(--ai)',      labelKey: 'chat.group_title',          descKey: 'settings.feat_chat_desc',              pro: true  },
  { id: 'tg',     addon: 'telegram_assistant',  icon: 'telegram',  color: tgBrand.fg,        labelKey: 'settings.feat_tg_title',    descKey: 'settings.feat_tg_desc',                pro: true  },
  { id: 'hotels', addon: 'hotels_selection',    icon: 'vote',      color: 'var(--warm)',    labelKey: 'settings.feat_hotels_title', descKey: 'settings.feat_hotels_desc',           locked: true },
];

// Hotel-voting / collaborative hotel-selection is hidden from the UI for now
// (feature parked). Flip to `true` to bring back the "Совместный выбор отелей"
// addon row and the "Аппруверы голосования за отели" card. The logic, i18n keys
// and the `hotels_selection` addon are intentionally left intact behind this gate.
const SHOW_HOTEL_VOTING = false;

// Default OFF unless explicitly enabled (addons[key] === true). New trips start
// with every optional/pro feature off - they never auto-enable for anyone.
function featuresFromTrip(trip) {
  const addons = trip?.details?.addons || {};
  const state = {};
  for (const f of FEATURES) state[f.id] = f.locked ? false : (addons[f.addon] === true);
  return state;
}

// ─── FeatureRow ───────────────────────────────────────────────────────────────

function FeatureRow({ feat, on, onChange, hasPro, last }) {
  const { t } = useI18n();
  const locked = feat.pro && !hasPro;
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 14, padding: '14px 0', borderBottom: last ? 'none' : '1px solid var(--line-2)' }}>
      <div style={{
        width: 38, height: 38, borderRadius: 10,
        background: (feat.color || 'var(--muted)') + (on ? '22' : '11'),
        color: feat.color || 'var(--muted)',
        display: 'grid', placeItems: 'center', flexShrink: 0,
        opacity: feat.locked ? 0.4 : 1,
      }}>
        <Icon name={feat.icon} size={17} />
      </div>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ fontWeight: 600, fontSize: 'var(--fs-base)', display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
          {t(feat.labelKey)}
          {feat.pro && !hasPro && <Badge variant="warm" icon="pro">Pro</Badge>}
          {feat.pro &&  hasPro && <Badge variant="success" icon="check">{t('settings.feat_available')}</Badge>}
          {feat.locked && <Badge variant="quiet">{t('trip.addon_coming_soon')}</Badge>}
        </div>
        <div className="muted" style={{ fontSize: 'var(--fs-meta)' }}>{t(feat.descKey)}</div>
      </div>
      {locked ? (
        <Btn variant="ghost" size="sm" icon="lock" onClick={onChange}>{t('settings.feat_enable')}</Btn>
      ) : (
        <Toggle on={on} onChange={onChange} locked={feat.locked} />
      )}
    </div>
  );
}

// ─── TelegramConnectDialog ────────────────────────────────────────────────────
// Real binding flow: telegramStartLink → open deep link → poll telegramGetIntegration
// until a new binding appears (user pressed Start in Telegram).

function TelegramConnectDialog({ tripId, onLinked }) {
  const { t } = useI18n();
  const [stage, setStage] = useState('generating'); // generating | idle | connecting | connected | error
  const [url, setUrl] = useState('');
  const [errText, setErrText] = useState('');
  const [countdown, setCountdown] = useState(600);
  const [copied, setCopied] = useState(false);
  const baselineRef = React.useRef(0);

  // Snapshot current bindings, then generate the one-time deep link on open.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      const { data: cur } = await supabase.functions.invoke('telegramGetIntegration', { body: { tripId } });
      baselineRef.current = cur?.integrations?.length ?? 0;
      const { data, error } = await supabase.functions.invoke('telegramStartLink', { body: { tripId } });
      if (cancelled) return;
      if (error || !data?.url) {
        setErrText(t('settings.tg_link_error'));
        setStage('error');
        return;
      }
      setUrl(data.url);
      setStage('idle');
    })();
    return () => { cancelled = true; };
  }, [tripId]);

  // Countdown while waiting for Start.
  useEffect(() => {
    if (stage !== 'connecting') return;
    const id = setInterval(() => setCountdown(c => Math.max(0, c - 1)), 1000);
    return () => clearInterval(id);
  }, [stage]);

  // Poll for the new binding while waiting.
  useEffect(() => {
    if (stage !== 'connecting') return;
    const id = setInterval(async () => {
      const { data } = await supabase.functions.invoke('telegramGetIntegration', { body: { tripId } });
      if ((data?.integrations?.length ?? 0) > baselineRef.current) {
        clearInterval(id);
        onLinked?.();
        setStage('connected');
      }
    }, 3000);
    return () => clearInterval(id);
  }, [stage, tripId, onLinked]);

  const openBot = () => {
    window.open(url, '_blank', 'noopener,noreferrer');
    setCountdown(600);
    setStage('connecting');
  };
  const checkNow = async () => {
    const { data } = await supabase.functions.invoke('telegramGetIntegration', { body: { tripId } });
    if ((data?.integrations?.length ?? 0) > baselineRef.current) { onLinked?.(); setStage('connected'); }
  };
  const copyLink = () => { navigator.clipboard?.writeText(url); setCopied(true); setTimeout(() => setCopied(false), 2000); };
  const mmss = `${String(Math.floor(countdown / 60)).padStart(2, '0')}:${String(countdown % 60).padStart(2, '0')}`;

  return (
    <Dialog title={t('telegram.connect_title')} icon="telegram" size=""
      foot={<Btn variant="ghost" onClick={() => window.__closeModal?.()}>{t('common.close')}</Btn>}>
      <div className="muted" style={{ fontSize: 'var(--fs-base)', lineHeight: 1.55, marginBottom: 16 }}>
        {t('settings.tg_connect_desc')}
      </div>

      {stage === 'generating' && (
        <div style={{ padding: '22px 18px', textAlign: 'center', background: 'var(--wash)', border: '1px solid var(--line)', borderRadius: 12 }}>
          <div style={{ width: 44, height: 44, margin: '0 auto 12px', borderRadius: 12, background: tgBrand.bg, color: tgBrand.fg, display: 'grid', placeItems: 'center' }}>
            <Icon name="telegram" size={20} />
          </div>
          <div style={{ fontWeight: 600, fontSize: 'var(--fs-base)', marginBottom: 6 }}>
            {t('settings.tg_generating')}
            <span className="ai-dots" style={{ marginLeft: 6 }}><span /><span /><span /></span>
          </div>
          <div className="muted" style={{ fontSize: 'var(--fs-meta)', lineHeight: 1.5 }}>{t('settings.tg_creating')}</div>
        </div>
      )}

      {stage === 'error' && (
        <div style={{ padding: 14, background: 'var(--danger-soft)', borderRadius: 12, fontSize: 'var(--fs-base)', lineHeight: 1.5 }}>
          {errText}
        </div>
      )}

      {stage === 'idle' && (
        <>
          <div style={{ display: 'flex', alignItems: 'center', gap: 12, padding: 14, background: 'var(--wash)', border: '1px solid var(--line)', borderRadius: 12, marginBottom: 16 }}>
            <div style={{ width: 36, height: 36, borderRadius: 9, background: tgBrand.bg, color: tgBrand.fg, display: 'grid', placeItems: 'center', flexShrink: 0 }}>
              <Icon name="telegram" size={17} />
            </div>
            <div style={{ flex: 1 }}>
              <div style={{ fontWeight: 600, fontSize: 'var(--fs-base)' }}>{t('telegram.not_connected_title')}</div>
              <div className="muted" style={{ fontSize: 'var(--fs-micro)' }}>{t('settings.tg_for_trip')}</div>
            </div>
            <Badge variant="quiet">{t('settings.tg_not_connected_badge')}</Badge>
          </div>

          <div style={{ marginBottom: 16 }}>
            <div className="eyebrow" style={{ marginBottom: 6 }}>{t('telegram.link_label')}</div>
            <div style={{ display: 'flex', gap: 6 }}>
              <input className="input mono" value={url} readOnly style={{ flex: 1, fontSize: 'var(--fs-meta)' }} />
              <Btn variant="ghost" icon="copy" onClick={copyLink}>{copied ? '✓' : t('settings.tg_copy')}</Btn>
            </div>
          </div>

          <div style={{ fontSize: 'var(--fs-base)', lineHeight: 1.55, marginBottom: 16 }}>
            {t('settings.tg_press_below')}
          </div>

          <Btn variant="primary" icon="telegram" block onClick={openBot}>
            {t('telegram.open_bot')}
          </Btn>
          <div className="muted" style={{ fontSize: 'var(--fs-micro)', marginTop: 14, lineHeight: 1.5, textAlign: 'center' }}>
            {t('settings.tg_after_start')}
          </div>
        </>
      )}

      {stage === 'connecting' && (
        <>
          <div style={{ display: 'flex', alignItems: 'center', gap: 12, padding: 14, background: tgBrand.bgSoft, border: `1px solid ${tgBrand.border}`, borderRadius: 12, marginBottom: 16 }}>
            <div style={{ width: 36, height: 36, borderRadius: 9, background: tgBrand.bg, color: tgBrand.fg, display: 'grid', placeItems: 'center', flexShrink: 0 }}>
              <Icon name="telegram" size={17} />
            </div>
            <div style={{ flex: 1 }}>
              <div style={{ fontWeight: 600, fontSize: 'var(--fs-base)' }}>{t('settings.tg_waiting')}</div>
              <div className="muted" style={{ fontSize: 'var(--fs-micro)' }}>
                <span className="ai-dots" style={{ marginRight: 6 }}><span /><span /><span /></span>
                {t('settings.tg_link_valid')} <span className="num">{mmss}</span>
              </div>
            </div>
          </div>

          <div style={{ display: 'flex', flexDirection: 'column', gap: 10, padding: 14, background: 'var(--wash)', border: '1px solid var(--line)', borderRadius: 12, marginBottom: 14, fontSize: 'var(--fs-meta)', lineHeight: 1.55 }}>
            <div style={{ display: 'flex', gap: 10 }}>
              <div style={{ width: 20, height: 20, borderRadius: 999, background: 'var(--brand)', color: '#fff', fontSize: 'var(--fs-micro)', fontWeight: 700, display: 'grid', placeItems: 'center', flexShrink: 0 }}>1</div>
              <div>{t('settings.tg_step1_pre')} <strong>«Start»</strong>.</div>
            </div>
            <div style={{ display: 'flex', gap: 10 }}>
              <div style={{ width: 20, height: 20, borderRadius: 999, background: 'var(--brand)', color: '#fff', fontSize: 'var(--fs-micro)', fontWeight: 700, display: 'grid', placeItems: 'center', flexShrink: 0 }}>2</div>
              <div>{t('settings.tg_step2')}</div>
            </div>
          </div>

          <div style={{ display: 'flex', gap: 8 }}>
            <Btn variant="ghost" icon="telegram" onClick={() => window.open(url, '_blank', 'noopener,noreferrer')}>{t('settings.tg_open_again')}</Btn>
            <div style={{ flex: 1 }} />
            <Btn variant="primary" icon="check" onClick={checkNow}>{t('settings.tg_pressed_start')}</Btn>
          </div>
        </>
      )}

      {stage === 'connected' && (
        <>
          <div style={{ display: 'flex', alignItems: 'center', gap: 12, padding: 14, background: 'var(--success-soft)', border: '1px solid color-mix(in oklab, var(--success) 25%, transparent)', borderRadius: 12, marginBottom: 14 }}>
            <div style={{ width: 36, height: 36, borderRadius: 9, background: 'color-mix(in oklab, var(--success) 22%, transparent)', color: 'var(--success)', display: 'grid', placeItems: 'center', flexShrink: 0 }}>
              <Icon name="check" size={17} />
            </div>
            <div style={{ flex: 1 }}>
              <div style={{ fontWeight: 600, fontSize: 'var(--fs-base)' }}>{t('settings.tg_linked')}</div>
              <div className="muted" style={{ fontSize: 'var(--fs-micro)' }}>{t('settings.tg_just_now')}</div>
            </div>
            <Badge variant="success" icon="check">{t('settings.tg_active')}</Badge>
          </div>
          <div className="muted" style={{ fontSize: 'var(--fs-meta)', lineHeight: 1.55, marginBottom: 14 }}>
            {t('settings.tg_connected_desc')}
          </div>
          <Btn variant="primary" icon="check" block onClick={() => window.__closeModal?.()}>{t('view.edit_mode_done')}</Btn>
        </>
      )}
    </Dialog>
  );
}

// ─── TelegramSection ──────────────────────────────────────────────────────────
// Lists all Telegram bindings of the trip (many chats per trip). Real API:
// telegramGetIntegration / telegramSetActive / telegramDisconnect.
// The remove flow uses the shared TelegramUnlinkDialog (same modal as the
// account-level "Подключённые аккаунты" section - single source of truth).

function TelegramSection({ tripId }) {
  const { t } = useI18n();
  const [accounts, setAccounts] = useState(null); // null = loading

  const load = React.useCallback(async () => {
    const { data, error } = await supabase.functions.invoke('telegramGetIntegration', { body: { tripId } });
    setAccounts(error ? [] : (data?.integrations ?? []));
  }, [tripId]);

  useEffect(() => { load(); }, [load]);

  const displayName = (a) =>
    a.telegram_first_name || (a.telegram_username ? `@${a.telegram_username}` : t('telegram.unknown_user'));
  const handle = (a) => (a.telegram_username ? `@${a.telegram_username}` : '');

  const toggle = async (a) => {
    setAccounts(list => list.map(x => x.id === a.id ? { ...x, is_active: !x.is_active } : x)); // optimistic
    const { error } = await supabase.functions.invoke('telegramSetActive', {
      body: { tripId, integrationId: a.id, isActive: !a.is_active },
    });
    if (error) load();
  };

  const doRemove = async (a) => {
    setAccounts(list => list.filter(x => x.id !== a.id)); // optimistic
    const { error } = await supabase.functions.invoke('telegramDisconnect', {
      body: { tripId, integrationId: a.id },
    });
    if (error) load();
  };
  const remove = (a) => window.__openModal?.(
    <TelegramUnlinkDialog handle={handle(a) || displayName(a)} onConfirm={() => doRemove(a)} />
  );

  const openConnect = () => window.__openModal?.(<TelegramConnectDialog tripId={tripId} onLinked={load} />);

  if (accounts === null) {
    return <div className="muted" style={{ fontSize: 'var(--fs-base)', padding: 8 }}>{t('common.loading')}</div>;
  }

  if (accounts.length === 0) {
    return (
      <div style={{ padding: 20, background: 'var(--wash)', borderRadius: 12, textAlign: 'center' }}>
        <div style={{ width: 48, height: 48, margin: '0 auto 10px', borderRadius: 12, background: tgBrand.bg, color: tgBrand.fg, display: 'grid', placeItems: 'center' }}>
          <Icon name="telegram" size={22} />
        </div>
        <div style={{ fontWeight: 600, marginBottom: 4 }}>{t('telegram.not_connected_title')}</div>
        <div className="muted" style={{ fontSize: 'var(--fs-meta)', lineHeight: 1.5, marginBottom: 12 }}>
          {t('settings.tg_section_empty_desc')}
        </div>
        <Btn variant="primary" icon="telegram" onClick={openConnect}>
          {t('telegram.connect_title')}
        </Btn>
      </div>
    );
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
      {accounts.map(a => (
        <div key={a.id} style={{ display: 'flex', alignItems: 'center', gap: 12, padding: 12, border: '1px solid var(--line)', borderRadius: 10, background: 'var(--surface)' }}>
          <div style={{ width: 36, height: 36, borderRadius: 9, background: tgBrand.bg, color: tgBrand.fg, display: 'grid', placeItems: 'center', flexShrink: 0 }}>
            <Icon name="telegram" size={17} />
          </div>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ fontWeight: 600, fontSize: 'var(--fs-base)' }}>{displayName(a)}</div>
            {handle(a) && <div className="muted mono" style={{ fontSize: 'var(--fs-micro)' }}>{handle(a)}</div>}
          </div>
          <Toggle on={!!a.is_active} onChange={() => toggle(a)} />
          <Btn variant="quiet" size="sm" icon="trash" onClick={() => remove(a)} />
        </div>
      ))}
      <Btn variant="ghost" icon="plus" onClick={openConnect}>
        {t('telegram.connect_another')}
      </Btn>
    </div>
  );
}

// ─── ApproverRow ──────────────────────────────────────────────────────────────

function ApproverRow({ member, locked }) {
  const { t } = useI18n();
  const [on, setOn] = useState(false);
  const name = member.user_full_name || member.invite_email || '-';
  const roleLabel = member.role === 'owner' ? t('members.role_owner') : member.role === 'admin' ? t('trips.role_admin') : t('trips.role_viewer');

  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
      <Avatar name={name} size="sm" />
      <div style={{ flex: 1 }}>
        <div style={{ fontSize: 'var(--fs-base)', fontWeight: 500 }}>{name}</div>
        <div className="muted" style={{ fontSize: 'var(--fs-micro)' }}>{roleLabel}</div>
      </div>
      {locked
        ? <span className="muted" style={{ fontSize: 'var(--fs-meta)' }}>{t('settings.approver_by_role')}</span>
        : <Toggle on={on} onChange={() => setOn(v => !v)} />}
    </div>
  );
}

// ─── SettingsLens (main export) ───────────────────────────────────────────────

export default function SettingsLens({ tripId, trip, members = [], myRole, isPro, queryClient }) {
  const { t } = useI18n();
  const confirm = useConfirm();
  const { user } = useAuth();
  const nav = useNavigate();

  const [title,   setTitle]   = useState(trip?.title        || '');
  const [currency, setCurrency] = useState(trip?.details?.main_currency || trip?.main_currency || 'EUR');
  const [saving,  setSaving]  = useState(false);
  const [saveMsg, setSaveMsg] = useState('');

  const hasPro = isPro; // trip-level Pro (owner sub OR is_pro_trip), passed from TripView
  const isOwner = myRole === 'owner';
  const [features, setFeatures] = useState(() => featuresFromTrip(trip));
  // Trip-level display toggles (default ON when the flag is absent).
  const [bookingWarnings, setBookingWarnings] = useState(() => trip?.details?.display?.booking_warnings !== false);
  const [chatWidget, setChatWidget] = useState(() => trip?.details?.display?.chat_widget !== false);
  const [proLocked, setProLocked] = useState({ open: false, feature: '' });
  const [tripProInfo, setTripProInfo] = useState({ open: false, feature: '' });
  const openUpgrade = () => nav(`/pro?tripId=${tripId}&hidePerTrip=1`);

  // Seed local state when the trip first loads or when switching to a different
  // trip. Keyed on trip.id (NOT the trip object): react-query hands back a fresh
  // object on every background refetch / window-focus, and depending on the whole
  // object would wipe the user's in-progress title edit right before they save it.
  useEffect(() => {
    if (trip?.title)        setTitle(trip.title);
    if (trip?.details?.main_currency || trip?.main_currency) setCurrency(trip.details?.main_currency || trip.main_currency || 'EUR');
    setFeatures(featuresFromTrip(trip));
    setBookingWarnings(trip?.details?.display?.booking_warnings !== false);
    setChatWidget(trip?.details?.display?.chat_widget !== false);
  }, [trip?.id]);

  // Trip-level display toggle. Persisted under details.display via the edge
  // function (trips RLS is owner-only). Architecture note: `display` is an
  // extensible bag - adding another visibility flag later is just another key.
  async function toggleBookingWarnings() {
    const next = !bookingWarnings;
    setBookingWarnings(next); // optimistic
    const { data, error } = await supabase.functions.invoke('updateTripSettings', {
      body: { tripId, display: { booking_warnings: next } },
    });
    if (error || !data?.ok) {
      setBookingWarnings(!next); // revert
      alert(t('settings.save_error', { message: error?.message || data?.code || t('members.error_generic') }));
      return;
    }
    queryClient?.invalidateQueries({ queryKey: TRIP_SHELL_KEY(tripId) });
  }

  // Trip-level toggle for the floating chat widget (the dock button shown on
  // every trip page). Persisted under details.display.chat_widget, same path as
  // booking_warnings. Independent of the per-user nothing - it's a trip setting.
  // NOTE: the actual widget is ALSO gated by the `chat` addon in TripView, so
  // turning the addon off hides the widget regardless of this flag.
  async function toggleChatWidget() {
    const next = !chatWidget;
    setChatWidget(next); // optimistic
    const { data, error } = await supabase.functions.invoke('updateTripSettings', {
      body: { tripId, display: { chat_widget: next } },
    });
    if (error || !data?.ok) {
      setChatWidget(!next); // revert
      alert(t('settings.save_error', { message: error?.message || data?.code || t('members.error_generic') }));
      return;
    }
    queryClient?.invalidateQueries({ queryKey: TRIP_SHELL_KEY(tripId) });
  }

  // Save basic settings
  async function saveSettings() {
    if (!title.trim()) return;
    setSaving(true);
    const prevCurrency = trip?.details?.main_currency || trip?.main_currency || 'EUR';
    // trips RLS is owner-only → write via edge function so admins can save too.
    const { data, error } = await supabase.functions.invoke('updateTripSettings', {
      body: { tripId, fields: { title: title.trim() }, main_currency: currency },
    });
    // Main currency changed → existing FX overrides were defined against the OLD
    // main currency and are now meaningless. Reset them (trip_budgets is participant-RLS).
    if (!error && data?.ok && currency !== prevCurrency) {
      await supabase.from('trip_budgets').update({ currency, fx_overrides: {} }).eq('trip_id', tripId);
    }
    setSaving(false);
    if (error || !data?.ok) { setSaveMsg(t('settings.save_error2', { message: error?.message || data?.code || t('members.error_generic') })); return; }
    // Optimistically patch the shell cache so the header/title updates instantly,
    // then invalidate to reconcile with the server.
    queryClient?.setQueryData(TRIP_SHELL_KEY(tripId), (old) =>
      old?.trip ? { ...old, trip: { ...old.trip, title: title.trim(), details: { ...(old.trip.details || {}), main_currency: currency } } } : old);
    queryClient?.invalidateQueries({ queryKey: TRIP_SHELL_KEY(tripId) });
    queryClient?.invalidateQueries({ queryKey: ['trip-content', tripId] });
    setSaveMsg(t('settings.saved'));
    setTimeout(() => setSaveMsg(''), 2000);
  }

  // Toggle feature → persist to trip.details.addons, then invalidate shell query.
  async function toggleFeature(id, pro) {
    const feat = FEATURES.find(f => f.id === id);
    if (feat?.locked) return;
    if (pro && !hasPro) {
      // Trip is not Pro. Only the owner can upgrade it → owner sees the upgrade
      // path; a non-owner (admin) is told to ask the owner instead of being sent
      // to checkout (their payment wouldn't unlock THIS trip).
      if (isOwner) setProLocked({ open: true, feature: feat ? t(feat.labelKey) : '' });
      else setTripProInfo({ open: true, feature: feat ? t(feat.labelKey) : '' });
      return;
    }
    const newVal = !features[id];
    const prevAddons = trip?.details?.addons || {};
    const nextAddons = { ...prevAddons, [feat.addon]: newVal };
    setFeatures(s => ({ ...s, [id]: newVal }));  // optimistic (settings screen)
    // Patch the shell cache optimistically too, so the side-menu lenses and the
    // chat widget (which read trip.details.addons from the shell query, not from
    // this component's local state) flip instantly instead of after the
    // getTripDetails round-trip lands (was a multi-second lag).
    const patchAddons = (addons) => queryClient?.setQueryData(TRIP_SHELL_KEY(tripId), (old) =>
      old?.trip ? { ...old, trip: { ...old.trip, details: { ...(old.trip.details || {}), addons } } } : old);
    patchAddons(nextAddons);
    // trips RLS is owner-only → write via edge function (owner+admin, pro-gated).
    const { data, error } = await supabase.functions.invoke('updateTripSettings', {
      body: { tripId, addons: nextAddons },
    });
    if (error || !data?.ok) {
      setFeatures(s => ({ ...s, [id]: !newVal }));  // revert
      patchAddons(prevAddons);                       // revert cache
      if (data?.code === 'PRO_REQUIRED') {
        if (isOwner) setProLocked({ open: true, feature: feat ? t(feat.labelKey) : '' });
        else setTripProInfo({ open: true, feature: feat ? t(feat.labelKey) : '' });
      } else {
        alert(t('settings.save_error', { message: error?.message || data?.code || t('members.error_generic') }));
      }
      return;
    }
    queryClient?.invalidateQueries({ queryKey: TRIP_SHELL_KEY(tripId) });
  }

  // Leave trip
  async function leaveTrip() {
    if (!(await confirm({ title: t('settings.leave_confirm'), variant: 'destructive' }))) return;
    const myMember = members.find(m => m.user_id === user?.id && m.status === 'active');
    if (!myMember) { alert(t('settings.leave_not_found')); return; }
    // Only leave (navigate away) once the backend actually removed the row.
    // removeTripMember now returns a non-2xx with the reason on failure, so we
    // must read the response - navigating on a silent failure left the user
    // still in the trip ("выход" перебрасывал на /trips, но не выходил).
    const { data, error } = await supabase.functions.invoke('removeTripMember', {
      body: { member_id: myMember.id },
    });
    if (error || !data?.ok) {
      let msg = error?.message || t('settings.leave_error');
      try { const body = await error?.context?.json?.(); if (body?.error) msg = body.error; } catch { /* ignore */ }
      alert(t('settings.save_error2', { message: msg }));
      return;
    }
    nav('/trips');
  }

  // Delete trip (owner only)
  async function deleteTrip() {
    if (!(await confirm({ title: t('settings.delete_confirm1'), variant: 'destructive' }))) return;
    if (!(await confirm({ title: t('settings.delete_confirm2'), variant: 'destructive' }))) return;
    const { error } = await supabase.from('trips').delete().eq('id', tripId);
    if (error) { alert(t('settings.save_error2', { message: error.message })); return; }
    nav('/trips');
  }

  const approvers    = members.filter(m => ['owner', 'admin'].includes(m.role) && m.status === 'active');
  const viewerMems   = members.filter(m => m.role === 'viewer'  && m.status === 'active');

  return (
    <div style={{ maxWidth: 720 }}>
      {/* Basic settings */}
      <Card title={t('settings.section_basic')} style={{ marginBottom: 16 }}>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
          <Field label={t('trip.title_label')}>
            <input className="input" value={title} onChange={e => setTitle(e.target.value)} />
          </Field>
          <Field label={t('settings.main_currency_label')}>
            <div style={{ display: 'flex', gap: 10, alignItems: 'flex-start' }}>
              <CurrencySelect value={currency} onChange={setCurrency} width={200} />
              <Btn variant="primary" loading={saving} onClick={saveSettings}>{t('trip.form_save')}</Btn>
              {saveMsg && <span style={{ fontSize: 'var(--fs-meta)', color: 'var(--success)', alignSelf: 'center' }}>{saveMsg}</span>}
            </div>
            <div className="muted" style={{ fontSize: 'var(--fs-micro)', marginTop: 4 }}>{t('settings.main_currency_hint')}</div>
          </Field>

          <hr style={{ border: 'none', borderTop: '1px solid var(--line-2)', margin: 0 }} />

          {/* Warnings - section header + per-warning toggles (design: trip-settings.jsx §29).
              `display` in trip.details is an extensible bag, so future warning/display
              toggles slot in as more rows under this same header. */}
          <div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 12 }}>
              <div style={{ width: 38, height: 38, borderRadius: 10, background: 'var(--warning-soft)', color: 'var(--warning)', display: 'grid', placeItems: 'center', flexShrink: 0 }}>
                <Icon name="warning" size={17} />
              </div>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontWeight: 600, fontSize: 'var(--fs-base)' }}>{t('settings.warnings_title')}</div>
                <div className="muted" style={{ fontSize: 'var(--fs-meta)', lineHeight: 1.45 }}>{t('settings.warnings_desc')}</div>
              </div>
            </div>

            <div style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '12px 14px', background: 'var(--wash)', borderRadius: 10 }}>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontSize: 'var(--fs-base)', fontWeight: 500 }}>{t('settings.warn_bookings_title')}</div>
                <div className="muted" style={{ fontSize: 'var(--fs-micro)', lineHeight: 1.45 }}>{t('settings.warn_bookings_desc')}</div>
              </div>
              <Toggle on={bookingWarnings} onChange={toggleBookingWarnings} />
            </div>
          </div>
        </div>
      </Card>

      {/* Feature toggles */}
      <Card title={t('settings.optional_features')} style={{ marginBottom: 16 }}>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 0 }}>
          {(() => {
            const visible = FEATURES.filter(f => SHOW_HOTEL_VOTING || f.addon !== 'hotels_selection');
            return visible.map((f, i) => (
              <FeatureRow key={f.id} feat={f} on={features[f.id]} hasPro={hasPro}
                onChange={() => toggleFeature(f.id, f.pro)} last={i === visible.length - 1} />
            ));
          })()}
        </div>
      </Card>

      {/* Chat widget - trip-level toggle for the floating dock button.
          Only shown when the Group Chat addon is on (the widget can't exist
          without it). Hidden entirely otherwise. */}
      {features.chat && (
        <Card title={t('settings.chat_widget_title')} style={{ marginBottom: 16 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 14 }}>
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ fontWeight: 600, fontSize: 'var(--fs-base)' }}>{t('settings.chat_widget_label')}</div>
              <div className="muted" style={{ fontSize: 'var(--fs-meta)', lineHeight: 1.45 }}>
                {t('settings.chat_widget_desc')}
              </div>
            </div>
            <Toggle on={chatWidget} onChange={toggleChatWidget} />
          </div>

          <div style={{ marginTop: 12, padding: '12px 14px', background: 'var(--wash)', borderRadius: 10, display: 'flex', alignItems: 'center', gap: 14 }}>
            <div style={{
              position: 'relative', width: 44, height: 44, borderRadius: 14, flexShrink: 0,
              background: 'linear-gradient(135deg, var(--brand) 0%, var(--brand) 50%, var(--ai) 100%)',
              color: 'white', display: 'grid', placeItems: 'center',
              opacity: chatWidget ? 1 : 0.35, transition: 'opacity .15s ease',
            }}>
              <Icon name="chat" size={20} />
            </div>
            <div className="muted" style={{ fontSize: 'var(--fs-meta)', lineHeight: 1.45 }}>
              {chatWidget
                ? t('settings.chat_widget_on')
                : t('settings.chat_widget_off')}
            </div>
          </div>
        </Card>
      )}

      {/* Telegram - only when the Telegram addon is enabled. */}
      {features.tg && (
        <Card title={t('settings.feat_tg_title')} subtitle={t('settings.feat_tg_desc')} style={{ marginBottom: 16 }}>
          <TelegramSection tripId={tripId} />
        </Card>
      )}

      {/* Approvers — hidden while hotel-voting is parked (see SHOW_HOTEL_VOTING). */}
      {SHOW_HOTEL_VOTING && (
      <Card title={t('settings.approvers_title')} subtitle={t('settings.approvers_desc')} style={{ marginBottom: 16 }}>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          {approvers.map(m => <ApproverRow key={m.id} member={m} locked />)}
          {viewerMems.map(m => <ApproverRow key={m.id} member={m} locked={false} />)}
          {members.length === 0 && (
            <div className="muted" style={{ fontSize: 'var(--fs-base)' }}>{t('settings.members_loading')}</div>
          )}
        </div>
      </Card>
      )}

      {/* Danger zone */}
      <Card title={t('settings.danger_zone')} style={{ borderColor: 'var(--danger-soft)' }}>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          {myRole !== 'owner' && (
            <div style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '10px 0' }}>
              <div style={{ flex: 1 }}>
                <div style={{ fontWeight: 600, fontSize: 'var(--fs-base)' }}>{t('settings.leave_trip')}</div>
                <div className="muted" style={{ fontSize: 'var(--fs-meta)' }}>{t('settings.leave_desc')}</div>
              </div>
              <Btn variant="danger" onClick={leaveTrip}>{t('settings.leave_btn')}</Btn>
            </div>
          )}
          {myRole === 'owner' && (
            <>
              <div style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '10px 0' }}>
                <div style={{ flex: 1 }}>
                  <div style={{ fontWeight: 600, fontSize: 'var(--fs-base)' }}>{t('settings.leave_trip')}</div>
                  <div className="muted" style={{ fontSize: 'var(--fs-meta)' }}>{t('settings.leave_owner_blocked')}</div>
                </div>
                <Btn variant="danger" disabled>{t('settings.leave_btn')}</Btn>
              </div>
              <hr style={{ border: 'none', borderTop: '1px solid var(--line-2)' }} />
              <div style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '10px 0' }}>
                <div style={{ flex: 1 }}>
                  <div style={{ fontWeight: 600, fontSize: 'var(--fs-base)' }}>{t('settings.delete_trip')}</div>
                  <div className="muted" style={{ fontSize: 'var(--fs-meta)' }}>{t('settings.delete_desc')}</div>
                </div>
                <Btn variant="danger-solid" onClick={deleteTrip}>{t('settings.delete_trip')}</Btn>
              </div>
            </>
          )}
        </div>
      </Card>

      <ProLockedDialog
        open={proLocked.open}
        feature={proLocked.feature}
        onOpenChange={(o) => setProLocked(s => ({ ...s, open: o }))}
        onUpgrade={openUpgrade}
      />

      <TripProInfoDialog
        open={tripProInfo.open}
        feature={tripProInfo.feature}
        onOpenChange={(o) => setTripProInfo(s => ({ ...s, open: o }))}
      />
    </div>
  );
}
