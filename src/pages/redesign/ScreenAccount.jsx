import React, { useState, useEffect, useRef } from 'react';
import { Icon } from '../../design/icons';
import { Avatar, AvatarStack, Badge, Btn, Card, Field, EmptyState, Skeleton, Toggle,
         fmt, TRIP, TRIPS, ModalHost, Dialog, PartnerLogo, PartnerPill, CityPhoto,
         WeatherChip, RoleBadge, DismissibleSeverity, BookingSuggestionCard,
         Severity } from '../../design/index';

// =====================================================================
// ACCOUNT SETTINGS (§30)
// =====================================================================

const LANGS = [
{ code: "ru", label: "Русский", native: "Русский" },
{ code: "en", label: "English", native: "English" },
{ code: "es", label: "Español", native: "Español" }];


function ScreenAccount() {
  const state = window.__accountState || "with-sub";
  // states: "with-sub" (monthly active) | "no-sub" (free) | "cancelled" (cancelled, valid until date) | "annual" (yearly active)
  const hasSub = state === "with-sub" || state === "cancelled" || state === "annual";
  const isCancelled = state === "cancelled";
  const isAnnual = state === "annual";

  const [lang, setLang] = useState("ru");
  const [langOpen, setLangOpen] = useState(false);
  const [theme, setTheme] = useState(document.documentElement.dataset.theme || "light");
  const [emailInvites, setEmailInvites] = useState(true);
  const [emailUpdates, setEmailUpdates] = useState(true);
  const [deleting, setDeleting] = useState(false);
  const [avatarHover, setAvatarHover] = useState(false);

  const currentLang = LANGS.find((l) => l.code === lang);

  return (
    <div style={{ maxWidth: 720, margin: "0 auto" }}>
      <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 22, flexWrap: "wrap" }}>
        <h1 style={{ flex: 1 }}>Настройки аккаунта</h1>
        {state === "with-sub" && <Badge variant="warm" icon="pro">Pro · подписка</Badge>}
        {state === "annual" && <Badge variant="warm" icon="pro">Pro · годовая</Badge>}
        {state === "cancelled" && <Badge variant="quiet" icon="warning">Pro · отменена</Badge>}
      </div>

      <Card title="Идентичность" style={{ marginBottom: 16 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 18, marginBottom: 16 }}>
          {/* Avatar with hover overlay for upload/delete — instead of buttons next to it */}
          <div
            onMouseEnter={() => setAvatarHover(true)}
            onMouseLeave={() => setAvatarHover(false)}
            style={{ position: "relative", width: 76, height: 76, borderRadius: "50%", overflow: "hidden", cursor: "pointer" }}
          >
            <Avatar name="Анна Лебедева" size="xl" />
            {avatarHover && (
              <div style={{
                position: "absolute", inset: 0, background: "rgba(15,23,42,.65)",
                display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", gap: 4,
                color: "white", fontSize: 11, fontWeight: 600,
              }}>
                <Icon name="cam" size={20} />
                <span>Загрузить</span>
              </div>
            )}
          </div>
          <div style={{ flex: 1 }}>
            <div style={{ fontWeight: 600, fontSize: 15 }}>Анна Лебедева</div>
            <div className="muted" style={{ fontSize: 12.5, marginTop: 2 }}>Наведи на аватар, чтобы заменить</div>
            <div style={{ marginTop: 8, display: "flex", gap: 6 }}>
              <button style={{ padding: "4px 10px", background: "transparent", border: "none", color: "var(--danger)", fontSize: 12, fontWeight: 500, cursor: "pointer", borderRadius: 6 }}
                onMouseEnter={(e) => e.currentTarget.style.background = "var(--danger-soft)"} onMouseLeave={(e) => e.currentTarget.style.background = "transparent"}>
                <Icon name="trash" size={11} style={{ verticalAlign: -1, marginRight: 4 }} />Удалить аватар
              </button>
            </div>
          </div>
        </div>
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
          <div>
            <label style={{ fontSize: 12.5, fontWeight: 500, marginBottom: 4, display: "block" }}>Отображаемое имя</label>
            <input className="input" defaultValue="Анна Лебедева" />
          </div>
          <div>
            <label style={{ fontSize: 12.5, fontWeight: 500, marginBottom: 4, display: "block" }}>
              E-mail <Badge variant="quiet" style={{ marginLeft: 4 }}>нередактируемо</Badge>
            </label>
            <input className="input" value="anna@example.com" readOnly style={{ background: "var(--wash)", color: "var(--muted)" }} />
          </div>
        </div>
      </Card>

      <Card title="Предпочтения" style={{ marginBottom: 16 }}>
        <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
          <div>
            <label style={{ fontSize: 12.5, fontWeight: 500, marginBottom: 6, display: "block" }}>Язык интерфейса</label>
            <div style={{ position: "relative", maxWidth: 260 }}>
              <button onClick={() => setLangOpen(!langOpen)} className="select" style={{
                width: "100%", textAlign: "left", display: "flex", alignItems: "center", gap: 8, cursor: "pointer"
              }}>
                <span>{currentLang.native}</span>
                <span style={{ flex: 1 }} />
                <Icon name={langOpen ? "chevD" : "chev"} size={13} style={{ color: "var(--muted)" }} />
              </button>
              {langOpen &&
              <div style={{
                position: "absolute", top: "calc(100% + 4px)", left: 0, right: 0,
                background: "var(--surface)", border: "1px solid var(--line)", borderRadius: 10,
                boxShadow: "var(--shadow-pop)", padding: 4, zIndex: 10
              }}>
                  {LANGS.map((l) =>
                <button key={l.code} onClick={() => {setLang(l.code);setLangOpen(false);}} style={{
                  width: "100%", padding: "8px 10px", textAlign: "left",
                  border: "none", background: l.code === lang ? "var(--brand-soft)" : "transparent",
                  color: l.code === lang ? "var(--brand)" : "var(--ink)",
                  borderRadius: 6, cursor: "pointer", display: "flex", alignItems: "center", gap: 8, fontSize: 13.5
                }}>
                      {l.code === lang && <Icon name="checkSm" size={13} />}
                      <span style={{ width: l.code === lang ? "auto" : 20 }}>{l.native}</span>
                    </button>
                )}
                </div>
              }
            </div>
          </div>
          <div>
            <label style={{ fontSize: 12.5, fontWeight: 500, marginBottom: 6, display: "block" }}>Тема</label>
            <div className="tweaks__seg">
              <button className={theme === "light" ? "active" : ""} onClick={() => {setTheme("light");document.documentElement.dataset.theme = "light";}}>Светлая</button>
              <button className={theme === "dark" ? "active" : ""} onClick={() => {setTheme("dark");document.documentElement.dataset.theme = "dark";}}>Тёмная</button>
              <button className={theme === "system" ? "active" : ""} onClick={() => setTheme("system")}>Как в системе</button>
            </div>
          </div>
        </div>
      </Card>

      {/* SUBSCRIPTION — multi-state */}
      {state === "with-sub" && (
        <Card title="Подписка" subtitle="Pro · ежемесячная" style={{ marginBottom: 16 }}>
          <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
            <div style={{ padding: 14, background: "var(--brand-soft)", borderRadius: 12, display: "flex", alignItems: "center", gap: 14, flexWrap: "wrap" }}>
              <div style={{ width: 44, height: 44, borderRadius: 11, background: "var(--brand)", color: "white", display: "grid", placeItems: "center" }}>
                <Icon name="pro" size={22} />
              </div>
              <div style={{ flex: 1, minWidth: 200 }}>
                <div style={{ fontWeight: 600 }}>Pro Monthly</div>
                <div className="muted num" style={{ fontSize: 12.5 }}>€9.99/мес · следующее списание <b style={{ color: "var(--ink-2)", fontWeight: 600 }}>12 июля 2026</b></div>
              </div>
              <Btn variant="ghost" size="sm" icon="arrow">Перейти на годовой · −33%</Btn>
              <Btn variant="ghost" size="sm" icon="external">Биллинг-портал</Btn>
            </div>
            <div className="muted" style={{ fontSize: 12.5 }}>
              После отмены доступ сохраняется до конца оплаченного периода. <a href="#">Отменить подписку</a>
            </div>
          </div>
        </Card>
      )}

      {state === "annual" && (
        <Card title="Подписка" subtitle="Pro · годовая · ✓ экономия 33%" style={{ marginBottom: 16, borderColor: "var(--success)" }}>
          <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
            <div style={{ padding: 14, background: "var(--success-soft)", borderRadius: 12, display: "flex", alignItems: "center", gap: 14, flexWrap: "wrap" }}>
              <div style={{ width: 44, height: 44, borderRadius: 11, background: "var(--success)", color: "white", display: "grid", placeItems: "center" }}>
                <Icon name="pro" size={22} />
              </div>
              <div style={{ flex: 1, minWidth: 200 }}>
                <div style={{ fontWeight: 600, display: "flex", alignItems: "center", gap: 6 }}>
                  Pro Yearly <Badge variant="success">Активна</Badge>
                </div>
                <div className="muted num" style={{ fontSize: 12.5 }}>€79.99/год · обновится <b style={{ color: "var(--ink-2)", fontWeight: 600 }}>21 апреля 2027</b> · эквивалент €6.67/мес</div>
              </div>
              <Btn variant="ghost" size="sm" icon="external">Биллинг-портал</Btn>
            </div>
            <div style={{ padding: 12, background: "var(--wash)", borderRadius: 10, display: "flex", alignItems: "center", gap: 10 }}>
              <Icon name="info" size={14} style={{ color: "var(--muted)" }} />
              <span className="muted" style={{ fontSize: 12.5 }}>Годовая подписка платится раз в год и не списывается ежемесячно.</span>
            </div>
            <div className="muted" style={{ fontSize: 12.5 }}>
              <a href="#">Отменить — будет действовать до конца года</a>
            </div>
          </div>
        </Card>
      )}

      {state === "cancelled" && (
        <Card title="Подписка" subtitle="Отменена" style={{ marginBottom: 16, borderColor: "var(--warning-soft)" }}>
          <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
            <div style={{ padding: 14, background: "var(--warning-soft)", borderRadius: 12, display: "flex", alignItems: "center", gap: 14, flexWrap: "wrap" }}>
              <div style={{ width: 44, height: 44, borderRadius: 11, background: "var(--warning)", color: "white", display: "grid", placeItems: "center" }}>
                <Icon name="warning" size={22} />
              </div>
              <div style={{ flex: 1, minWidth: 200 }}>
                <div style={{ fontWeight: 600 }}>Pro отменена — действует до 12 июля 2026</div>
                <div className="muted" style={{ fontSize: 12.5, marginTop: 2 }}>
                  Все Pro-фичи доступны до этой даты. Потом аккаунт перейдёт на Free.
                </div>
              </div>
              <Btn variant="primary" size="sm" icon="refresh">Возобновить</Btn>
            </div>
            <div style={{ padding: 12, background: "var(--wash)", borderRadius: 10, fontSize: 12.5, color: "var(--muted)", lineHeight: 1.5 }}>
              После 12 июля доступ к ИИ-помощнику, парсингу и календарю исчезнет в трипах без отдельного Pro-апгрейда. Активные трипы продолжат существовать как Free.
            </div>
          </div>
        </Card>
      )}

      {state === "no-sub" && (
        <Card title="Подписка" subtitle="Сейчас Free" style={{ marginBottom: 16, borderColor: "var(--warm-soft)" }} className="ai-card">
          <div style={{ display: "flex", alignItems: "center", gap: 16, flexWrap: "wrap" }}>
            <div style={{ width: 48, height: 48, borderRadius: 12, background: "var(--wash)", color: "var(--muted)", display: "grid", placeItems: "center" }}>
              <Icon name="user" size={22} />
            </div>
            <div style={{ flex: 1, minWidth: 180 }}>
              <div style={{ fontWeight: 600, marginBottom: 4 }}>Free тариф</div>
              <div className="muted" style={{ fontSize: 12.5 }}>1 активный трип · без ИИ-помощника, ИИ-парсера и календарной линзы.</div>
            </div>
            <Btn variant="primary" icon="pro" onClick={() => window.__navigate?.("pro")}>Перейти к Pro</Btn>
          </div>
          <hr className="hr" style={{ margin: "14px 0" }} />
          <div style={{ display: "flex", gap: 10, alignItems: "center" }}>
            <Icon name="info" size={14} style={{ color: "var(--muted)" }} />
            <span className="muted" style={{ fontSize: 12.5 }}>У тебя есть 1 трип с одноразовым Pro-апгрейдом — он работает независимо от подписки.</span>
          </div>
        </Card>
      )}

      <Card title="E-mail уведомления" style={{ marginBottom: 16 }}>
        <div style={{ display: "flex", flexDirection: "column", gap: 0 }}>
          <SettingRow label="Приглашения в трипы" desc="Когда тебя добавляют в новый трип." on={emailInvites} onChange={setEmailInvites} />
          <SettingRow label="Обновления трипа" desc="Изменения в трипах, где ты участник." on={emailUpdates} onChange={setEmailUpdates} last />
        </div>
      </Card>

      <div style={{ display: "flex", justifyContent: "flex-end", gap: 8, marginBottom: 24 }}>
        <Btn variant="ghost">Отмена</Btn>
        <Btn variant="primary" icon="check">Сохранить изменения</Btn>
      </div>

      <Card title="Опасная зона" style={{ borderColor: "var(--danger-soft)" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 12, flexWrap: "wrap" }}>
          <div style={{ flex: 1, minWidth: 200 }}>
            <div style={{ fontWeight: 600 }}>Удалить аккаунт</div>
            <div className="muted" style={{ fontSize: 12.5 }}>Безвозвратно. Все твои трипы, документы и история чатов будут удалены.</div>
          </div>
          <Btn variant="danger-solid" onClick={() => setDeleting(true)}>Удалить аккаунт</Btn>
        </div>
        {deleting && hasSub &&
        <div style={{ marginTop: 14 }}>
            <Severity level="error" title="Сначала отмени подписку">
              У тебя активная ежемесячная подписка Pro. Удаление аккаунта заблокировано, пока подписка не закрыта.
              <div style={{ marginTop: 8 }}><Btn variant="ghost" size="sm" icon="external">Открыть биллинг-портал</Btn></div>
            </Severity>
          </div>
        }
        {deleting && !hasSub &&
        <div style={{ marginTop: 14 }}>
            <Severity level="error" title="Подтверди удаление">
              Действие необратимо. Введи слово «УДАЛИТЬ» для подтверждения.
              <div style={{ marginTop: 8, display: "flex", gap: 8 }}>
                <input className="input" placeholder="УДАЛИТЬ" style={{ flex: 1 }} />
                <Btn variant="danger-solid">Удалить навсегда</Btn>
              </div>
            </Severity>
          </div>
        }
      </Card>
    </div>);

}

function SettingRow({ label, desc, on, onChange, last }) {
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 14, padding: "10px 0", borderBottom: last ? "none" : "1px solid var(--line-2)" }}>
      <div style={{ flex: 1 }}>
        <div style={{ fontWeight: 500, fontSize: 13.5 }}>{label}</div>
        <div className="muted" style={{ fontSize: 12 }}>{desc}</div>
      </div>
      <Toggle on={on} onChange={onChange} />
    </div>);

}

export default ScreenAccount;
