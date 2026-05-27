import React, { useState, useEffect, useRef } from 'react';
import { Icon } from '../../design/icons';
import { Avatar, AvatarStack, Badge, Btn, Card, Field, EmptyState, Skeleton, Toggle,
         fmt, TRIP, TRIPS, ModalHost, Dialog, PartnerLogo, PartnerPill, CityPhoto,
         WeatherChip, RoleBadge, DismissibleSeverity, BookingSuggestionCard,
         TripIdentityStrip } from '../../design/index';

// =====================================================================
// TRIP SETTINGS (§29) — icons next to features, Pro-locked, Telegram multi-account
// =====================================================================

const FEATURES = [
  { id: "cal", icon: "calendar", color: "var(--brand)", label: "Календарь",
    desc: "Те же события на сетке месяца/недели", pro: true },
  { id: "budget", icon: "wallet", color: "var(--success)", label: "Полная разбивка бюджета",
    desc: "Категории, ручные расходы, FX-override’ы", pro: true },
  { id: "chat", icon: "chat", color: "var(--ai)", label: "Групповой чат",
    desc: "Сообщения, упоминания, @assistant" },
  { id: "hotels", icon: "vote", color: "var(--warm)", label: "Совместный выбор отелей",
    desc: "Голосование среди аппруверов" },
  { id: "tg", icon: "telegram", color: "#0088cc", label: "Telegram-мост",
    desc: "Напоминания в Telegram", pro: true },
  { id: "ai", icon: "sparkles", color: "var(--ai)", label: "Персональный ИИ-помощник",
    desc: "Личный диалог с возможностью править трип", pro: true },
  { id: "docs", icon: "file", color: "var(--muted)", label: "Документы трипа",
    desc: "Скоро · отдельный модуль для коллекции файлов", locked: true },
];

function ScreenTripSettings() {
  const [states, setStates] = useState({ cal: true, budget: true, chat: true, hotels: true, tg: true, ai: true, docs: false });
  const [cur, setCur] = useState("EUR");
  const userHasSub = window.__userHasSub ?? true;
  const tripIsPro = window.__tripIsPro ?? true;
  const hasPro = userHasSub || tripIsPro;

  const toggle = (id, pro) => {
    if (pro && !hasPro) {
      window.__openModal?.(<ProLockedDialog feature={FEATURES.find(f => f.id === id)?.label} />);
      return;
    }
    setStates(s => ({ ...s, [id]: !s[id] }));
  };

  return (
    <>
      <TripIdentityStrip compact />
      <div style={{ maxWidth: 720 }}>
        <h2 style={{ marginBottom: 18 }}>Настройки трипа</h2>

        <Card title="Основное" style={{ marginBottom: 16 }}>
          <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
            <div>
              <label style={{ fontSize: 12.5, fontWeight: 500, marginBottom: 4, display: "block" }}>Название</label>
              <input className="input" defaultValue="Иберия летом" />
            </div>
            <div>
              <label style={{ fontSize: 12.5, fontWeight: 500, marginBottom: 4, display: "block" }}>Основная валюта отображения</label>
              <select className="select" value={cur} onChange={(e) => setCur(e.target.value)} style={{ maxWidth: 200 }}>
                <option>EUR</option><option>USD</option><option>RUB</option>
              </select>
              <div className="muted" style={{ fontSize: 11.5, marginTop: 4 }}>Бюджет агрегируется в эту валюту.</div>
            </div>
          </div>
        </Card>

        <Card title="Опциональные фичи" style={{ marginBottom: 16 }}>
          <div style={{ display: "flex", flexDirection: "column", gap: 0 }}>
            {FEATURES.map((f, i) => (
              <FeatureRow key={f.id} feat={f} on={states[f.id]} onChange={() => toggle(f.id, f.pro)}
                hasPro={hasPro} last={i === FEATURES.length - 1} />
            ))}
          </div>
        </Card>

        {/* TELEGRAM — multi-account */}
        <Card title="Telegram-мост" subtitle="Один или несколько аккаунтов для уведомлений" style={{ marginBottom: 16 }}>
          <TelegramSection />
        </Card>

        <Card title="Аппруверы голосования за отели" subtitle="Кто голосует «за»" style={{ marginBottom: 16 }}>
          <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
            <ApproverRow name="Анна Лебедева" role="Владелец" locked />
            <ApproverRow name="Игорь Мейзинский" role="Админ" locked />
            <ApproverRow name="Миша Петров" role="Админ" locked />
            <ApproverRow name="Лена Краснова" role="Зритель" toggle />
          </div>
        </Card>

        <Card title="Опасная зона" style={{ borderColor: "var(--danger-soft)" }}>
          <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
            <div style={{ display: "flex", alignItems: "center", gap: 12, padding: "10px 0" }}>
              <div style={{ flex: 1 }}>
                <div style={{ fontWeight: 600, fontSize: 13.5 }}>Выйти из трипа</div>
                <div className="muted" style={{ fontSize: 12 }}>Ты перестанешь видеть трип. Владелец сможет пригласить тебя снова.</div>
              </div>
              <Btn variant="danger">Выйти</Btn>
            </div>
            <hr className="hr" />
            <div style={{ display: "flex", alignItems: "center", gap: 12, padding: "10px 0" }}>
              <div style={{ flex: 1 }}>
                <div style={{ fontWeight: 600, fontSize: 13.5 }}>Удалить трип</div>
                <div className="muted" style={{ fontSize: 12 }}>Безвозвратно. Pro-трип потребует двойного подтверждения.</div>
              </div>
              <Btn variant="danger-solid">Удалить трип</Btn>
            </div>
          </div>
        </Card>
      </div>
    </>
  );
}

