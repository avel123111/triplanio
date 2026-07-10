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
import { TRIP_SHELL_KEY, writeRows } from '@/lib/trip-data';
import { displayName } from '@/lib/displayName';
import { invalidateActiveTripsLimit } from '@/hooks/useActiveTripsLimit';
import { Icon } from '../design/icons';
import { Avatar, Badge, Btn, Card, Dialog, Field, Severity, Toggle, useToast, CurrencyCombobox } from '../design/index';
import { useUserProfiles } from '@/lib/useUserProfiles';
import ProUpsellModal from '@/components/common/ProUpsellModal';
import TelegramUnlinkDialog from '@/components/common/TelegramUnlinkDialog';
import { useConfirm } from '@/components/common/ConfirmProvider';
import { telegram as tgBrand } from '@/lib/externalBrands';
import TripCoverPicker from '@/components/trips/TripCoverPicker';
import { collectDocPaths, removeTripFiles } from '@/lib/storageCleanup';
import { DEFAULT_GRADIENT_ID } from '@/lib/trip-gradients';

// ─── Feature flags ────────────────────────────────────────────────────────────
// `addon` is the key persisted under trip.details.addons (matches TripView lens ids
// for the gateable lenses: budget / chat).

// Pro flags MUST match the backend definition (lib/tripAddons.js PRO_ONLY_ADDONS):
// pro = budget, chat, telegram_assistant. hotels_selection is "coming soon"
// (locked). There is no personal-AI addon. docs and calendar are core lenses
// (always visible), not optional addons, so they're not listed here.
const FEATURES = [
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

// ─── FeatureCard ──────────────────────────────────────────────────────────────

// Addon widget card (Lumo DS §D1 `.addon-card`). Icon + switch on top, title +
// description below, optional upgrade CTA in the foot. The accent colour is
// passed through the `--ac` custom property.
function FeatureCard({ feat, on, onChange, hasPro, busy }) {
  const { t } = useI18n();
  const proLocked = feat.pro && !hasPro;
  const cls = 'addon-card'
    + (on ? ' addon-card--on' : '')
    + (feat.locked ? ' addon-card--locked' : '');
  return (
    <div className={cls} style={{ '--ac': feat.color || 'var(--brand)' }}>
      <div className="addon-card__top">
        <div className="addon-card__ic"><Icon name={feat.icon} size={20} /></div>
        {feat.locked
          ? <Badge variant="quiet">{t('trip.addon_coming_soon')}</Badge>
          : proLocked
            ? <Badge variant="pro" icon="pro">PRO</Badge>
            : (
              <div className="addon-card__status">
                {feat.pro && hasPro && <Badge variant="success" icon="check">{t('settings.feat_available')}</Badge>}
                <Toggle on={on} busy={busy} onChange={onChange} />
              </div>
            )}
      </div>
      <div className="addon-card__title">
        {t(feat.labelKey)}
      </div>
      <div className="addon-card__desc">{t(feat.descKey)}</div>
      {proLocked && !feat.locked && (
        <div className="addon-card__foot">
          <Btn variant="soft" size="sm" icon="lock" onClick={onChange} block>{t('settings.feat_enable')}</Btn>
        </div>
      )}
    </div>
  );
}

// ─── TelegramConnectDialog ────────────────────────────────────────────────────
// Real binding flow: telegramStartLink → open deep link → poll telegramGetIntegration
// until a new binding appears (user pressed Start in Telegram).

function TelegramConnectDialog({ tripId, onLinked, open, onOpenChange }) {
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

  const closeConnect = () => onOpenChange?.(false);
  return (
    <Dialog title={t('telegram.connect_title')} icon="telegram" size=""
      open={open} onOpenChange={onOpenChange}
      foot={<Btn variant="ghost" onClick={closeConnect}>{t('common.close')}</Btn>}>
      <div className="muted t-body" style={{ marginBottom: 16 }}>
        {t('settings.tg_connect_desc')}
      </div>

      {stage === 'generating' && (
        <div style={{ padding: '22px 18px', textAlign: 'center', background: 'var(--wash)', border: '1px solid var(--line)', borderRadius: 12 }}>
          <div style={{ width: 44, height: 44, margin: '0 auto 12px', borderRadius: 12, background: tgBrand.bg, color: tgBrand.fg, display: 'grid', placeItems: 'center' }}>
            <Icon name="telegram" size={20} />
          </div>
          <div className="t-ui" style={{ marginBottom: 6 }}>
            {t('settings.tg_generating')}
            <span className="ai-dots" style={{ marginLeft: 6 }}><span /><span /><span /></span>
          </div>
          <div className="muted t-meta">{t('settings.tg_creating')}</div>
        </div>
      )}

      {stage === 'error' && (
        <div className="t-body" style={{ padding: 14, background: 'var(--danger-soft)', borderRadius: 12 }}>
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
              <div className="t-ui">{t('telegram.not_connected_title')}</div>
              <div className="muted t-meta">{t('settings.tg_for_trip')}</div>
            </div>
            <Badge variant="quiet">{t('settings.tg_not_connected_badge')}</Badge>
          </div>

          <div style={{ marginBottom: 16 }}>
            <div className="eyebrow" style={{ marginBottom: 6 }}>{t('telegram.link_label')}</div>
            <div style={{ display: 'flex', gap: 6 }}>
              <input className="input mono" value={url} readOnly style={{ flex: 1 }} />
              <Btn variant="ghost" icon="copy" onClick={copyLink}>{copied ? '✓' : t('settings.tg_copy')}</Btn>
            </div>
          </div>

          <div className="t-body" style={{ marginBottom: 16 }}>
            {t('settings.tg_press_below')}
          </div>

          <Btn variant="primary" icon="telegram" block onClick={openBot}>
            {t('telegram.open_bot')}
          </Btn>
          <div className="muted t-meta" style={{ marginTop: 14, textAlign: 'center' }}>
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
              <div className="t-ui">{t('settings.tg_waiting')}</div>
              <div className="muted t-meta">
                <span className="ai-dots" style={{ marginRight: 6 }}><span /><span /><span /></span>
                {t('settings.tg_link_valid')} <span className="num">{mmss}</span>
              </div>
            </div>
          </div>

          <div className="t-meta" style={{ display: 'flex', flexDirection: 'column', gap: 10, padding: 14, background: 'var(--wash)', border: '1px solid var(--line)', borderRadius: 12, marginBottom: 14 }}>
            <div style={{ display: 'flex', gap: 10 }}>
              <div className="t-meta" style={{ width: 20, height: 20, borderRadius: 999, background: 'var(--brand)', color: '#fff', display: 'grid', placeItems: 'center', flexShrink: 0 }}>1</div>
              <div>{t('settings.tg_step1_pre')} <strong>«Start»</strong>.</div>
            </div>
            <div style={{ display: 'flex', gap: 10 }}>
              <div className="t-meta" style={{ width: 20, height: 20, borderRadius: 999, background: 'var(--brand)', color: '#fff', display: 'grid', placeItems: 'center', flexShrink: 0 }}>2</div>
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
              <div className="t-ui">{t('settings.tg_linked')}</div>
              <div className="muted t-meta">{t('settings.tg_just_now')}</div>
            </div>
            <Badge variant="success" icon="check">{t('settings.tg_active')}</Badge>
          </div>
          <div className="muted t-meta" style={{ marginBottom: 14 }}>
            {t('settings.tg_connected_desc')}
          </div>
          <Btn variant="primary" icon="check" block onClick={closeConnect}>{t('view.edit_mode_done')}</Btn>
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
  const { toast } = useToast();
  const [accounts, setAccounts] = useState(null); // null = loading
  const [connectOpen, setConnectOpen] = useState(false);
  const [unlinkState, setUnlinkState] = useState(null); // null | { account }
  const [busyId, setBusyId] = useState(null); // integration id with an in-flight toggle/disconnect

  const load = React.useCallback(async () => {
    const { data, error } = await supabase.functions.invoke('telegramGetIntegration', { body: { tripId } });
    setAccounts(error ? [] : (data?.integrations ?? []));
  }, [tripId]);

  useEffect(() => { load(); }, [load]);

  const displayName = (a) =>
    a.telegram_first_name || (a.telegram_username ? `@${a.telegram_username}` : t('telegram.unknown_user'));
  const handle = (a) => (a.telegram_username ? `@${a.telegram_username}` : '');

  // Not optimistic: an optimistic flip here misleads (the bot keeps/stops
  // notifying based on the server state). Show a spinner on the row and only
  // reflect the new state once the edge call confirms it.
  const toggle = async (a) => {
    if (busyId) return;
    setBusyId(a.id);
    const { error } = await supabase.functions.invoke('telegramSetActive', {
      body: { tripId, integrationId: a.id, isActive: !a.is_active },
    });
    if (error) toast({ description: t('settings.save_error', { message: error?.message || t('members.error_generic') }), variant: 'destructive' });
    else setAccounts(list => list.map(x => x.id === a.id ? { ...x, is_active: !x.is_active } : x));
    setBusyId(null);
  };

  const doRemove = async (a) => {
    setBusyId(a.id);
    const { error } = await supabase.functions.invoke('telegramDisconnect', {
      body: { tripId, integrationId: a.id },
    });
    if (error) toast({ description: t('settings.save_error', { message: error?.message || t('members.error_generic') }), variant: 'destructive' });
    else setAccounts(list => list.filter(x => x.id !== a.id));
    setBusyId(null);
  };
  const remove = (a) => setUnlinkState({ account: a });
  const openConnect = () => setConnectOpen(true);

  if (accounts === null) {
    return <div className="muted t-body" style={{ padding: 8 }}>{t('common.loading')}</div>;
  }

  if (accounts.length === 0) {
    return (
      <div style={{ padding: 20, background: 'var(--wash)', borderRadius: 12, textAlign: 'center' }}>
        <div style={{ width: 48, height: 48, margin: '0 auto 10px', borderRadius: 12, background: tgBrand.bg, color: tgBrand.fg, display: 'grid', placeItems: 'center' }}>
          <Icon name="telegram" size={22} />
        </div>
        <div className="t-ui" style={{ marginBottom: 4 }}>{t('telegram.not_connected_title')}</div>
        <div className="muted t-meta" style={{ marginBottom: 12 }}>
          {t('settings.tg_section_empty_desc')}
        </div>
        <Btn variant="primary" icon="telegram" onClick={openConnect}>
          {t('telegram.connect_title')}
        </Btn>
        <TelegramConnectDialog open={connectOpen} onOpenChange={setConnectOpen} tripId={tripId} onLinked={load} />
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
            <div className="t-ui">{displayName(a)}</div>
            {handle(a) && <div className="muted mono t-mono">{handle(a)}</div>}
          </div>
          <Toggle on={!!a.is_active} busy={busyId === a.id} onChange={() => toggle(a)} />
          <Btn variant="quiet" size="sm" icon="trash" loading={busyId === a.id} onClick={() => remove(a)} />
        </div>
      ))}
      <Btn variant="ghost" icon="plus" onClick={openConnect}>
        {t('telegram.connect_another')}
      </Btn>
      <TelegramConnectDialog open={connectOpen} onOpenChange={setConnectOpen} tripId={tripId} onLinked={load} />
      {unlinkState && (
        <TelegramUnlinkDialog
          open={true}
          onOpenChange={(o) => { if (!o) setUnlinkState(null); }}
          handle={handle(unlinkState.account) || displayName(unlinkState.account)}
          onConfirm={() => doRemove(unlinkState.account)}
        />
      )}
    </div>
  );
}

// ─── ApproverRow ──────────────────────────────────────────────────────────────

function ApproverRow({ member, profile, locked }) {
  const { t } = useI18n();
  const [on, setOn] = useState(false);
  const isDeleted = !!profile?.is_deleted;
  const name = isDeleted ? t('common.deleted_user') : displayName(member.invite_email || profile?.email, profile?.full_name || member.user_full_name);
  const roleLabel = member.role === 'owner' ? t('members.role_owner') : member.role === 'admin' ? t('trips.role_admin') : t('trips.role_viewer');

  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
      <Avatar name={name} photo={profile?.avatar_url || ''} deleted={isDeleted} size="sm" />
      <div style={{ flex: 1 }}>
        <div className="t-ui">{name}</div>
        <div className="muted t-meta">{roleLabel}</div>
      </div>
      {locked
        ? <span className="muted t-meta">{t('settings.approver_by_role')}</span>
        : <Toggle on={on} onChange={() => setOn(v => !v)} />}
    </div>
  );
}

// ─── SettingsLens (main export) ───────────────────────────────────────────────

export default function SettingsLens({ tripId, trip, members = [], myRole, isPro, isProTrip, proResolved = true, queryClient }) {
  const memberProfiles = useUserProfiles((members || []).map(m => m.user_id), tripId);
  const { t } = useI18n();
  const confirm = useConfirm();
  const { user } = useAuth();
  const nav = useNavigate();

  const [title,   setTitle]   = useState(trip?.title        || '');
  const [description, setDescription] = useState(trip?.description || '');
  const [notes,   setNotes]   = useState(trip?.notes        || '');
  const [coverImageUrl, setCoverImageUrl] = useState(trip?.cover_image_url || '');
  const [coverGradient, setCoverGradient] = useState(trip?.cover_gradient || '');
  const [currency, setCurrency] = useState(trip?.details?.main_currency || trip?.main_currency || 'EUR');
  const [saving,  setSaving]  = useState(false);
  // Which display/feature toggle is mid-flight (key string or feature id) — drives
  // the in-knob spinner and blocks re-entry. Toggles persist before they flip
  // (no optimism), so this is the only "in progress" signal the user gets.
  const [busyToggle, setBusyToggle] = useState(null);
  const { toast } = useToast();

  const hasPro = isPro; // trip-level Pro (owner sub OR is_pro_trip), passed from TripView
  const isOwner = myRole === 'owner';
  // Viewers get Settings in read-only mode: identity fields muted, management
  // cards hidden, only "Leave trip" stays active (TRIP-137). NOTE: this is a UI
  // guard only — server-side write protection is TRIP-136 (RLS), not this.
  const readOnly = myRole === 'viewer';
  const [features, setFeatures] = useState(() => featuresFromTrip(trip));
  // Trip-level display toggles (default ON when the flag is absent).
  const [bookingWarnings, setBookingWarnings] = useState(() => trip?.details?.display?.booking_warnings !== false);
  const [chatWidget, setChatWidget] = useState(() => trip?.details?.display?.chat_widget !== false);
  const [upsell, setUpsell] = useState({ open: false, mode: 'upgrade', feature: '' });
  // Owner upgrade from Settings shows the SAME 3 offers as the sidebar / AI-block
  // (per-trip + monthly + yearly). No hidePerTrip here: Pro.jsx already hides the
  // per-trip offer for non-owners (tripOwner check), so the flag only created an
  // owner-vs-owner inconsistency between Settings and the sidebar (TRIP-63 №2).
  const openUpgrade = () => nav(`/pro?tripId=${tripId}`);

  // Seed local state when the trip first loads or when switching to a different
  // trip. Keyed on trip.id (NOT the trip object): react-query hands back a fresh
  // object on every background refetch / window-focus, and depending on the whole
  // object would wipe the user's in-progress title edit right before they save it.
  useEffect(() => {
    if (trip?.title)        setTitle(trip.title);
    setDescription(trip?.description || '');
    setNotes(trip?.notes || '');
    setCoverImageUrl(trip?.cover_image_url || '');
    setCoverGradient(trip?.cover_gradient || '');
    if (trip?.details?.main_currency || trip?.main_currency) setCurrency(trip.details?.main_currency || trip.main_currency || 'EUR');
    setFeatures(featuresFromTrip(trip));
    setBookingWarnings(trip?.details?.display?.booking_warnings !== false);
    setChatWidget(trip?.details?.display?.chat_widget !== false);
  }, [trip?.id]);

  // Dirty state for the identity block (title / description / currency / cover /
  // notes). Toggles below auto-save on click, so the Save button only governs
  // these manually-edited fields and stays disabled until something changes.
  const persistedCurrency = trip?.details?.main_currency || trip?.main_currency || 'EUR';
  const dirty =
    title.trim()    !== (trip?.title || '') ||
    description     !== (trip?.description || '') ||
    notes           !== (trip?.notes || '') ||
    coverImageUrl   !== (trip?.cover_image_url || '') ||
    coverGradient   !== (trip?.cover_gradient || '') ||
    currency        !== persistedCurrency;

  // Trip-level display toggle. Persisted under details.display via the edge
  // function (trips RLS is owner-only). Architecture note: `display` is an
  // extensible bag - adding another visibility flag later is just another key.
  async function toggleBookingWarnings() {
    if (busyToggle) return;
    const next = !bookingWarnings;
    setBusyToggle('booking_warnings');
    const { data, error } = await supabase.functions.invoke('updateTripSettings', {
      body: { tripId, display: { booking_warnings: next } },
    });
    if (error || !data?.ok) {
      toast({ description: t('settings.save_error', { message: error?.message || data?.code || t('members.error_generic') }), variant: 'destructive' });
    } else {
      setBookingWarnings(next); // reflect only after the server confirms
      queryClient?.invalidateQueries({ queryKey: TRIP_SHELL_KEY(tripId) });
    }
    setBusyToggle(null);
  }

  // Trip-level toggle for the floating chat widget (the dock button shown on
  // every trip page). Persisted under details.display.chat_widget, same path as
  // booking_warnings. Independent of the per-user nothing - it's a trip setting.
  // NOTE: the actual widget is ALSO gated by the `chat` addon in TripView, so
  // turning the addon off hides the widget regardless of this flag.
  async function toggleChatWidget() {
    if (busyToggle) return;
    const next = !chatWidget;
    setBusyToggle('chat_widget');
    const { data, error } = await supabase.functions.invoke('updateTripSettings', {
      body: { tripId, display: { chat_widget: next } },
    });
    if (error || !data?.ok) {
      toast({ description: t('settings.save_error', { message: error?.message || data?.code || t('members.error_generic') }), variant: 'destructive' });
    } else {
      setChatWidget(next); // reflect only after the server confirms
      queryClient?.invalidateQueries({ queryKey: TRIP_SHELL_KEY(tripId) });
    }
    setBusyToggle(null);
  }

  // Save identity settings: title, description, notes, cover (gradient/image)
  // and main currency. All these columns are whitelisted by updateTripSettings
  // (title/description/cover_image_url/cover_gradient/notes); currency lives
  // under details.main_currency.
  async function saveSettings() {
    if (!title.trim()) return;
    setSaving(true);
    const prevCurrency = trip?.details?.main_currency || trip?.main_currency || 'EUR';
    const prevCoverUrl = trip?.cover_image_url || '';
    const fields = {
      title: title.trim(),
      description: description.trim() || null,
      notes: notes || null,
      cover_image_url: coverImageUrl || null,
      // Invariant: keep a built-in gradient even when a photo is set (photo just
      // renders on top). Never persist null → no legacy/procedural fallback.
      cover_gradient: coverGradient || DEFAULT_GRADIENT_ID,
    };
    // trips RLS is owner-only → write via edge function so admins can save too.
    const { data, error } = await supabase.functions.invoke('updateTripSettings', {
      body: { tripId, fields, main_currency: currency },
    });
    // Main currency changed → existing FX overrides were defined against the OLD
    // main currency and are now meaningless. Reset them (trip_budgets is participant-RLS).
    if (!error && data?.ok && currency !== prevCurrency) {
      try {
        // Secondary to the edge save above; expectRow:false because a trip may
        // have no trip_budgets row yet (nothing to reset). Was a bare await that
        // swallowed both real errors and the silent 0-row case.
        await writeRows(
          supabase.from('trip_budgets').update({ currency, fx_overrides: {} }).eq('trip_id', tripId),
          { expectRow: false },
        );
      } catch {
        toast({ description: t('common.write_failed'), variant: 'destructive' });
      }
    }
    setSaving(false);
    if (error || !data?.ok) { toast({ description: t('settings.save_error2', { message: error?.message || data?.code || t('members.error_generic') }), variant: 'destructive' }); return; }
    // Cover replaced/cleared → the previously persisted object is now orphaned.
    // Delete it best-effort, comparing object KEYS (signed-URL tokens differ but
    // the key is stable) so we never delete the key the new cover still uses (TRIP-117).
    const prevPath = collectDocPaths([], prevCoverUrl)[0];
    const newPath = collectDocPaths([], fields.cover_image_url)[0];
    if (prevPath && prevPath !== newPath) removeTripFiles([prevPath]);
    // Optimistically patch the shell cache so the header title + cover update
    // instantly, then invalidate to reconcile with the server.
    queryClient?.setQueryData(TRIP_SHELL_KEY(tripId), (old) =>
      old?.trip ? { ...old, trip: { ...old.trip,
        title: fields.title,
        description: fields.description,
        notes: fields.notes,
        cover_image_url: fields.cover_image_url,
        cover_gradient: fields.cover_gradient,
        details: { ...(old.trip.details || {}), main_currency: currency } } } : old);
    queryClient?.invalidateQueries({ queryKey: TRIP_SHELL_KEY(tripId) });
    queryClient?.invalidateQueries({ queryKey: ['trip-content', tripId] });
    queryClient?.invalidateQueries({ queryKey: ['trips'] }); // trips list shows title/cover/description
    toast({ description: t('settings.saved'), variant: 'success' });
  }

  // Toggle feature → persist to trip.details.addons, then invalidate shell query.
  async function toggleFeature(id, pro) {
    const feat = FEATURES.find(f => f.id === id);
    if (feat?.locked) return;
    if (busyToggle) return;
    if (pro && !hasPro) {
      // Trip is not Pro. Only the owner can upgrade it → owner sees the upgrade
      // path; a non-owner (admin) is told to ask the owner instead of being sent
      // to checkout (their payment wouldn't unlock THIS trip).
      setUpsell({ open: true, mode: isOwner ? 'upgrade' : 'info', feature: feat ? t(feat.labelKey) : '' });
      return;
    }
    const newVal = !features[id];
    const prevAddons = trip?.details?.addons || {};
    const nextAddons = { ...prevAddons, [feat.addon]: newVal };
    setBusyToggle(id);
    // No optimism: a feature flip drives gating (chat widget, lenses) — flipping
    // before the server confirms misleads. The toggle shows a spinner instead.
    const patchAddons = (addons) => queryClient?.setQueryData(TRIP_SHELL_KEY(tripId), (old) =>
      old?.trip ? { ...old, trip: { ...old.trip, details: { ...(old.trip.details || {}), addons } } } : old);
    // trips RLS is owner-only → write via edge function (owner+admin, pro-gated).
    const { data, error } = await supabase.functions.invoke('updateTripSettings', {
      body: { tripId, addons: nextAddons },
    });
    if (error || !data?.ok) {
      if (data?.code === 'PRO_REQUIRED') {
        setUpsell({ open: true, mode: isOwner ? 'upgrade' : 'info', feature: feat ? t(feat.labelKey) : '' });
      } else {
        toast({ description: t('settings.save_error', { message: error?.message || data?.code || t('members.error_generic') }), variant: 'destructive' });
      }
      setBusyToggle(null);
      return;
    }
    setFeatures(s => ({ ...s, [id]: newVal }));  // reflect only after server confirms
    patchAddons(nextAddons);                      // sync the shell cache (lenses/widget)
    queryClient?.invalidateQueries({ queryKey: TRIP_SHELL_KEY(tripId) });
    setBusyToggle(null);
  }

  // Leave trip — runs through the async confirm so the confirm button shows a
  // spinner while removeTripMember is in flight (the edge call is not instant).
  async function leaveTrip() {
    const myMember = members.find(m => m.user_id === user?.id && m.status === 'active');
    if (!myMember) { toast({ description: t('settings.leave_not_found'), variant: 'destructive' }); return; }
    await confirm({
      title: t('settings.leave_confirm'),
      description: t('confirm.leave_trip.body'),
      variant: 'destructive',
      onConfirm: async () => {
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
          toast({ description: t('settings.save_error2', { message: msg }), variant: 'destructive' });
          return;
        }
        nav('/trips');
      },
    });
  }

  // Delete trip (owner only). Routed through the deleteTrip edge function so
  // Telegram teardown + Storage purge run before the irreversible DELETE.
  async function deleteTrip() {
    if (!(await confirm({ title: t('settings.delete_confirm1'), variant: 'destructive' }))) return;

    // The actual irreversible delete; attached to the LAST confirm shown so its
    // button carries the spinner while deleteTrip (Telegram teardown + Storage
    // purge + DELETE) runs.
    const runDelete = async () => {
      const { data, error } = await supabase.functions.invoke('deleteTrip', { body: { tripId } });
      if (error || !data?.ok) {
        let msg = data?.error || error?.message || '';
        try { const body = await error?.context?.json?.(); if (body?.error) msg = body.error; } catch { /* ignore */ }
        toast({ description: t('settings.save_error2', { message: msg }), variant: 'destructive' });
        return;
      }
      // Deleting an owned trip lowers the active-trip count — drop the gate cache
      // so the planner can't read a stale count and flash the limit guard.
      invalidateActiveTripsLimit(queryClient);
      nav('/trips');
    };

    // 3rd confirm — ONLY for a trip carrying a one-time Pro purchase
    // (is_pro_trip), which burns on delete. NOT shown when Pro comes from an
    // account-level subscription (that survives the trip being deleted), so we
    // key off is_pro_trip, not the merged isPro flag.
    if (isProTrip) {
      if (!(await confirm({ title: t('settings.delete_confirm2'), variant: 'destructive' }))) return;
      await confirm({
        title: t('confirm.delete_pro_trip.title'),
        description: t('confirm.delete_pro_trip.body'),
        variant: 'destructive',
        onConfirm: runDelete,
      });
    } else {
      await confirm({ title: t('settings.delete_confirm2'), variant: 'destructive', onConfirm: runDelete });
    }
  }

  const approvers    = members.filter(m => ['owner', 'admin'].includes(m.role) && m.status === 'active');
  const viewerMems   = members.filter(m => m.role === 'viewer'  && m.status === 'active');

  return (
    <div className="settings-lens">
      {/* Viewer read-only notice — only this banner + the Leave button are
          interactive for a viewer (TRIP-137). */}
      {readOnly && (
        <Severity level="info" title={t('settings.readonly_banner_title')}>
          {t('settings.readonly_banner_desc')}
        </Severity>
      )}
      {/* ── Identity: cover + name / description / currency / notes ──────────
          Save here governs only these manually-edited fields; the feature and
          display toggles below auto-save on click. */}
      <Card
        title={t('settings.section_basic')}
        action={readOnly ? null : (
          <div className="settings-save">
            <Btn variant="primary" loading={saving} disabled={!dirty || !title.trim()} onClick={saveSettings}>
              {t('trip.form_save')}
            </Btn>
          </div>
        )}
      >
        {/* Read-only: native fieldset disables inputs/buttons/file input/combobox;
            pointer-events + opacity mute the whole block visually. */}
        <fieldset
          disabled={readOnly}
          style={{ border: 0, margin: 0, padding: 0, minWidth: 0,
            ...(readOnly ? { opacity: 0.65, pointerEvents: 'none' } : {}) }}
        >
        <div className="settings-identity">
          <div className="settings-identity__cover">
            <Field label={t('trip.form_cover')}>
              <TripCoverPicker
                coverImageUrl={coverImageUrl}
                coverGradient={coverGradient}
                tripId={tripId}
                onChange={({ cover_image_url, cover_gradient }) => {
                  setCoverImageUrl(cover_image_url);
                  setCoverGradient(cover_gradient);
                }}
              />
            </Field>
          </div>
          <div className="settings-identity__fields">
            <Field label={t('trip.title_label')}>
              <input className="input" value={title} onChange={e => setTitle(e.target.value)} />
            </Field>
            <Field label={t('trip.description')}>
              <input className="input" value={description} onChange={e => setDescription(e.target.value)} placeholder={t('trip.form_description_placeholder')} />
            </Field>
            <Field label={t('settings.main_currency_label')} sub={t('settings.main_currency_hint')}>
              <CurrencyCombobox value={currency} onChange={setCurrency} />
            </Field>
            <Field label={t('trip.form_notes')}>
              <textarea className="textarea" rows={4} value={notes} onChange={e => setNotes(e.target.value)} placeholder={t('trip.form_notes_placeholder')} />
            </Field>
          </div>
        </div>
        </fieldset>
      </Card>

      {/* Management cards (features, integrations, warnings, approvers) stay
          VISIBLE for a read-only viewer (TRIP-63 №5) but disabled: a native
          <fieldset disabled> switches off every control inside (toggles, inputs,
          file pickers and buttons are all native), and opacity + pointer-events
          mute the block visually — the SAME proven pattern as the identity
          fieldset above. The viewer now SEES the budget addon exists (just can't
          flip it), so the budget-lock modal's "Open settings" CTA is no longer a
          dead end. Only "Leave trip" (Danger zone, OUTSIDE this fieldset) stays
          interactive. flex+gap mirrors the .settings-lens spacing so wrapping the
          cards doesn't collapse the 16px gaps. */}
      <fieldset
        disabled={readOnly}
        style={{ border: 0, margin: 0, padding: 0, minWidth: 0,
          display: 'flex', flexDirection: 'column', gap: 16,
          ...(readOnly ? { opacity: 0.65, pointerEvents: 'none' } : {}) }}
      >
      {/* ── Features: addon widget cards (Lumo DS §D1), full width ──
          The Pro upgrade banner lives INSIDE this panel, above the heading
          (matches the approved prototype). Shown on the same condition as the
          right-menu plate (TripSidebar `showUpgrade`): trip not Pro and Pro
          status resolved (avoids a flash on Pro trips). Gated by owner /
          non-owner, NOT by a specific role: the owner gets the upgrade CTA, any
          non-owner gets the "enabled by owner" button that opens the same info
          modal as the sidebar plate. Card title is rendered manually (via the
          shared .card-h) so the banner can sit above it. Reuses the EXACT
          sidebar-plate elements — .pro-up / .pi / .pt / .pro-up p / .lockmsg —
          so it looks identical to the right-menu plate, just horizontal. */}
      <Card>
        {proResolved && !hasPro && (
          <div className="pro-up pro-up--inline" style={{ marginBottom: 16 }}>
            <Badge variant="pro" icon="pro">PRO</Badge>
            <div className="pu-body">
              <div className="pt">{t('trip_menu.free_trip_title')}</div>
              <p style={{ margin: 0 }}>{t('trip.pro_locked_lenses')}</p>
            </div>
            {isOwner ? (
              <Btn variant="primary" size="sm" iconRight="arrowR" onClick={openUpgrade}>{t('trip_menu.upgrade_trip')}</Btn>
            ) : (
              <button className="lockmsg" onClick={() => setUpsell({ open: true, mode: 'info', feature: '' })}>
                <Icon name="lock" size={14} />
                {t('trip.pro_by_owner')}
              </button>
            )}
          </div>
        )}
        <div className="card-h">
          <div style={{ flex: 1 }}><h3>{t('settings.optional_features')}</h3></div>
        </div>
        <div className="addon-grid">
          {FEATURES
            .filter(f => SHOW_HOTEL_VOTING || f.addon !== 'hotels_selection')
            .map(f => (
              <FeatureCard key={f.id} feat={f} on={features[f.id]} hasPro={hasPro}
                busy={busyToggle === f.id}
                onChange={() => toggleFeature(f.id, f.pro)} />
            ))}
        </div>
      </Card>

      {/* ── Integrations · warnings (2-col → 1-col on mobile) ── */}
      <div className="settings-grid">
        <div className="settings-col">
          {/* Chat widget - trip-level toggle for the floating dock button.
              Only shown when the Group Chat addon is on. */}
          {features.chat && (
            <Card title={t('settings.chat_widget_title')}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 14 }}>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div className="t-ui">{t('settings.chat_widget_label')}</div>
                  <div className="muted t-meta">
                    {t('settings.chat_widget_desc')}
                  </div>
                </div>
                <Toggle on={chatWidget} busy={busyToggle === 'chat_widget'} onChange={toggleChatWidget} />
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
                <div className="muted t-meta">
                  {chatWidget
                    ? t('settings.chat_widget_on')
                    : t('settings.chat_widget_off')}
                </div>
              </div>
            </Card>
          )}

          {/* Warnings / display - extensible bag of trip-level display toggles. */}
          <Card title={t('settings.warnings_title')} subtitle={t('settings.warnings_desc')}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '12px 14px', background: 'var(--wash)', borderRadius: 10 }}>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div className="t-label">{t('settings.warn_bookings_title')}</div>   {/* TRIP-175 инсп.: UI→Label */}
                <div className="muted t-meta">{t('settings.warn_bookings_desc')}</div>
              </div>
              <Toggle on={bookingWarnings} busy={busyToggle === 'booking_warnings'} onChange={toggleBookingWarnings} />
            </div>
          </Card>
        </div>

        <div className="settings-col">
          {/* Telegram - only when the Telegram addon is enabled. */}
          {features.tg && (
            <Card title={t('settings.feat_tg_title')} subtitle={t('settings.feat_tg_desc')}>
              <TelegramSection tripId={tripId} />
            </Card>
          )}

          {/* Approvers — hidden while hotel-voting is parked (see SHOW_HOTEL_VOTING). */}
          {SHOW_HOTEL_VOTING && (
            <Card title={t('settings.approvers_title')} subtitle={t('settings.approvers_desc')}>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                {approvers.map(m => <ApproverRow key={m.id} member={m} profile={memberProfiles[m.user_id]} locked />)}
                {viewerMems.map(m => <ApproverRow key={m.id} member={m} profile={memberProfiles[m.user_id]} locked={false} />)}
                {members.length === 0 && (
                  <div className="muted t-body">{t('settings.members_loading')}</div>
                )}
              </div>
            </Card>
          )}
        </div>
      </div>
      </fieldset>

      {/* ── Danger zone (full width) ── */}
      <Card title={t('settings.danger_zone')} style={{ borderColor: 'var(--danger-soft)' }}>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          {myRole !== 'owner' && (
            <div style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '10px 0' }}>
              <div style={{ flex: 1 }}>
                <div className="t-ui">{t('settings.leave_trip')}</div>
                <div className="muted t-meta">{t('settings.leave_desc')}</div>
              </div>
              <Btn variant="danger" onClick={leaveTrip}>{t('settings.leave_btn')}</Btn>
            </div>
          )}
          {myRole === 'owner' && (
            <>
              <div style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '10px 0' }}>
                <div style={{ flex: 1 }}>
                  <div className="t-ui">{t('settings.leave_trip')}</div>
                  <div className="muted t-meta">{t('settings.leave_owner_blocked')}</div>
                </div>
                <Btn variant="danger" disabled>{t('settings.leave_btn')}</Btn>
              </div>
              <hr style={{ border: 'none', borderTop: '1px solid var(--line-2)' }} />
              <div style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '10px 0' }}>
                <div style={{ flex: 1 }}>
                  <div className="t-ui">{t('settings.delete_trip')}</div>
                  <div className="muted t-meta">{t('settings.delete_desc')}</div>
                </div>
                <Btn variant="danger-solid" onClick={deleteTrip}>{t('settings.delete_trip')}</Btn>
              </div>
            </>
          )}
        </div>
      </Card>

      <ProUpsellModal
        open={upsell.open}
        mode={upsell.mode}
        feature={upsell.feature}
        ownerName={members.find(m => m.user_id === trip?.created_by)?.user_full_name || ''}
        onOpenChange={(o) => setUpsell(s => ({ ...s, open: o }))}
        onUpgrade={openUpgrade}
      />
    </div>
  );
}
