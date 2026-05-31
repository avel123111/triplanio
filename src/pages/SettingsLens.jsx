/**
 * SettingsLens — trip settings tab inside TripView.
 *
 * Props:
 *   tripId      — string
 *   trip        — trip object
 *   members     — array of trip member rows
 *   myRole      — 'owner' | 'admin' | 'viewer'
 *   isPro       — boolean
 *   queryClient — react-query QueryClient (for invalidation)
 */
import React, { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { supabase } from '@/api/supabaseClient';
import { useAuth } from '@/lib/AuthContext';
import { TRIP_SHELL_KEY } from '@/lib/trip-data';
import { Icon } from '../design/icons';
import { Avatar, Badge, Btn, Card, Dialog, Field, Toggle } from '../design/index';
import ProLockedDialog from '@/components/common/ProLockedDialog';
import TripProInfoDialog from '@/components/common/TripProInfoDialog';
import TelegramUnlinkDialog from '@/components/common/TelegramUnlinkDialog';
import CurrencySelect from '@/components/budget/CurrencySelect';

// ─── Feature flags ────────────────────────────────────────────────────────────
// `addon` is the key persisted under trip.details.addons (matches TripView lens ids
// for the gateable lenses: calendar / budget / chat).

// Pro flags MUST match the backend definition (lib/tripAddons.js PRO_ONLY_ADDONS):
// pro = budget, chat, telegram_assistant. calendar is NOT pro. hotels_selection
// is "coming soon" (locked). There is no personal-AI addon. docs is a core lens,
// not an optional addon, so it's not listed here.
const FEATURES = [
  { id: 'cal',    addon: 'calendar',            icon: 'calendar',  color: 'var(--brand)',   label: 'Календарь',                   desc: 'Те же события на сетке месяца/недели'                              },
  { id: 'budget', addon: 'budget',              icon: 'wallet',    color: 'var(--success)', label: 'Полная разбивка бюджета',     desc: 'Категории, ручные расходы, FX-override\'ы',             pro: true  },
  { id: 'chat',   addon: 'chat',                icon: 'chat',      color: 'var(--ai)',      label: 'Групповой чат',               desc: 'Сообщения, упоминания, @assistant',                     pro: true  },
  { id: 'tg',     addon: 'telegram_assistant',  icon: 'telegram',  color: '#0088cc',        label: 'Telegram-мост',               desc: 'Напоминания в Telegram',                                pro: true  },
  { id: 'hotels', addon: 'hotels_selection',    icon: 'vote',      color: 'var(--warm)',    label: 'Совместный выбор отелей',     desc: 'Голосование среди аппруверов',                          locked: true },
];

// Default OFF unless explicitly enabled (addons[key] === true). New trips start
// with every optional/pro feature off — they never auto-enable for anyone.
function featuresFromTrip(trip) {
  const addons = trip?.details?.addons || {};
  const state = {};
  for (const f of FEATURES) state[f.id] = f.locked ? false : (addons[f.addon] === true);
  return state;
}

// ─── FeatureRow ───────────────────────────────────────────────────────────────

function FeatureRow({ feat, on, onChange, hasPro, last }) {
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
        <div style={{ fontWeight: 600, fontSize: 13.5, display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
          {feat.label}
          {feat.pro && !hasPro && <Badge variant="warm" icon="pro">Pro</Badge>}
          {feat.pro &&  hasPro && <Badge variant="success" icon="check">Доступно</Badge>}
          {feat.locked && <Badge variant="quiet">Скоро</Badge>}
        </div>
        <div className="muted" style={{ fontSize: 12 }}>{feat.desc}</div>
      </div>
      {locked ? (
        <Btn variant="ghost" size="sm" icon="lock" onClick={onChange}>Подключить</Btn>
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
        setErrText('Не удалось создать ссылку. Попробуйте позже.');
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
    <Dialog title="Привязать Telegram" icon="telegram" size=""
      foot={<Btn variant="ghost" onClick={() => window.__closeModal?.()}>Закрыть</Btn>}>
      <div className="muted" style={{ fontSize: 13, lineHeight: 1.55, marginBottom: 16 }}>
        Привяжите Telegram, чтобы получать напоминания об отелях, переездах и активностях для этого трипа.
      </div>

      {stage === 'generating' && (
        <div style={{ padding: '22px 18px', textAlign: 'center', background: 'var(--wash)', border: '1px solid var(--line)', borderRadius: 12 }}>
          <div style={{ width: 44, height: 44, margin: '0 auto 12px', borderRadius: 12, background: '#0088cc22', color: '#0088cc', display: 'grid', placeItems: 'center' }}>
            <Icon name="telegram" size={20} />
          </div>
          <div style={{ fontWeight: 600, fontSize: 13.5, marginBottom: 6 }}>
            Генерируем персональную ссылку
            <span className="ai-dots" style={{ marginLeft: 6 }}><span /><span /><span /></span>
          </div>
          <div className="muted" style={{ fontSize: 12, lineHeight: 1.5 }}>Создаём уникальную ссылку на Triplanio-бота для этого трипа.</div>
        </div>
      )}

      {stage === 'error' && (
        <div style={{ padding: 14, background: 'var(--danger-soft)', borderRadius: 12, fontSize: 13, lineHeight: 1.5 }}>
          {errText}
        </div>
      )}

      {stage === 'idle' && (
        <>
          <div style={{ display: 'flex', alignItems: 'center', gap: 12, padding: 14, background: 'var(--wash)', border: '1px solid var(--line)', borderRadius: 12, marginBottom: 16 }}>
            <div style={{ width: 36, height: 36, borderRadius: 9, background: '#0088cc22', color: '#0088cc', display: 'grid', placeItems: 'center', flexShrink: 0 }}>
              <Icon name="telegram" size={17} />
            </div>
            <div style={{ flex: 1 }}>
              <div style={{ fontWeight: 600, fontSize: 13.5 }}>Telegram не подключён</div>
              <div className="muted" style={{ fontSize: 11.5 }}>Для этого трипа</div>
            </div>
            <Badge variant="quiet">Не подключён</Badge>
          </div>

          <div style={{ marginBottom: 16 }}>
            <div className="eyebrow" style={{ marginBottom: 6 }}>Персональная ссылка · действует 10 минут</div>
            <div style={{ display: 'flex', gap: 6 }}>
              <input className="input mono" value={url} readOnly style={{ flex: 1, fontSize: 12 }} />
              <Btn variant="ghost" icon="copy" onClick={copyLink}>{copied ? '✓' : 'Копия'}</Btn>
            </div>
          </div>

          <div style={{ fontSize: 13, lineHeight: 1.55, marginBottom: 16 }}>
            Нажмите кнопку ниже, чтобы открыть бота по этой ссылке и нажать «Старт».
          </div>

          <Btn variant="primary" icon="telegram" block onClick={openBot}>
            Открыть Triplanio-бот в Telegram
          </Btn>
          <div className="muted" style={{ fontSize: 11.5, marginTop: 14, lineHeight: 1.5, textAlign: 'center' }}>
            После «Старта» в Telegram вернитесь сюда — панель обновится автоматически.
          </div>
        </>
      )}

      {stage === 'connecting' && (
        <>
          <div style={{ display: 'flex', alignItems: 'center', gap: 12, padding: 14, background: '#0088cc11', border: '1px solid #0088cc33', borderRadius: 12, marginBottom: 16 }}>
            <div style={{ width: 36, height: 36, borderRadius: 9, background: '#0088cc22', color: '#0088cc', display: 'grid', placeItems: 'center', flexShrink: 0 }}>
              <Icon name="telegram" size={17} />
            </div>
            <div style={{ flex: 1 }}>
              <div style={{ fontWeight: 600, fontSize: 13.5 }}>Ожидаем «Старт» в Telegram</div>
              <div className="muted" style={{ fontSize: 11.5 }}>
                <span className="ai-dots" style={{ marginRight: 6 }}><span /><span /><span /></span>
                Ссылка действительна ещё <span className="num">{mmss}</span>
              </div>
            </div>
          </div>

          <div style={{ display: 'flex', flexDirection: 'column', gap: 10, padding: 14, background: 'var(--wash)', border: '1px solid var(--line)', borderRadius: 12, marginBottom: 14, fontSize: 12.5, lineHeight: 1.55 }}>
            <div style={{ display: 'flex', gap: 10 }}>
              <div style={{ width: 20, height: 20, borderRadius: 999, background: 'var(--brand)', color: '#fff', fontSize: 11, fontWeight: 700, display: 'grid', placeItems: 'center', flexShrink: 0 }}>1</div>
              <div>В открывшемся чате нажмите <strong>«Start»</strong>.</div>
            </div>
            <div style={{ display: 'flex', gap: 10 }}>
              <div style={{ width: 20, height: 20, borderRadius: 999, background: 'var(--brand)', color: '#fff', fontSize: 11, fontWeight: 700, display: 'grid', placeItems: 'center', flexShrink: 0 }}>2</div>
              <div>Вернитесь на эту вкладку — статус обновится автоматически.</div>
            </div>
          </div>

          <div style={{ display: 'flex', gap: 8 }}>
            <Btn variant="ghost" icon="telegram" onClick={() => window.open(url, '_blank', 'noopener,noreferrer')}>Открыть бот ещё раз</Btn>
            <div style={{ flex: 1 }} />
            <Btn variant="primary" icon="check" onClick={checkNow}>Я нажал Start</Btn>
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
              <div style={{ fontWeight: 600, fontSize: 13.5 }}>Telegram привязан</div>
              <div className="muted" style={{ fontSize: 11.5 }}>только что</div>
            </div>
            <Badge variant="success" icon="check">Активен</Badge>
          </div>
          <div className="muted" style={{ fontSize: 12.5, lineHeight: 1.55, marginBottom: 14 }}>
            Уведомления для этого трипа теперь будут приходить в Telegram.
          </div>
          <Btn variant="primary" icon="check" block onClick={() => window.__closeModal?.()}>Готово</Btn>
        </>
      )}
    </Dialog>
  );
}

// ─── TelegramSection ──────────────────────────────────────────────────────────
// Lists all Telegram bindings of the trip (many chats per trip). Real API:
// telegramGetIntegration / telegramSetActive / telegramDisconnect.
// The remove flow uses the shared TelegramUnlinkDialog (same modal as the
// account-level "Подключённые аккаунты" section — single source of truth).

function TelegramSection({ tripId }) {
  const [accounts, setAccounts] = useState(null); // null = loading

  const load = React.useCallback(async () => {
    const { data, error } = await supabase.functions.invoke('telegramGetIntegration', { body: { tripId } });
    setAccounts(error ? [] : (data?.integrations ?? []));
  }, [tripId]);

  useEffect(() => { load(); }, [load]);

  const displayName = (a) =>
    a.telegram_first_name || (a.telegram_username ? `@${a.telegram_username}` : 'Пользователь Telegram');
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
    return <div className="muted" style={{ fontSize: 13, padding: 8 }}>Загрузка…</div>;
  }

  if (accounts.length === 0) {
    return (
      <div style={{ padding: 20, background: 'var(--wash)', borderRadius: 12, textAlign: 'center' }}>
        <div style={{ width: 48, height: 48, margin: '0 auto 10px', borderRadius: 12, background: '#0088cc22', color: '#0088cc', display: 'grid', placeItems: 'center' }}>
          <Icon name="telegram" size={22} />
        </div>
        <div style={{ fontWeight: 600, marginBottom: 4 }}>Telegram не подключён</div>
        <div className="muted" style={{ fontSize: 12.5, lineHeight: 1.5, marginBottom: 12 }}>
          Привяжи аккаунт, чтобы получать уведомления о заселениях и переездах.
        </div>
        <Btn variant="primary" icon="telegram" onClick={openConnect}>
          Привязать Telegram
        </Btn>
      </div>
    );
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
      {accounts.map(a => (
        <div key={a.id} style={{ display: 'flex', alignItems: 'center', gap: 12, padding: 12, border: '1px solid var(--line)', borderRadius: 10, background: 'var(--surface)' }}>
          <div style={{ width: 36, height: 36, borderRadius: 9, background: '#0088cc22', color: '#0088cc', display: 'grid', placeItems: 'center', flexShrink: 0 }}>
            <Icon name="telegram" size={17} />
          </div>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ fontWeight: 600, fontSize: 13.5 }}>{displayName(a)}</div>
            {handle(a) && <div className="muted mono" style={{ fontSize: 11.5 }}>{handle(a)}</div>}
          </div>
          <Toggle on={!!a.is_active} onChange={() => toggle(a)} />
          <Btn variant="quiet" size="sm" icon="trash" onClick={() => remove(a)} />
        </div>
      ))}
      <Btn variant="ghost" icon="plus" onClick={openConnect}>
        Привязать ещё один Telegram-аккаунт
      </Btn>
    </div>
  );
}

// ─── ApproverRow ──────────────────────────────────────────────────────────────

function ApproverRow({ member, locked }) {
  const [on, setOn] = useState(false);
  const name = member.user_full_name || member.invite_email || '—';
  const roleLabel = member.role === 'owner' ? 'Владелец' : member.role === 'admin' ? 'Админ' : 'Зритель';

  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
      <Avatar name={name} size="sm" />
      <div style={{ flex: 1 }}>
        <div style={{ fontSize: 13, fontWeight: 500 }}>{name}</div>
        <div className="muted" style={{ fontSize: 11.5 }}>{roleLabel}</div>
      </div>
      {locked
        ? <span className="muted" style={{ fontSize: 12 }}>Аппрувер по роли</span>
        : <Toggle on={on} onChange={() => setOn(v => !v)} />}
    </div>
  );
}

