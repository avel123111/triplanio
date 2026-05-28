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
import UpgradePlanDialog from '@/components/subscriptions/UpgradePlanDialog';

// ─── Feature flags ────────────────────────────────────────────────────────────
// `addon` is the key persisted under trip.details.addons (matches TripView lens ids
// for the gateable lenses: calendar / budget / chat).

const FEATURES = [
  { id: 'cal',    addon: 'calendar',            icon: 'calendar',  color: 'var(--brand)',   label: 'Календарь',                   desc: 'Те же события на сетке месяца/недели',                  pro: true  },
  { id: 'budget', addon: 'budget',              icon: 'wallet',    color: 'var(--success)', label: 'Полная разбивка бюджета',     desc: 'Категории, ручные расходы, FX-override\'ы',             pro: true  },
  { id: 'chat',   addon: 'chat',                icon: 'chat',      color: 'var(--ai)',      label: 'Групповой чат',               desc: 'Сообщения, упоминания, @assistant',                     pro: true  },
  { id: 'hotels', addon: 'hotels_selection',    icon: 'vote',      color: 'var(--warm)',    label: 'Совместный выбор отелей',     desc: 'Голосование среди аппруверов'                                   },
  { id: 'tg',     addon: 'telegram_assistant',  icon: 'telegram',  color: '#0088cc',        label: 'Telegram-мост',               desc: 'Напоминания в Telegram',                                pro: true  },
  { id: 'ai',     addon: 'ai',                  icon: 'sparkles',  color: 'var(--ai)',      label: 'Персональный ИИ-помощник',    desc: 'Личный диалог с возможностью править трип',             pro: true  },
  { id: 'docs',   addon: 'docs',                icon: 'file',      color: 'var(--muted)',   label: 'Документы трипа',             desc: 'Паспорта, страховки, общие файлы',                      locked: true },
];

// Default ON unless explicitly disabled (addons[key] === false).
function featuresFromTrip(trip) {
  const addons = trip?.details?.addons || {};
  const state = {};
  for (const f of FEATURES) state[f.id] = f.locked ? false : (addons[f.addon] !== false);
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
  const name = member.user_full_name || member.user_email || '—';
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

  const hasPro = isPro;
  const [features, setFeatures] = useState(() => featuresFromTrip(trip));
  const [proLocked, setProLocked] = useState({ open: false, feature: '' });
  const [upgradeOpen, setUpgradeOpen] = useState(false);

  // Sync local state when trip prop changes
  useEffect(() => {
    if (trip?.title)        setTitle(trip.title);
    if (trip?.details?.main_currency || trip?.main_currency) setCurrency(trip.details?.main_currency || trip.main_currency || 'EUR');
    setFeatures(featuresFromTrip(trip));
  }, [trip]);

  // Save basic settings
  async function saveSettings() {
    if (!title.trim()) return;
    setSaving(true);
    const { error } = await supabase.from('trips').update({
      title: title.trim(),
      details: { ...(trip?.details || {}), main_currency: currency },
    }).eq('id', tripId);
    setSaving(false);
    if (error) { setSaveMsg('Ошибка: ' + error.message); return; }
    queryClient?.invalidateQueries({ queryKey: TRIP_SHELL_KEY(tripId) });
    setSaveMsg('Сохранено ✓');
    setTimeout(() => setSaveMsg(''), 2000);
  }

  // Toggle feature → persist to trip.details.addons, then invalidate shell query.
  async function toggleFeature(id, pro) {
    const feat = FEATURES.find(f => f.id === id);
    if (feat?.locked) return;
    if (pro && !hasPro) {
      setProLocked({ open: true, feature: feat?.label || '' });
      return;
    }
    const newVal = !features[id];
    setFeatures(s => ({ ...s, [id]: newVal }));  // optimistic
    const nextAddons = { ...(trip?.details?.addons || {}), [feat.addon]: newVal };
    const { error } = await supabase.from('trips').update({
      details: { ...(trip?.details || {}), addons: nextAddons },
    }).eq('id', tripId);
    if (error) {
      setFeatures(s => ({ ...s, [id]: !newVal }));  // revert
      alert('Не удалось сохранить: ' + error.message);
      return;
    }
    queryClient?.invalidateQueries({ queryKey: TRIP_SHELL_KEY(tripId) });
  }

  // Leave trip
  async function leaveTrip() {
    if (!window.confirm('Выйти из трипа? Ты перестанешь видеть его.')) return;
    const { error } = await supabase.functions.invoke('removeTripMember', {
      body: { tripId, targetEmail: user?.email },
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
              <select className="select" value={currency} onChange={e => setCurrency(e.target.value)} style={{ maxWidth: 200 }}>
                <option value="EUR">EUR</option>
                <option value="USD">USD</option>
                <option value="RUB">RUB</option>
                <option value="GBP">GBP</option>
                <option value="TRY">TRY</option>
              </select>
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
        onUpgrade={() => setUpgradeOpen(true)}
      />
      <UpgradePlanDialog open={upgradeOpen} onOpenChange={setUpgradeOpen} tripId={tripId} hidePerTrip />
    </div>
  );
}
