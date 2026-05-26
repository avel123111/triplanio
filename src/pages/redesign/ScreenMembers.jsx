import React, { useState } from 'react';
import { Icon } from '../../design/icons';
import { Btn, Avatar, AvatarStack, Badge, Card, Severity, fmt, TRIP } from '../../design/index';

// =====================================================================
// TRIP MEMBERS (§25)
// =====================================================================

const MEMBERS_LIST = [
{ name: "Анна Лебедева", email: "anna@example.com", role: "owner", status: "active" },
{ name: "Игорь Мейзинский", email: "igor@example.com", role: "admin", status: "active" },
{ name: "Лена Краснова", email: "lena@example.com", role: "viewer", status: "active" },
{ name: "Миша Петров", email: "misha@example.com", role: "admin", status: "pending" },
{ name: "Серёжа Краснов", kind: "placeholder", role: "viewer", status: "offline" }];


function ScreenMembers() {
  return (
    <>
      <div style={{ marginBottom: 22, paddingBottom: 16, borderBottom: "1px solid var(--line-2)" }}>
        <h2>{TRIP.title}</h2>
      </div>

      <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 18 }}>
        <h2 style={{ flex: 1 }}>Участники · {MEMBERS_LIST.length}</h2>
        <Btn variant="primary" icon="plus" onClick={() => {}}>Пригласить</Btn>
      </div>

      <div style={{ background: "var(--surface)", border: "1px solid var(--line)", borderRadius: 14, overflow: "hidden" }}>
        {MEMBERS_LIST.map((m, i) =>
        <div key={i} style={{
          display: "grid",
          gridTemplateColumns: "auto 1fr auto auto auto",
          alignItems: "center", gap: 16,
          padding: "14px 18px",
          borderBottom: i < MEMBERS_LIST.length - 1 ? "1px solid var(--line-2)" : "none"
        }}>
            <Avatar name={m.name} kind={m.kind} size="lg" />
            <div>
              <div style={{ fontWeight: 600, fontSize: 14, display: "flex", alignItems: "center", gap: 8 }}>
                {m.name}
                {m.kind === "placeholder" && <Badge variant="quiet">Офлайн</Badge>}
              </div>
              <div className="muted" style={{ fontSize: 12.5 }}>{m.email || "Нет аккаунта — только отображение"}</div>
            </div>
            <div>
              {m.role === "owner" && <Badge variant="warm">Владелец</Badge>}
              {m.role === "admin" && <Badge variant="">Админ</Badge>}
              {m.role === "viewer" && <Badge variant="quiet" icon="eye">Зритель</Badge>}
            </div>
            <div>
              {m.status === "active" && <span style={{ color: "var(--success)", fontSize: 12.5, display: "inline-flex", alignItems: "center", gap: 4 }}><span style={{ width: 6, height: 6, borderRadius: "50%", background: "var(--success)" }} />Принял</span>}
              {m.status === "pending" && <span style={{ color: "var(--warning)", fontSize: 12.5, display: "inline-flex", alignItems: "center", gap: 6 }}><span style={{ width: 6, height: 6, borderRadius: "50%", background: "var(--warning)" }} />Ожидает</span>}
              {m.status === "offline" && <span className="muted" style={{ fontSize: 12.5 }}>—</span>}
            </div>
            <div style={{ display: "flex", gap: 4 }}>
              {m.status === "pending" && <Btn variant="ghost" size="sm">Отправить ещё раз</Btn>}
              {m.role !== "owner" && <Btn variant="quiet" size="sm" icon="more" />}
            </div>
          </div>
        )}
      </div>

      <div style={{ marginTop: 24, padding: 18, background: "var(--brand-soft)", borderRadius: 14, display: "flex", alignItems: "center", gap: 14, flexWrap: "wrap" }}>
        <div style={{ width: 44, height: 44, borderRadius: 11, background: "var(--brand)", color: "white", display: "grid", placeItems: "center" }}>
          <Icon name="users" size={20} />
        </div>
        <div style={{ flex: 1, minWidth: 200 }}>
          <div style={{ fontWeight: 600, marginBottom: 2 }}>Пригласить ещё участников</div>
          <div className="muted" style={{ fontSize: 12.5 }}>Можно отправить приглашение по e-mail, скопировать ссылку или добавить офлайн-человека без аккаунта.</div>
        </div>
        <Btn variant="primary" icon="plus" onClick={() => {}}>Пригласить</Btn>
      </div>
    </>
  );
}

export default ScreenMembers;
