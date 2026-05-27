import React, { useState, useEffect, useRef } from 'react';
import { Icon } from '../../design/icons';
import { Avatar, AvatarStack, Badge, Btn, Card, Field, EmptyState, Skeleton, Toggle,
         fmt, TRIP, TRIPS, ModalHost, Dialog, PartnerLogo, PartnerPill, CityPhoto,
         WeatherChip, RoleBadge, DismissibleSeverity, BookingSuggestionCard } from '../../design/index';

// =====================================================================
// SYSTEM STUBS (§33) — no-access, 404, expired link, unregistered
// =====================================================================

const STUBS = {
  "no-access": {
    icon: "lock",
    title: "У тебя нет доступа к этому трипу",
    body: "Возможно, приглашение было отозвано или ты никогда не приглашался. Попроси владельца трипа добавить тебя.",
    primary: { label: "К моим трипам", to: "collection" },
    secondary: "Войти другим аккаунтом",
    tone: "warm",
  },
  "404": {
    icon: "search",
    title: "Такой страницы не существует",
    body: "Возможно, ссылка устарела или содержит ошибку. Попробуй вернуться в коллекцию трипов.",
    primary: { label: "На главную", to: "collection" },
    tone: "brand",
  },
  "expired": {
    icon: "link",
    title: "Эта публичная ссылка истекла",
    body: "Владелец отозвал доступ или ссылка превысила срок действия. Попроси новую ссылку.",
    primary: { label: "Узнать о Triplanio" },
    tone: "warning",
  },
  "unregistered": {
    icon: "user",
    title: "Этот аккаунт не зарегистрирован",
    body: "Аккаунт anna@example.com нет на этом инстансе Triplanio. Зарегистрируйся или войди другой почтой.",
    primary: { label: "Зарегистрироваться" },
    secondary: "Войти другим аккаунтом",
    tone: "brand",
  },
};

function ScreenSystem() {
  const variant = window.__systemVariant || "no-access";
  const s = STUBS[variant];
  const colors = {
    brand: ["var(--brand-soft)", "var(--brand)"],
    warm: ["var(--warm-tint)", "var(--warm)"],
    warning: ["var(--warning-soft)", "var(--warning)"],
  };
  const [bg, fg] = colors[s.tone];

  return (
    <div style={{
      display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center",
      minHeight: "calc(100vh - 220px)", padding: 32, textAlign: "center",
    }}>
      <div style={{
        width: 96, height: 96, borderRadius: 24,
        background: bg, color: fg,
        display: "grid", placeItems: "center", marginBottom: 28,
      }}>
        <Icon name={s.icon} size={42} />
      </div>
      <h1 style={{ fontSize: 32, marginBottom: 12, maxWidth: 520 }}>{s.title}</h1>
      <div className="muted" style={{ fontSize: 15.5, maxWidth: 480, lineHeight: 1.55, marginBottom: 24 }}>{s.body}</div>
      <div style={{ display: "flex", gap: 10 }}>
        {s.primary && <Btn variant="primary" size="lg" onClick={() => s.primary.to && window.__navigate?.(s.primary.to)}>{s.primary.label}</Btn>}
        {s.secondary && <Btn variant="ghost" size="lg">{s.secondary}</Btn>}
      </div>
      <div className="muted" style={{ marginTop: 60, fontSize: 12 }}>Все системные заглушки — одна семья визуально: иконка-в-круге + заголовок + объяснение + действие.</div>
    </div>
  );
}

export default ScreenSystem;
