import React, { useState, useEffect, useRef } from 'react';
import { Icon } from '../../design/icons';
import { Avatar, AvatarStack, Badge, Btn, Card, Field, EmptyState, Skeleton, Toggle,
         fmt, TRIP, TRIPS, ModalHost, Dialog, PartnerLogo, PartnerPill, CityPhoto,
         WeatherChip, RoleBadge, DismissibleSeverity, BookingSuggestionCard } from '../../design/index';

// =====================================================================
// INBOX (§27) — notifications center
// =====================================================================

const NOTIFS = [
  { date: "Сегодня", items: [
    { type: "invite", who: "Олег Сурин", trip: "Япония, апрель 2026", time: "2 ч назад", unread: true },
    { type: "vote-new", who: "Игорь Мейзинский", trip: "Иберия летом", text: "предложил «Hotel Britania» в Лиссабоне", time: "4 ч назад", unread: true },
    { type: "update", who: "Лена Краснова", trip: "Иберия летом", text: "добавила активность «Парк Гуэль» 21 июля", time: "5 ч назад", unread: true },
  ]},
  { date: "Вчера", items: [
    { type: "vote-final", who: "Анна Лебедева", trip: "Япония, апрель", text: "выбрала «Park Hyatt Tokyo» как итоговый", time: "вчера 19:24" },
    { type: "joined", who: "Миша Петров", trip: "Иберия летом", text: "присоединился к трипу", time: "вчера 12:08" },
  ]},
  { date: "Эта неделя", items: [
    { type: "system", text: "Pro-апгрейд подтверждён · подписка активна до 12 июля 2027", time: "10 июня" },
    { type: "vote-approved", who: "Все аппруверы", trip: "Иберия летом", text: "одобрили «Cotton House» в Барселоне", time: "9 июня" },
  ]},
];

function ScreenInbox() {
  const [filter, setFilter] = useState("all");
  return (
    <div style={{ maxWidth: 760, margin: "0 auto" }}>
      <div style={{ display: "flex", alignItems: "center", gap: 16, marginBottom: 22 }}>
        <h1 style={{ flex: 1 }}>Инбокс</h1>
        <Btn variant="ghost" size="sm">Пометить всё прочитанным</Btn>
      </div>

      <div className="tweaks__seg" style={{ marginBottom: 18 }}>
        {[["all", "Все"], ["unread", "Непрочитанные · 3"], ["invites", "Приглашения · 1"], ["votes", "Голосования · 2"]].map(([k, l]) => (
          <button key={k} className={filter === k ? "active" : ""} onClick={() => setFilter(k)}>{l}</button>
        ))}
      </div>

      <div style={{ background: "var(--surface)", border: "1px solid var(--line)", borderRadius: 14, overflow: "hidden" }}>
        {NOTIFS.map((g, gi) => (
          <div key={gi}>
            <div style={{ padding: "10px 18px", fontSize: 11, color: "var(--muted-2)", letterSpacing: ".1em", textTransform: "uppercase", fontWeight: 600, background: "var(--wash-2)", borderTop: gi > 0 ? "1px solid var(--line-2)" : "none", borderBottom: "1px solid var(--line-2)" }}>
              {g.date}
            </div>
            {g.items.map((n, ni) => (
              <NotifRow key={ni} n={n} last={ni === g.items.length - 1 && gi === NOTIFS.length - 1} />
            ))}
          </div>
        ))}
      </div>
    </div>
  );
}

function NotifRow({ n, last }) {
  const ICONS = { invite: "users", "vote-new": "vote", "vote-final": "flag", "vote-approved": "check", update: "edit", joined: "user", system: "pro" };
  const COLORS = { invite: "var(--brand)", "vote-new": "var(--ai)", "vote-final": "var(--success)", "vote-approved": "var(--success)", update: "var(--warm)", joined: "var(--success)", system: "var(--warm)" };
  return (
    <div style={{
      display: "grid",
      gridTemplateColumns: "auto 1fr auto",
      gap: 14, padding: "14px 18px", alignItems: "center",
      borderBottom: last ? "none" : "1px solid var(--line-2)",
      position: "relative",
      background: n.unread ? "var(--brand-soft)" : "transparent",
    }}>
      <div style={{
        width: 36, height: 36, borderRadius: 10,
        background: (COLORS[n.type] || "var(--brand)") + "22",
        color: COLORS[n.type], display: "grid", placeItems: "center",
      }}>
        <Icon name={ICONS[n.type] || "bell"} size={16} />
      </div>
      <div>
        <div style={{ fontSize: 13.5, lineHeight: 1.45 }}>
          {n.who && <><b>{n.who}</b> </>}
          {n.type === "invite" && <span>пригласил в трип <a href="#"><b>{n.trip}</b></a></span>}
          {n.type === "vote-new" && <span>{n.text} в <a href="#" onClick={() => window.__navigate?.("hotels")}><b>{n.trip}</b></a></span>}
          {n.type === "vote-final" && <span>{n.text} в <a href="#"><b>{n.trip}</b></a></span>}
          {n.type === "vote-approved" && <span>{n.text} в <a href="#"><b>{n.trip}</b></a></span>}
          {n.type === "update" && <span>{n.text} в <a href="#"><b>{n.trip}</b></a></span>}
          {n.type === "joined" && <span>{n.text} в <a href="#"><b>{n.trip}</b></a></span>}
          {n.type === "system" && <span>{n.text}</span>}
        </div>
        <div className="muted" style={{ fontSize: 11.5, marginTop: 2 }}>{n.time}</div>
      </div>
      <div style={{ display: "flex", gap: 6 }}>
        {n.type === "invite" && (<>
          <Btn variant="primary" size="sm" icon="check">Принять</Btn>
          <Btn variant="ghost" size="sm">Отклонить</Btn>
        </>)}
        {n.type !== "invite" && <Btn variant="quiet" size="sm" icon="chev" />}
      </div>
      {n.unread && <span style={{ position: "absolute", left: 6, top: "50%", transform: "translateY(-50%)", width: 6, height: 6, borderRadius: "50%", background: "var(--brand)" }} />}
    </div>
  );
}

export default ScreenInbox;
