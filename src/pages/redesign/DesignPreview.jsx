import React, { useState, useEffect } from 'react';
import '../../design/app.css';
import { Icon } from '../../design/icons';
import { ModalHost } from '../../design/index';

// Lazy-loaded screens
import ScreenCollection from './ScreenCollection';
import ScreenAccount from './ScreenAccount';
import ScreenInbox from './ScreenInbox';
import ScreenPro from './ScreenPro';
import ScreenSystem from './ScreenSystem';
import ScreenPublic from './ScreenPublic';
import ScreenAiPlanner from './ScreenAiPlanner';

// Trip screens
import ScreenTimeline from './ScreenTimeline';
import ScreenBudget from './ScreenBudget';
import ScreenCalendar from './ScreenCalendar';
import ScreenChat from './ScreenChat';
import ScreenDocs from './ScreenDocs';
import ScreenHotels from './ScreenHotels';
import ScreenMap from './ScreenMap';
import ScreenMembers from './ScreenMembers';
import ScreenSettings from './ScreenSettings';
import ScreenAI from './ScreenAI';
import ScreenForms from './ScreenForms';

// =====================================================================
// Navigation structure
// =====================================================================
const NAV = [
  {
    group: "Главные",
    items: [
      { id: "collection", label: "Мои трипы", icon: "collection" },
      { id: "inbox",      label: "Инбокс",    icon: "bell" },
      { id: "pro",        label: "Pro",        icon: "pro" },
      { id: "account",    label: "Аккаунт",   icon: "user" },
      { id: "ai-planner", label: "ИИ-планировщик", icon: "sparkles" },
    ]
  },
  {
    group: "Трип: Иберия летом",
    items: [
      { id: "timeline",  label: "Хронология",  icon: "calendar" },
      { id: "budget",    label: "Бюджет",       icon: "wallet" },
      { id: "calendar",  label: "Календарь",   icon: "calendar" },
      { id: "chat",      label: "Чат",          icon: "chat" },
      { id: "docs",      label: "Документы",   icon: "file" },
      { id: "hotels",    label: "Отели",        icon: "bed" },
      { id: "map",       label: "Карта",        icon: "map" },
      { id: "members",   label: "Участники",   icon: "users" },
      { id: "settings",  label: "Настройки",   icon: "settings" },
      { id: "ai",        label: "ИИ-помощник", icon: "sparkles" },
    ]
  },
  {
    group: "Формы",
    items: [
      { id: "forms",  label: "Формы добавления", icon: "edit" },
    ]
  },
  {
    group: "Системные",
    items: [
      { id: "public",     label: "Публичный трип",  icon: "globe" },
      { id: "system-404", label: "404",              icon: "search" },
      { id: "system-noaccess", label: "Нет доступа", icon: "lock" },
      { id: "system-expired",  label: "Ссылка истекла", icon: "link" },
    ]
  },
];

const SCREEN_MAP = {
  collection:         <ScreenCollection />,
  inbox:              <ScreenInbox />,
  pro:                <ScreenPro />,
  account:            <ScreenAccount />,
  "ai-planner":       <ScreenAiPlanner />,
  timeline:           <ScreenTimeline />,
  budget:             <ScreenBudget />,
  calendar:           <ScreenCalendar />,
  chat:               <ScreenChat />,
  docs:               <ScreenDocs />,
  hotels:             <ScreenHotels />,
  map:                <ScreenMap />,
  members:            <ScreenMembers />,
  settings:           <ScreenSettings />,
  ai:                 <ScreenAI />,
  forms:              <ScreenForms />,
  public:             <ScreenPublic />,
  "system-404":       <ScreenSystem variant="404" />,
  "system-noaccess":  <ScreenSystem variant="no-access" />,
  "system-expired":   <ScreenSystem variant="expired" />,
};

// =====================================================================
// Trip Tab Nav (renders inside trip screens)
// =====================================================================
const TRIP_TABS = [
  { id: "timeline", icon: "calendar", label: "Хронология" },
  { id: "budget",   icon: "wallet",   label: "Бюджет" },
  { id: "calendar", icon: "calendar", label: "Календарь" },
  { id: "chat",     icon: "chat",     label: "Чат" },
  { id: "docs",     icon: "file",     label: "Документы" },
  { id: "hotels",   icon: "bed",      label: "Отели" },
  { id: "map",      icon: "map",      label: "Карта" },
  { id: "members",  icon: "users",    label: "Участники" },
  { id: "settings", icon: "settings", label: "Настройки" },
  { id: "ai",       icon: "sparkles", label: "ИИ" },
];

const TRIP_SCREEN_IDS = new Set(TRIP_TABS.map(t => t.id));

