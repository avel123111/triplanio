import React, { useState, useEffect, useRef } from 'react';
import { Icon } from '../../design/icons';
import { Avatar, AvatarStack, Badge, Btn, Card, Field, EmptyState, Skeleton, Toggle,
         fmt, TRIP, TRIPS, ModalHost, Dialog, PartnerLogo, PartnerPill, CityPhoto,
         WeatherChip, RoleBadge, DismissibleSeverity, BookingSuggestionCard } from '../../design/index';

// =====================================================================
// TRIP MEMBERS (§25)
// =====================================================================

const MEMBERS_LIST = [
{ name: "Анна Лебедева", email: "anna@example.com", role: "owner", status: "active" },
{ name: "Игорь Мейзинский", email: "igor@example.com", role: "admin", status: "active" },
{ name: "Лена Краснова", email: "lena@example.com", role: "viewer", status: "active" },
{ name: "Миша Петров", email: "misha@example.com", role: "admin", status: "pending" },
{ name: "Серёжа Краснов", kind: "placeholder", role: "viewer", status: "offline" },
{ name: "Мама Лебедева", kind: "placeholder", role: "viewer", status: "offline" }];


function ScreenMembers() {
  const [openMenu, setOpenMenu] = useState(null);

  // Close menu on outside click
  React.useEffect(() => {
    if (openMenu == null) return;
    const fn = (e) => {
      if (!e.target.closest?.("[data-row-menu]")) setOpenMenu(null);
    };
    setTimeout(() => document.addEventListener("click", fn), 0);
    return () => document.removeEventListener("click", fn);
  }, [openMenu]);

  return (
    <>
      <TripIdentityStrip compact />

      <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 18, flexWrap: "wrap" }}>
        <h2 style={{ flex: 1, marginBottom: 0 }}>Участники · {MEMBERS_LIST.length}</h2>
        <Btn variant="primary" icon="plus" onClick={() => window.__openModal?.(<window.InviteDialog />)}>Пригласить</Btn>
      </div>

      <div style={{ background: "var(--surface)", border: "1px solid var(--line)", borderRadius: 14, overflow: "visible" }}>
        {MEMBERS_LIST.map((m, i) => {
          const isOffline = m.status === "offline";
          const isOwner = m.role === "owner";
          const showMenu = openMenu === i;
          return (
            <div key={i} style={{
              display: "grid",
              gridTemplateColumns: "auto 1fr auto auto auto",
              alignItems: "center", gap: 16,
              padding: "14px 18px",
              borderBottom: i < MEMBERS_LIST.length - 1 ? "1px solid var(--line-2)" : "none",
              position: "relative",
            }}>
              <Avatar name={m.name} kind={m.kind} size="lg" />
              <div>
                <div style={{ fontWeight: 600, fontSize: 14, display: "flex", alignItems: "center", gap: 8 }}>
                  {m.name}
                  {isOffline && <Badge variant="quiet">Офлайн</Badge>}
                </div>
                <div className="muted" style={{ fontSize: 12.5 }}>{m.email || "Нет аккаунта — только отображение"}</div>
              </div>

              {/* Role — hidden for offline placeholders (Pavel feedback) */}
              <div>
                {!isOffline && m.role === "owner" && <Badge variant="warm">Владелец</Badge>}
                {!isOffline && m.role === "admin" && <Badge variant="">Админ</Badge>}
                {!isOffline && m.role === "viewer" && <Badge variant="quiet" icon="eye">Зритель</Badge>}
              </div>

              {/* Status */}
              <div>
                {m.status === "active" && <span style={{ color: "var(--success)", fontSize: 12.5, display: "inline-flex", alignItems: "center", gap: 4 }}><span style={{ width: 6, height: 6, borderRadius: "50%", background: "var(--success)" }} />Принял</span>}
                {m.status === "pending" && <span style={{ color: "var(--warning)", fontSize: 12.5, display: "inline-flex", alignItems: "center", gap: 6 }}><span style={{ width: 6, height: 6, borderRadius: "50%", background: "var(--warning)" }} />Ожидает</span>}
                {m.status === "offline" && <span className="muted" style={{ fontSize: 12.5 }}>—</span>}
              </div>

              {/* Actions */}
              <div style={{ display: "flex", gap: 4, position: "relative" }} data-row-menu>
                {/* Inline primary action for offline placeholders */}
                {isOffline && (
                  <Btn variant="ghost" size="sm" icon="send" onClick={() => window.__openModal?.(<window.ConvertOfflineDialog preselect={m.name} />)}>
                    Пригласить
                  </Btn>
                )}

                {/* 3-dot menu — always shown for non-owner rows; active styling when open */}
                {!isOwner && (
                  <button
                    onClick={(e) => { e.stopPropagation(); setOpenMenu(showMenu ? null : i); }}
                    className="icon-btn"
                    style={{
                      width: 30, height: 30,
                      background: showMenu ? "var(--brand-soft)" : "transparent",
                      color: showMenu ? "var(--brand)" : "var(--muted)",
                      border: "1px solid " + (showMenu ? "var(--brand)" : "transparent"),
                    }}
                    title="Действия"
                  >
                    <Icon name="more" size={15} />
                  </button>
                )}

                {showMenu && (
                  <div style={{
                    position: "absolute", top: "calc(100% + 4px)", right: 0, zIndex: 20,
                    width: 220,
                    background: "var(--surface)", border: "1px solid var(--line)",
                    borderRadius: 11, boxShadow: "var(--shadow-pop)",
                    padding: 6,
                  }}>
                    {m.status === "pending" && (
                      <RowMenuItem icon="send" onClick={() => setOpenMenu(null)}>Отправить ещё раз</RowMenuItem>
                    )}
                    {m.status === "pending" && (
                      <RowMenuItem icon="copy" onClick={() => setOpenMenu(null)}>Скопировать ссылку</RowMenuItem>
                    )}
                    {m.status === "active" && (
                      <RowMenuItem icon="edit" onClick={() => setOpenMenu(null)}>Изменить роль</RowMenuItem>
                    )}
                    {m.status === "offline" && (
                      <RowMenuItem icon="edit" onClick={() => setOpenMenu(null)}>Переименовать</RowMenuItem>
                    )}
                    <RowMenuItem icon="trash" danger onClick={() => setOpenMenu(null)}>
                      {m.status === "pending" ? "Отменить приглашение" : "Убрать из трипа"}
                    </RowMenuItem>
                  </div>
                )}
              </div>
            </div>
          );
        })}
      </div>

      <div style={{ marginTop: 24, padding: 18, background: "var(--brand-soft)", borderRadius: 14, display: "flex", alignItems: "center", gap: 14, flexWrap: "wrap" }}>
        <div style={{ width: 44, height: 44, borderRadius: 11, background: "var(--brand)", color: "white", display: "grid", placeItems: "center" }}>
          <Icon name="users" size={20} />
        </div>
        <div style={{ flex: 1, minWidth: 200 }}>
          <div style={{ fontWeight: 600, marginBottom: 2 }}>Пригласить ещё участников</div>
          <div className="muted" style={{ fontSize: 12.5 }}>Можно отправить приглашение по e-mail, скопировать ссылку или добавить офлайн-человека без аккаунта.</div>
        </div>
        <Btn variant="primary" icon="plus" onClick={() => window.__openModal?.(<window.InviteDialog />)}>Пригласить</Btn>
      </div>
    </>);

}

function RowMenuItem({ icon, danger, onClick, children }) {
  return (
    <button onClick={onClick} style={{
      display: "flex", alignItems: "center", gap: 10,
      width: "100%", padding: "8px 10px",
      background: "transparent", border: "none",
      borderRadius: 7, cursor: "pointer", textAlign: "left",
      fontSize: 13, color: danger ? "var(--danger)" : "var(--ink)",
    }}
    onMouseEnter={(e) => e.currentTarget.style.background = danger ? "var(--danger-soft)" : "var(--wash)"}
    onMouseLeave={(e) => e.currentTarget.style.background = "transparent"}>
      <Icon name={icon} size={14} />
      {children}
    </button>
  );
}

export default ScreenMembers;