function FeatureRow({ feat, on, onChange, hasPro, last }) {
  const locked = feat.pro && !hasPro;
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 14, padding: "14px 0", borderBottom: last ? "none" : "1px solid var(--line-2)" }}>
      <div style={{
        width: 38, height: 38, borderRadius: 10,
        background: (feat.color || "var(--muted)") + (on ? "22" : "11"),
        color: feat.color || "var(--muted)",
        display: "grid", placeItems: "center", flexShrink: 0,
        opacity: feat.locked ? 0.4 : 1,
      }}>
        <Icon name={feat.icon} size={17} />
      </div>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ fontWeight: 600, fontSize: 13.5, display: "flex", alignItems: "center", gap: 8 }}>
          {feat.label}
          {feat.pro && !hasPro && <Badge variant="warm" icon="pro">Pro</Badge>}
          {feat.pro && hasPro && <Badge variant="success" icon="check">Доступно</Badge>}
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

function TelegramConnectDialog() {
  // Mock-flow: 3 stages — idle (default) → connecting (after click) → connected (auto-refresh demo)
  const [stage, setStage] = useState("idle");
  const [countdown, setCountdown] = useState(600); // 10 minutes

  React.useEffect(() => {
    if (stage !== "connecting") return;
    const id = setInterval(() => setCountdown((c) => Math.max(0, c - 1)), 1000);
    return () => clearInterval(id);
  }, [stage]);

  const mmss = `${String(Math.floor(countdown / 60)).padStart(2, "0")}:${String(countdown % 60).padStart(2, "0")}`;

  return (
    <Dialog title="Привязать Telegram" icon="telegram" size=""
      foot={<>
        <Btn variant="ghost" onClick={() => window.__closeModal?.()}>Закрыть</Btn>
      </>}>

      <div className="muted" style={{ fontSize: 13, lineHeight: 1.55, marginBottom: 16 }}>
        Привяжите Telegram, чтобы получать напоминания об отелях, переездах, аренде авто и активностях для этого трипа.
      </div>

      {stage === "idle" && (
        <>
          <div style={{
            display: "flex", alignItems: "center", gap: 12,
            padding: 14,
            background: "var(--wash)", border: "1px solid var(--line)", borderRadius: 12,
            marginBottom: 16
          }}>
            <div style={{ width: 36, height: 36, borderRadius: 9, background: "#0088cc22", color: "#0088cc", display: "grid", placeItems: "center", flexShrink: 0 }}>
              <Icon name="telegram" size={17} />
            </div>
            <div style={{ flex: 1 }}>
              <div style={{ fontWeight: 600, fontSize: 13.5 }}>Telegram не подключён</div>
              <div className="muted" style={{ fontSize: 11.5 }}>Для этого трипа</div>
            </div>
            <Badge variant="quiet">Не подключён</Badge>
          </div>

          <div style={{ fontSize: 13, lineHeight: 1.55, marginBottom: 16 }}>
            Нажмите кнопку ниже, чтобы открыть бота в Telegram и нажать «Старт».
            <span className="muted"> Ссылка действует 10 минут.</span>
          </div>

          <Btn
            variant="primary"
            icon="telegram"
            block
            onClick={() => { setStage("connecting"); setCountdown(600); }}
          >
            Открыть Triplanio-бот в Telegram
          </Btn>

          <div className="muted" style={{ fontSize: 11.5, marginTop: 14, lineHeight: 1.5, textAlign: "center" }}>
            После «Старта» в Telegram вернитесь сюда — панель обновится автоматически.
          </div>
        </>
      )}

      {stage === "connecting" && (
        <>
          <div style={{
            display: "flex", alignItems: "center", gap: 12,
            padding: 14,
            background: "#0088cc11", border: "1px solid #0088cc33", borderRadius: 12,
            marginBottom: 16
          }}>
            <div style={{ width: 36, height: 36, borderRadius: 9, background: "#0088cc22", color: "#0088cc", display: "grid", placeItems: "center", flexShrink: 0 }}>
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

          <div style={{
            display: "flex", flexDirection: "column", gap: 10,
            padding: 14,
            background: "var(--wash)", border: "1px solid var(--line)", borderRadius: 12,
            marginBottom: 14, fontSize: 12.5, lineHeight: 1.55
          }}>
            <div style={{ display: "flex", gap: 10 }}>
              <div style={{ width: 20, height: 20, borderRadius: 999, background: "var(--brand)", color: "#fff", fontSize: 11, fontWeight: 700, display: "grid", placeItems: "center", flexShrink: 0 }}>1</div>
              <div>В открывшемся чате нажмите <strong>«Start»</strong>.</div>
            </div>
            <div style={{ display: "flex", gap: 10 }}>
              <div style={{ width: 20, height: 20, borderRadius: 999, background: "var(--brand)", color: "#fff", fontSize: 11, fontWeight: 700, display: "grid", placeItems: "center", flexShrink: 0 }}>2</div>
              <div>Вернитесь на эту вкладку — статус обновится автоматически.</div>
            </div>
          </div>

          <div style={{ display: "flex", gap: 8 }}>
            <Btn variant="ghost" icon="telegram" onClick={() => {}}>Открыть бот ещё раз</Btn>
            <div style={{ flex: 1 }} />
            <Btn variant="primary" icon="check" onClick={() => setStage("connected")}>Я нажал Start</Btn>
          </div>
        </>
      )}

      {stage === "connected" && (
        <>
          <div style={{
            display: "flex", alignItems: "center", gap: 12,
            padding: 14,
            background: "var(--success-soft)", border: "1px solid color-mix(in oklab, var(--success) 25%, transparent)", borderRadius: 12,
            marginBottom: 14
          }}>
            <div style={{ width: 36, height: 36, borderRadius: 9, background: "color-mix(in oklab, var(--success) 22%, transparent)", color: "var(--success)", display: "grid", placeItems: "center", flexShrink: 0 }}>
              <Icon name="check" size={17} />
            </div>
            <div style={{ flex: 1 }}>
              <div style={{ fontWeight: 600, fontSize: 13.5 }}>Telegram привязан</div>
              <div className="muted mono" style={{ fontSize: 11.5 }}>@new_account · только что</div>
            </div>
            <Badge variant="success" icon="check">Активен</Badge>
          </div>

          <div className="muted" style={{ fontSize: 12.5, lineHeight: 1.55, marginBottom: 14 }}>
            Уведомления для этого трипа теперь будут приходить в Telegram. Настройте, какие именно — в карточке «Telegram-мост».
          </div>

          <Btn variant="primary" icon="check" block onClick={() => window.__closeModal?.()}>Готово</Btn>
        </>
      )}
    </Dialog>
  );
}

