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

function TelegramConnectDialog() {
  const [stage, setStage] = useState('idle');
  const [countdown, setCountdown] = useState(600);

  useEffect(() => {
    if (stage !== 'connecting') return;
    const id = setInterval(() => setCountdown(c => Math.max(0, c - 1)), 1000);
    return () => clearInterval(id);
  }, [stage]);

  const mmss = `${String(Math.floor(countdown / 60)).padStart(2, '0')}:${String(countdown % 60).padStart(2, '0')}`;

  return (
    <Dialog title="Привязать Telegram" icon="telegram" size=""
      foot={<Btn variant="ghost" onClick={() => window.__closeModal?.()}>Закрыть</Btn>}>
      <div className="muted" style={{ fontSize: 13, lineHeight: 1.55, marginBottom: 16 }}>
        Привяжите Telegram, чтобы получать напоминания об отелях, переездах и активностях для этого трипа.
      </div>

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
          <Btn variant="primary" icon="telegram" block onClick={() => { setStage('connecting'); setCountdown(600); }}>
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
            <div style={{ width: 36, height: 36, borderRadius: 9, background: '#0088cc22', color: '#0088cc', display: 'grid', placeItems: 'center' }}>
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
          <div style={{ display: 'flex', gap: 8 }}>
            <Btn variant="ghost" icon="telegram">Открыть бот ещё раз</Btn>
            <div style={{ flex: 1 }} />
            <Btn variant="primary" icon="check" onClick={() => setStage('connected')}>Я нажал Start</Btn>
          </div>
        </>
      )}

      {stage === 'connected' && (
        <>
          <div style={{ display: 'flex', alignItems: 'center', gap: 12, padding: 14, background: 'var(--success-soft)', border: '1px solid color-mix(in oklab, var(--success) 25%, transparent)', borderRadius: 12, marginBottom: 14 }}>
            <div style={{ width: 36, height: 36, borderRadius: 9, background: 'color-mix(in oklab, var(--success) 22%, transparent)', color: 'var(--success)', display: 'grid', placeItems: 'center' }}>
              <Icon name="check" size={17} />
            </div>
            <div style={{ flex: 1 }}>
              <div style={{ fontWeight: 600, fontSize: 13.5 }}>Telegram привязан</div>
              <div className="muted" style={{ fontSize: 11.5 }}>только что</div>
            </div>
            <Badge variant="success" icon="check">Активен</Badge>
          </div>
          <Btn variant="primary" icon="check" block onClick={() => window.__closeModal?.()}>Готово</Btn>
        </>
      )}
    </Dialog>
  );
}

// ─── TelegramSection ──────────────────────────────────────────────────────────

function TelegramSection() {
  const [accounts, setAccounts] = useState([]);
  const [notif, setNotif] = useState({ checkin: true, transfer: true, cancel: true, daily: false, chat: true });

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
        <Btn variant="primary" icon="telegram" onClick={() => window.__openModal?.(<TelegramConnectDialog />)}>
          Привязать Telegram
        </Btn>
      </div>
    );
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
      {accounts.map(a => (
        <div key={a.id} style={{ display: 'flex', alignItems: 'center', gap: 12, padding: 12, border: '1px solid var(--line)', borderRadius: 10, background: 'var(--surface)' }}>
          <div style={{ width: 36, height: 36, borderRadius: 9, background: '#0088cc22', color: '#0088cc', display: 'grid', placeItems: 'center' }}>
            <Icon name="telegram" size={17} />
          </div>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ fontWeight: 600, fontSize: 13.5 }}>{a.name}</div>
            <div className="muted mono" style={{ fontSize: 11.5 }}>{a.handle}</div>
          </div>
          <Badge variant={a.status === 'connected' ? 'success' : 'warning'}>
            {a.status === 'connected' ? 'Активен' : 'Ожидает'}
          </Badge>
          <Btn variant="quiet" size="sm" icon="trash" onClick={() => setAccounts(accounts.filter(x => x.id !== a.id))} />
        </div>
      ))}
      <Btn variant="ghost" icon="plus" onClick={() => window.__openModal?.(<TelegramConnectDialog />)}>
        Привязать ещё один Telegram-аккаунт
      </Btn>
      <div style={{ marginTop: 8 }}>
        <div className="eyebrow" style={{ marginBottom: 10 }}>Настройки уведомлений</div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 0, padding: 12, background: 'var(--wash)', borderRadius: 10 }}>
          {[
            { id: 'checkin',  label: 'Заезды и выезды',    desc: 'За 12 часов до заселения и выезда' },
            { id: 'transfer', label: 'Переезды',            desc: 'За 3 часа до отправления' },
            { id: 'cancel',   label: 'Дедлайны отмены',    desc: 'За день до невозвратной оплаты' },
            { id: 'daily',    label: 'Дайджест дня',        desc: 'Утром — что сегодня в плане' },
            { id: 'chat',     label: 'Упоминания в чате',  desc: 'Когда тебя @упомянули' },
          ].map((s, i, arr) => (
            <div key={s.id} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '8px 0', borderBottom: i < arr.length - 1 ? '1px solid var(--line-2)' : 'none' }}>
              <div style={{ flex: 1 }}>
                <div style={{ fontSize: 13, fontWeight: 500 }}>{s.label}</div>
                <div className="muted" style={{ fontSize: 11.5 }}>{s.desc}</div>
              </div>
              <Toggle on={notif[s.id]} onChange={() => setNotif(n => ({ ...n, [s.id]: !n[s.id] }))} />
            </div>
          ))}
        </div>
      </div>
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

      {/* Display toggles (trip-level) */}
      <Card title="Отображение" subtitle="Что показывать в этом трипе" style={{ marginBottom: 16 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 14, padding: '4px 0' }}>
          <div style={{ width: 38, height: 38, borderRadius: 10, background: 'var(--warm)22', color: 'var(--warm)', display: 'grid', placeItems: 'center', flexShrink: 0 }}>
            <Icon name="warning" size={17} />
          </div>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ fontWeight: 600, fontSize: 13.5 }}>Предупреждения о пропущенных бронях</div>
            <div className="muted" style={{ fontSize: 12 }}>Подсказки «нет переезда» и «нет жилья» в хронологии. Выключи, если план намеренно неполный.</div>
          </div>
          <Toggle on={bookingWarnings} onChange={toggleBookingWarnings} />
        </div>
      </Card>

      {/* Telegram */}
      <Card title="Telegram-мост" subtitle="Уведомления в Telegram" style={{ marginBottom: 16 }}>
        <TelegramSection />
      </Card>

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