// ─── SettingsLens (main export) ───────────────────────────────────────────────

export default function SettingsLens({ tripId, trip, members = [], myRole, isPro, queryClient }) {
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
  // extensible bag — adding another visibility flag later is just another key.
  async function toggleBookingWarnings() {
    const next = !bookingWarnings;
    setBookingWarnings(next); // optimistic
    const { data, error } = await supabase.functions.invoke('updateTripSettings', {
      body: { tripId, display: { booking_warnings: next } },
    });
    if (error || !data?.ok) {
      setBookingWarnings(!next); // revert
      alert('Не удалось сохранить: ' + (error?.message || data?.code || 'ошибка'));
      return;
    }
    queryClient?.invalidateQueries({ queryKey: TRIP_SHELL_KEY(tripId) });
  }

  // Trip-level toggle for the floating chat widget (the dock button shown on
  // every trip page). Persisted under details.display.chat_widget, same path as
  // booking_warnings. Independent of the per-user nothing — it's a trip setting.
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
      alert('Не удалось сохранить: ' + (error?.message || data?.code || 'ошибка'));
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
    if (error || !data?.ok) { setSaveMsg('Ошибка: ' + (error?.message || data?.code || 'не сохранено')); return; }
    // Optimistically patch the shell cache so the header/title updates instantly,
    // then invalidate to reconcile with the server.
    queryClient?.setQueryData(TRIP_SHELL_KEY(tripId), (old) =>
      old?.trip ? { ...old, trip: { ...old.trip, title: title.trim(), details: { ...(old.trip.details || {}), main_currency: currency } } } : old);
    queryClient?.invalidateQueries({ queryKey: TRIP_SHELL_KEY(tripId) });
    queryClient?.invalidateQueries({ queryKey: ['trip-content', tripId] });
    setSaveMsg('Сохранено ✓');
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
      if (isOwner) setProLocked({ open: true, feature: feat?.label || '' });
      else setTripProInfo({ open: true, feature: feat?.label || '' });
      return;
    }
    const newVal = !features[id];
    setFeatures(s => ({ ...s, [id]: newVal }));  // optimistic
    const nextAddons = { ...(trip?.details?.addons || {}), [feat.addon]: newVal };
    // trips RLS is owner-only → write via edge function (owner+admin, pro-gated).
    const { data, error } = await supabase.functions.invoke('updateTripSettings', {
      body: { tripId, addons: nextAddons },
    });
    if (error || !data?.ok) {
      setFeatures(s => ({ ...s, [id]: !newVal }));  // revert
      if (data?.code === 'PRO_REQUIRED') {
        if (isOwner) setProLocked({ open: true, feature: feat?.label || '' });
        else setTripProInfo({ open: true, feature: feat?.label || '' });
      } else {
        alert('Не удалось сохранить: ' + (error?.message || data?.code || 'ошибка'));
      }
      return;
    }
    queryClient?.invalidateQueries({ queryKey: TRIP_SHELL_KEY(tripId) });
  }

  // Leave trip
  async function leaveTrip() {
    if (!window.confirm('Выйти из трипа? Ты перестанешь видеть его.')) return;
    const myMember = members.find(m => m.user_id === user?.id && m.status === 'active');
    if (!myMember) { alert('Ошибка: не найдено ваше участие в трипе.'); return; }
    const { error } = await supabase.functions.invoke('removeTripMember', {
      body: { member_id: myMember.id },
    });
    if (error) { alert('Ошибка: ' + error.message); return; }
    nav('/trips');
  }

  // Delete trip (owner only)
  async function deleteTrip() {
    if (!window.confirm('Удалить трип? Это действие необратимо.')) return;
    if (!window.confirm('Вы уверены? Все данные трипа будут удалены.')) return;
    const { error } = await supabase.from('trips').delete().eq('id', tripId);
    if (error) { alert('Ошибка: ' + error.message); return; }
    nav('/trips');
  }

  const approvers    = members.filter(m => ['owner', 'admin'].includes(m.role) && m.status === 'active');
  const viewerMems   = members.filter(m => m.role === 'viewer'  && m.status === 'active');

  return (
    <div style={{ maxWidth: 720 }}>
      <h2 style={{ marginBottom: 18 }}>Настройки трипа</h2>

      {/* Basic settings */}
      <Card title="Основное" style={{ marginBottom: 16 }}>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
          <Field label="Название">
            <input className="input" value={title} onChange={e => setTitle(e.target.value)} />
          </Field>
          <Field label="Основная валюта отображения">
            <div style={{ display: 'flex', gap: 10, alignItems: 'flex-start' }}>
              <CurrencySelect value={currency} onChange={setCurrency} width={200} />
              <Btn variant="primary" loading={saving} onClick={saveSettings}>Сохранить</Btn>
              {saveMsg && <span style={{ fontSize: 12.5, color: 'var(--success)', alignSelf: 'center' }}>{saveMsg}</span>}
            </div>
            <div className="muted" style={{ fontSize: 11.5, marginTop: 4 }}>Бюджет агрегируется в эту валюту.</div>
          </Field>

          <hr style={{ border: 'none', borderTop: '1px solid var(--line-2)', margin: 0 }} />

          {/* Warnings — section header + per-warning toggles (design: trip-settings.jsx §29).
              `display` in trip.details is an extensible bag, so future warning/display
              toggles slot in as more rows under this same header. */}
          <div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 12 }}>
              <div style={{ width: 38, height: 38, borderRadius: 10, background: 'var(--warning-soft)', color: 'var(--warning)', display: 'grid', placeItems: 'center', flexShrink: 0 }}>
                <Icon name="warning" size={17} />
              </div>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontWeight: 600, fontSize: 13.5 }}>Предупреждения</div>
                <div className="muted" style={{ fontSize: 12, lineHeight: 1.45 }}>Бейджи и баннеры о проблемах в плане этого трипа.</div>
              </div>
            </div>

            <div style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '12px 14px', background: 'var(--wash)', borderRadius: 10 }}>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontSize: 13, fontWeight: 500 }}>Предупреждения об отсутствии бронирований</div>
                <div className="muted" style={{ fontSize: 11.5, lineHeight: 1.45 }}>Например: нет переезда между городами или на даты не забронирован отель.</div>
              </div>
              <Toggle on={bookingWarnings} onChange={toggleBookingWarnings} />
            </div>
          </div>
        </div>
      </Card>

      {/* Feature toggles */}
      <Card title="Опциональные фичи" style={{ marginBottom: 16 }}>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 0 }}>
          {FEATURES.map((f, i) => (
            <FeatureRow key={f.id} feat={f} on={features[f.id]} hasPro={hasPro}
              onChange={() => toggleFeature(f.id, f.pro)} last={i === FEATURES.length - 1} />
          ))}
        </div>
      </Card>

      {/* Chat widget — trip-level toggle for the floating dock button.
          Only shown when the Group Chat addon is on (the widget can't exist
          without it). Hidden entirely otherwise. */}
      {features.chat && (
        <Card title="Виджет чата" style={{ marginBottom: 16 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 14 }}>
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ fontWeight: 600, fontSize: 13.5 }}>Показывать виджет на страницах трипа</div>
              <div className="muted" style={{ fontSize: 12, lineHeight: 1.45 }}>
                Плавающая кнопка чата видна на каждой странице этого трипа — быстрый доступ к групповому чату и ИИ-помощнику без перехода на отдельный экран.
              </div>
            </div>
            <Toggle on={chatWidget} onChange={toggleChatWidget} />
          </div>

          <div style={{ marginTop: 12, padding: '12px 14px', background: 'var(--wash)', borderRadius: 10, display: 'flex', alignItems: 'center', gap: 14 }}>
            <div style={{
              position: 'relative', width: 44, height: 44, borderRadius: 14, flexShrink: 0,
              background: 'linear-gradient(135deg, var(--brand) 0%, var(--brand) 50%, #6a3ee2 100%)',
              color: 'white', display: 'grid', placeItems: 'center',
              opacity: chatWidget ? 1 : 0.35, transition: 'opacity .15s ease',
            }}>
              <Icon name="chat" size={20} />
            </div>
            <div className="muted" style={{ fontSize: 12, lineHeight: 1.45 }}>
              {chatWidget
                ? 'Закреплён в правом нижнем углу — открывает чат и ИИ-помощника поверх любой страницы трипа.'
                : 'Виджет скрыт. Чат остаётся доступен на отдельной странице «Групповой чат».'}
            </div>
          </div>
        </Card>
      )}

      {/* Telegram — only when the Telegram addon is enabled. */}
      {features.tg && (
        <Card title="Telegram-мост" subtitle="Уведомления в Telegram" style={{ marginBottom: 16 }}>
          <TelegramSection tripId={tripId} />
        </Card>
      )}

      {/* Approvers */}
      <Card title="Аппруверы голосования за отели" subtitle="Кто голосует «за»" style={{ marginBottom: 16 }}>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          {approvers.map(m => <ApproverRow key={m.id} member={m} locked />)}
          {viewerMems.map(m => <ApproverRow key={m.id} member={m} locked={false} />)}
          {members.length === 0 && (
            <div className="muted" style={{ fontSize: 13 }}>Участники ещё не загружены.</div>
          )}
        </div>
      </Card>

      {/* Danger zone */}
      <Card title="Опасная зона" style={{ borderColor: 'var(--danger-soft)' }}>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          {myRole !== 'owner' && (
            <div style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '10px 0' }}>
              <div style={{ flex: 1 }}>
                <div style={{ fontWeight: 600, fontSize: 13.5 }}>Выйти из трипа</div>
                <div className="muted" style={{ fontSize: 12 }}>Ты перестанешь видеть трип. Владелец сможет пригласить тебя снова.</div>
              </div>
              <Btn variant="danger" onClick={leaveTrip}>Выйти</Btn>
            </div>
          )}
          {myRole === 'owner' && (
            <>
              <div style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '10px 0' }}>
                <div style={{ flex: 1 }}>
                  <div style={{ fontWeight: 600, fontSize: 13.5 }}>Выйти из трипа</div>
                  <div className="muted" style={{ fontSize: 12 }}>Передай владение другому участнику, прежде чем выходить.</div>
                </div>
                <Btn variant="danger" disabled>Выйти</Btn>
              </div>
              <hr style={{ border: 'none', borderTop: '1px solid var(--line-2)' }} />
              <div style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '10px 0' }}>
                <div style={{ flex: 1 }}>
                  <div style={{ fontWeight: 600, fontSize: 13.5 }}>Удалить трип</div>
                  <div className="muted" style={{ fontSize: 12 }}>Безвозвратно. Все данные трипа будут удалены.</div>
                </div>
                <Btn variant="danger-solid" onClick={deleteTrip}>Удалить трип</Btn>
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