function TelegramSection() {
  const [accounts, setAccounts] = useState([
    { id: 1, handle: "@anna_l", name: "Анна (личный)", status: "connected" },
    { id: 2, handle: "@anna_work", name: "Анна (рабочий)", status: "pending" },
  ]);
  const [notifSettings, setNotifSettings] = useState({
    checkin: true, transfer: true, cancel: true, daily: false, chat: true,
  });

  if (accounts.length === 0) {
    return (
      <div style={{ padding: 20, background: "var(--wash)", borderRadius: 12, textAlign: "center" }}>
        <div style={{ width: 48, height: 48, margin: "0 auto 10px", borderRadius: 12, background: "#0088cc22", color: "#0088cc", display: "grid", placeItems: "center" }}>
          <Icon name="telegram" size={22} />
        </div>
        <div style={{ fontWeight: 600, marginBottom: 4 }}>Telegram не подключён</div>
        <div className="muted" style={{ fontSize: 12.5, lineHeight: 1.5, marginBottom: 12 }}>
          Привяжи аккаунт, чтобы получать уведомления о заселениях и переездах.
        </div>
        <Btn variant="primary" icon="telegram" onClick={() => window.__openModal?.(<TelegramConnectDialog />)}>Привязать Telegram</Btn>
      </div>
    );
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
      {/* Account list */}
      <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
        {accounts.map((a) => (
          <div key={a.id} style={{ display: "flex", alignItems: "center", gap: 12, padding: 12, border: "1px solid var(--line)", borderRadius: 10, background: "var(--surface)" }}>
            <div style={{ width: 36, height: 36, borderRadius: 9, background: "#0088cc22", color: "#0088cc", display: "grid", placeItems: "center", flexShrink: 0 }}>
              <Icon name="telegram" size={17} />
            </div>
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ fontWeight: 600, fontSize: 13.5 }}>{a.name}</div>
              <div className="muted mono" style={{ fontSize: 11.5 }}>{a.handle}</div>
            </div>
            {a.status === "connected" && (
              <Badge variant="success" icon="check">Активен</Badge>
            )}
            {a.status === "pending" && (
              <Badge variant="warning">
                <span className="ai-dots" style={{ marginRight: 4 }}><span /><span /><span /></span>
                Ожидает подтверждения в TG
              </Badge>
            )}
            <Btn variant="quiet" size="sm" icon="trash" onClick={() => setAccounts(accounts.filter(x => x.id !== a.id))} />
          </div>
        ))}
      </div>

      <Btn variant="ghost" icon="plus" onClick={() => window.__openModal?.(<TelegramConnectDialog />)}>
        Привязать ещё один Telegram-аккаунт
      </Btn>

      {/* Notification settings (replacing "mute") */}
      <div style={{ marginTop: 8 }}>
        <div className="eyebrow" style={{ marginBottom: 10 }}>Настройки уведомлений</div>
        <div style={{ display: "flex", flexDirection: "column", gap: 0, padding: 12, background: "var(--wash)", borderRadius: 10 }}>
          {[
            { id: "checkin", label: "Заезды и выезды", desc: "За 12 часов до заселения и выезда" },
            { id: "transfer", label: "Переезды", desc: "За 3 часа до отправления" },
            { id: "cancel", label: "Дедлайны отмены", desc: "За день до невозвратной оплаты" },
            { id: "daily", label: "Дайджест дня", desc: "Утром — что сегодня в плане" },
            { id: "chat", label: "Упоминания в чате", desc: "Когда тебя @упомянули" },
          ].map((s, i, arr) => (
            <div key={s.id} style={{ display: "flex", alignItems: "center", gap: 10, padding: "8px 0", borderBottom: i < arr.length - 1 ? "1px solid var(--line-2)" : "none" }}>
              <div style={{ flex: 1 }}>
                <div style={{ fontSize: 13, fontWeight: 500 }}>{s.label}</div>
                <div className="muted" style={{ fontSize: 11.5 }}>{s.desc}</div>
              </div>
              <Toggle on={notifSettings[s.id]} onChange={() => setNotifSettings({ ...notifSettings, [s.id]: !notifSettings[s.id] })} />
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

function ApproverRow({ name, role, locked, toggle }) {
  const [on, setOn] = useState(false);
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
      <Avatar name={name} size="sm" />
      <div style={{ flex: 1 }}>
        <div style={{ fontSize: 13, fontWeight: 500 }}>{name}</div>
        <div className="muted" style={{ fontSize: 11.5 }}>{role}</div>
      </div>
      {locked ? <span className="muted" style={{ fontSize: 12 }}>Аппрувер по роли</span> : <Toggle on={on} onChange={setOn} />}
    </div>
  );
}

export default ScreenTripSettings;