// =====================================================================
// Main DesignPreview component
// =====================================================================
export default function DesignPreview() {
  const [screen, setScreen] = useState("collection");
  const [theme, setTheme] = useState("light");
  const [sidebarOpen, setSidebarOpen] = useState(true);

  // Theme toggle
  useEffect(() => {
    document.documentElement.dataset.theme = theme;
    return () => { delete document.documentElement.dataset.theme; };
  }, [theme]);

  // Global navigate hook for screens
  useEffect(() => {
    window.__triplanioNavigate = (s) => setScreen(s);
    return () => { delete window.__triplanioNavigate; };
  }, []);

  const isTripScreen = TRIP_SCREEN_IDS.has(screen);

  return (
    <div style={{ display: "flex", height: "100vh", fontFamily: "var(--font-body, Inter, sans-serif)", background: "var(--bg, #f6f7f9)" }}>

      {/* ── Sidebar ── */}
      {sidebarOpen && (
        <aside style={{
          width: 220, flexShrink: 0, borderRight: "1px solid var(--line, #e2e6ef)",
          background: "var(--surface, #fff)", display: "flex", flexDirection: "column",
          overflow: "hidden",
        }}>
          {/* Logo */}
          <div style={{ padding: "18px 18px 14px", display: "flex", alignItems: "center", gap: 10, borderBottom: "1px solid var(--line-2, #edf0f7)" }}>
            <div style={{ width: 28, height: 28, borderRadius: 8, background: "var(--brand, #2167e2)", color: "white", display: "grid", placeItems: "center", fontSize: 13, fontWeight: 700, flexShrink: 0 }}>T</div>
            <span style={{ fontWeight: 700, fontSize: 14, letterSpacing: "-0.01em" }}>Triplanio UI</span>
            <div style={{ flex: 1 }} />
            <button onClick={() => setTheme(t => t === "light" ? "dark" : "light")}
              style={{ width: 28, height: 28, borderRadius: 6, border: "none", background: "var(--wash, #f1f3f7)", color: "var(--muted, #8693a8)", cursor: "pointer", display: "grid", placeItems: "center" }}>
              <Icon name={theme === "dark" ? "sun" : "moon"} size={13} />
            </button>
          </div>

          {/* Nav */}
          <div className="scrollbar-thin" style={{ flex: 1, overflow: "auto", padding: "10px 8px" }}>
            {NAV.map((group) => (
              <div key={group.group} style={{ marginBottom: 16 }}>
                <div style={{ padding: "4px 10px 6px", fontSize: 10.5, fontWeight: 700, letterSpacing: ".08em", textTransform: "uppercase", color: "var(--muted-2, #a5afc0)" }}>
                  {group.group}
                </div>
                {group.items.map((item) => {
                  const active = screen === item.id;
                  return (
                    <button key={item.id} onClick={() => setScreen(item.id)} style={{
                      width: "100%", textAlign: "left",
                      display: "flex", alignItems: "center", gap: 8,
                      padding: "7px 10px", borderRadius: 8, border: "none",
                      background: active ? "var(--brand-soft, #e8eef9)" : "transparent",
                      color: active ? "var(--brand, #2167e2)" : "var(--ink-2, #374257)",
                      fontWeight: active ? 600 : 400,
                      fontSize: 13, cursor: "pointer",
                      transition: "background .1s",
                    }}
                      onMouseEnter={(e) => { if (!active) e.currentTarget.style.background = "var(--wash, #f1f3f7)"; }}
                      onMouseLeave={(e) => { if (!active) e.currentTarget.style.background = "transparent"; }}
                    >
                      <Icon name={item.icon} size={14} />
                      {item.label}
                    </button>
                  );
                })}
              </div>
            ))}
          </div>

          {/* Footer */}
          <div style={{ padding: "10px 12px", borderTop: "1px solid var(--line-2, #edf0f7)", fontSize: 11, color: "var(--muted, #8693a8)" }}>
            {Object.keys(SCREEN_MAP).length} screens · layout-first
          </div>
        </aside>
      )}

      {/* ── Main ── */}
      <div style={{ flex: 1, display: "flex", flexDirection: "column", overflow: "hidden" }}>

        {/* Top bar */}
        <div style={{
          height: 52, flexShrink: 0, display: "flex", alignItems: "center", gap: 12,
          padding: "0 20px", borderBottom: "1px solid var(--line-2, #edf0f7)",
          background: "var(--surface, #fff)",
        }}>
          <button onClick={() => setSidebarOpen(v => !v)}
            style={{ width: 30, height: 30, borderRadius: 7, border: "none", background: "transparent", color: "var(--muted, #8693a8)", cursor: "pointer", display: "grid", placeItems: "center" }}>
            <Icon name="list" size={16} />
          </button>

          {/* Trip tab nav (only for trip screens) */}
          {isTripScreen && (
            <div style={{ display: "flex", gap: 2, flex: 1 }}>
              {TRIP_TABS.map((tab) => {
                const active = screen === tab.id;
                return (
                  <button key={tab.id} onClick={() => setScreen(tab.id)} style={{
                    display: "flex", alignItems: "center", gap: 5,
                    padding: "5px 10px", borderRadius: 7, border: "none",
                    background: active ? "var(--brand-soft, #e8eef9)" : "transparent",
                    color: active ? "var(--brand, #2167e2)" : "var(--ink-2, #374257)",
                    fontWeight: active ? 600 : 400,
                    fontSize: 12.5, cursor: "pointer",
                  }}>
                    <Icon name={tab.icon} size={13} />
                    {tab.label}
                  </button>
                );
              })}
            </div>
          )}

          {!isTripScreen && <div style={{ flex: 1 }} />}

          {/* Screen label */}
          <span style={{ fontSize: 12, color: "var(--muted, #8693a8)", fontFamily: "monospace" }}>{screen}</span>
        </div>

        {/* Screen content */}
        <div className="scrollbar-thin" style={{ flex: 1, overflow: "auto", padding: 28 }}>
          <React.Suspense fallback={
            <div style={{ display: "flex", alignItems: "center", justifyContent: "center", height: 300, color: "var(--muted)" }}>
              Загружаем экран…
            </div>
          }>
            {SCREEN_MAP[screen] || (
              <div style={{ textAlign: "center", padding: 60, color: "var(--muted)" }}>
                Экран <code>{screen}</code> не найден
              </div>
            )}
          </React.Suspense>
        </div>
      </div>

      {/* Modal host */}
      <ModalHost />
    </div>
  );
}
