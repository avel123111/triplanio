import React from 'react';
import { Icon } from './icons';

// =====================================================================
// Shared components + mock data — converted from global scripts to ES modules
// =====================================================================

// ----- Avatar -----
const AVATAR_COLORS = [
  ["#2167e2", "#5a8ff0"], ["#c9603a", "#e08158"], ["#1f8a5b", "#4ab98a"],
  ["#9c4ad9", "#c66ce2"], ["#c98a1a", "#e0a64b"], ["#4a6cd9", "#7a92e8"],
  ["#a83e6a", "#c96792"], ["#3d8aa8", "#5fadc9"]
];
function hashStr(s) { let h = 0; for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) | 0; return Math.abs(h); }

export const Avatar = ({ name = "?", size, role, kind, photo, className = "" }) => {
  const initials = name.split(/\s+/).map(p => p[0]).join("").slice(0, 2).toUpperCase();
  if (kind === "ai") {
    return <div className={`avatar ${size ? "avatar--" + size : ""} avatar--ai ${className}`}>AI</div>;
  }
  if (kind === "placeholder") {
    return <div className={`avatar ${size ? "avatar--" + size : ""} avatar--placeholder ${className}`}>{initials}</div>;
  }
  const [a, b] = AVATAR_COLORS[hashStr(name) % AVATAR_COLORS.length];
  const style = photo
    ? { backgroundImage: `url(${photo})`, backgroundSize: "cover", backgroundPosition: "center" }
    : { background: `linear-gradient(135deg, ${a}, ${b})` };
  return (
    <div className={`avatar ${size ? "avatar--" + size : ""} ${className}`} style={style}>
      {!photo && initials}
    </div>
  );
};

// ----- AvatarStack -----
export const AvatarStack = ({ people = [], max = 4, size = "sm" }) => (
  <div className="avatar-stack">
    {people.slice(0, max).map((p, i) => <Avatar key={i} name={p.name} kind={p.kind} size={size} />)}
    {people.length > max && (
      <div className={`avatar avatar--${size}`} style={{ background: "var(--wash)", color: "var(--muted)", border: "1.5px solid var(--surface)" }}>
        +{people.length - max}
      </div>
    )}
  </div>
);

// ----- Severity message -----
export const Severity = ({ level = "info", title, children, action }) => (
  <div className={`sev sev--${level}`}>
    <span className="sev__icon">
      <Icon name={level === "info" ? "info" : level === "warning" ? "warning" : "error"} size={16} />
    </span>
    <div style={{ flex: 1 }}>
      {title && <div style={{ fontWeight: 600, marginBottom: 2 }}>{title}</div>}
      {children}
    </div>
    {action}
  </div>
);

// ----- Form Field -----
export const Field = ({ label, hint, sub, ai, error, children, required }) => (
  <div className={`field ${ai ? "field--ai" : ""} ${error ? "field--error" : ""}`}>
    {label && (
      <label className="field__label">
        {label}{required && <span style={{ color: "var(--danger)" }}>*</span>}
        {hint && <span className="muted" style={{ fontWeight: 400, fontSize: 11.5, marginLeft: 4 }}>· {hint}</span>}
      </label>
    )}
    {children}
    {sub && <span className="field__sub">{sub}</span>}
    {error && <span className="field__sub" style={{ color: "var(--danger)" }}>{error}</span>}
  </div>
);

// ----- Buttons -----
export const Btn = ({ variant = "ghost", size, icon, iconRight, block, disabled, children, onClick, className = "" }) => (
  <button
    className={`btn btn--${variant} ${size ? "btn--" + size : ""} ${block ? "btn--block" : ""} ${className}`}
    onClick={onClick}
    disabled={disabled}
  >
    {icon && <Icon name={icon} size={16} />}
    {children}
    {iconRight && <Icon name={iconRight} size={16} />}
  </button>
);

// ----- Badge -----
export const Badge = ({ variant = "", icon, dot, children }) => (
  <span className={`badge ${variant ? "badge--" + variant : ""}`}>
    {dot && <span className="dot" />}
    {icon && <Icon name={icon} size={11} />}
    {children}
  </span>
);

// ----- Card -----
export const Card = ({ variant = "", title, subtitle, action, children, className = "", style }) => (
  <div className={`card ${variant ? "card--" + variant : ""} ${className}`} style={style}>
    {(title || subtitle || action) && (
      <div className="card-h">
        <div style={{ flex: 1 }}>
          {title && <h3>{title}</h3>}
          {subtitle && <div className="muted" style={{ fontSize: 12.5 }}>{subtitle}</div>}
        </div>
        {action}
      </div>
    )}
    {children}
  </div>
);

// ----- Empty / Loading / Error states -----
export const EmptyState = ({ icon = "sparkles", title, body, action, kind = "empty" }) => (
  <div style={{
    display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center",
    padding: "48px 24px", textAlign: "center", color: "var(--muted)",
  }}>
    <div style={{
      width: 64, height: 64, borderRadius: 16,
      background: kind === "error" ? "var(--danger-soft)" : kind === "locked" ? "var(--warm-tint)" : "var(--brand-soft)",
      color: kind === "error" ? "var(--danger)" : kind === "locked" ? "var(--warm)" : "var(--brand)",
      display: "grid", placeItems: "center", marginBottom: 16,
    }}>
      <Icon name={icon} size={28} />
    </div>
    <h3 style={{ color: "var(--ink)", marginBottom: 6 }}>{title}</h3>
    <div style={{ maxWidth: 340, fontSize: 13.5, lineHeight: 1.5 }}>{body}</div>
    {action && <div style={{ marginTop: 18 }}>{action}</div>}
  </div>
);

// ----- Skeleton -----
export const Skeleton = ({ w = "100%", h = 14, r = 6, style }) => (
  <div style={{
    width: w, height: h, borderRadius: r,
    background: "linear-gradient(90deg, var(--line-2) 0%, var(--wash) 50%, var(--line-2) 100%)",
    backgroundSize: "200% 100%",
    animation: "shimmer 1.5s linear infinite",
    ...style,
  }} />
);

// ----- Toggle -----
export const Toggle = ({ on, onChange, locked, label }) => (
  <button
    onClick={() => !locked && onChange && onChange(!on)}
    style={{
      width: 36, height: 21, padding: 0, border: "none",
      borderRadius: 999,
      background: locked ? "var(--wash)" : on ? "var(--brand)" : "var(--line)",
      position: "relative", flexShrink: 0,
      opacity: locked ? 0.5 : 1, cursor: locked ? "not-allowed" : "pointer",
      transition: "background .15s ease",
    }}
    aria-label={label}
  >
    <span style={{
      position: "absolute", top: 2, left: on ? 17 : 2,
      width: 17, height: 17, borderRadius: "50%",
      background: "white", boxShadow: "0 1px 2px rgba(0,0,0,.2)",
      transition: "left .15s ease",
    }} />
  </button>
);

// ----- Currency formatting -----
export const fmt = (n, cur = "EUR") => {
  const symbol = { EUR: "€", USD: "$", RUB: "₽", GBP: "£" }[cur] || "";
  return symbol + Number(n).toLocaleString("ru-RU");
};

// ----- Mock data: the trip -----
export const TRIP = {
  id: "iberia-summer",
  title: "Иберия летом",
  cover: "linear-gradient(135deg, #2167e2 0%, #5a8ff0 50%, #c9603a 100%)",
  start: "12 июля",
  end: "23 июля",
  year: 2026,
  duration: "12 дней",
  cities: ["Лиссабон", "Порту", "Барселона"],
  travelers: 4,
  pro: true,
  role: "owner",
  budget: { spent: 4820, currency: "EUR", planned: 6800 },
  members: [
    { name: "Анна Лебедева", role: "owner", status: "active" },
    { name: "Игорь Мейзинский", role: "admin", status: "active" },
    { name: "Лена Краснова", role: "viewer", status: "active" },
    { name: "Миша Петров", role: "admin", status: "pending" },
  ],
};

export const TRIPS = [
  { ...TRIP, days: "12 → 23 июл · 2026", scope: "3 города · Португалия, Испания", role: "owner", pro: true, status: "future", coverHue: 210, accentHue: 18 },
  { id: "japan", title: "Япония по сакуре", days: "5 → 18 апр · 2026", scope: "5 городов · Япония", role: "admin", pro: true, status: "future", coverHue: 330, accentHue: 200 },
  { id: "balkans", title: "Балканский круг", days: "Без дат", scope: "7 городов · 4 страны", role: "owner", pro: false, status: "draft", coverHue: 150, accentHue: 35 },
  { id: "tbilisi", title: "Тбилиси на выходные", days: "21 → 24 фев · 2026", scope: "1 город · Грузия", role: "viewer", pro: false, status: "future" },
  { id: "morocco", title: "Марокко с детьми", days: "Сент 2025", scope: "4 города · Марокко", role: "owner", pro: true, status: "past", coverHue: 25, accentHue: 200 },
];

// ----- DismissibleSeverity -----
export const DismissibleSeverity = ({ level = "info", title, children, onDismiss, action }) => {
  const [open, setOpen] = React.useState(true);
  if (!open) return null;
  return (
    <div className={`sev sev--${level}`} style={{ position: "relative" }}>
      <span className="sev__icon">
        <Icon name={level === "info" ? "info" : level === "warning" ? "warning" : "error"} size={16} />
      </span>
      <div style={{ flex: 1, paddingRight: 28 }}>
        {title && <div style={{ fontWeight: 600, marginBottom: 2 }}>{title}</div>}
        {children}
        {action && <div style={{ marginTop: 8 }}>{action}</div>}
      </div>
      <button onClick={() => { setOpen(false); onDismiss?.(); }} style={{
        position: "absolute", top: 8, right: 8,
        width: 22, height: 22, borderRadius: 6, border: "none",
        background: "transparent", color: "var(--muted)", cursor: "pointer",
        display: "grid", placeItems: "center",
      }} title="Скрыть"
        onMouseEnter={(e) => e.currentTarget.style.background = "rgba(0,0,0,.05)"}
        onMouseLeave={(e) => e.currentTarget.style.background = "transparent"}>
        <Icon name="close" size={12} />
      </button>
    </div>
  );
};

// ----- RoleBadge with icon -----
export const RoleBadge = ({ role, size = "md", status }) => {
  const ROLE_META = {
    owner:  { icon: "crown",  label: "Владелец", color: "var(--warm)", soft: "var(--warm-tint)" },
    admin:  { icon: "shield", label: "Админ",    color: "var(--brand)", soft: "var(--brand-soft)" },
    viewer: { icon: "eye",    label: "Зритель",  color: "var(--muted)", soft: "var(--wash)" },
  };
  const m = ROLE_META[role] || ROLE_META.viewer;
  return (
    <span style={{
      display: "inline-flex", alignItems: "center", gap: 5,
      padding: size === "sm" ? "2px 7px 2px 5px" : "3px 9px 3px 6px",
      borderRadius: 999, background: m.soft, color: m.color,
      fontSize: size === "sm" ? 11 : 11.5, fontWeight: 500,
    }}>
      <Icon name={m.icon} size={size === "sm" ? 10 : 11} />
      {m.label}{status === "pending" && " · ожидает"}
    </span>
  );
};

// ----- WeatherChip -----
export const WeatherChip = ({ temp, condition, hour, size = "sm" }) => {
  const ICON = {
    sun: "sun", clear: "sun", cloud: "cloud", partly: "cloud-sun", rain: "rain", storm: "rain"
  };
  const COLOR = {
    sun: "#e0a64b", clear: "#e0a64b", cloud: "#8693a8", partly: "#5a8ff0", rain: "#3d8aa8", storm: "#6a3ee2"
  };
  return (
    <span className="num" style={{
      display: "inline-flex", alignItems: "center", gap: 4,
      padding: size === "xs" ? "1px 6px" : "2px 8px",
      borderRadius: 999, background: "var(--wash)", border: "1px solid var(--line-2)",
      fontSize: size === "xs" ? 10.5 : 11.5, color: "var(--ink-2)", fontWeight: 500,
    }}>
      <Icon name={ICON[condition] || "sun"} size={size === "xs" ? 10 : 11} style={{ color: COLOR[condition] || "#e0a64b" }} />
      {temp}°{hour && <span className="muted" style={{ fontWeight: 400 }}>· {hour}</span>}
    </span>
  );
};

// ----- City photo helper — uses gradient placeholder by city -----
const CITY_PHOTO = {
  "Лиссабон":  { hue1: 195, hue2: 30,  emoji: "🌊", label: "Лиссабон · Альфама" },
  "Порту":     { hue1: 30,  hue2: 200, emoji: "🍷", label: "Порту · Рибейра" },
  "Барселона": { hue1: 25,  hue2: 200, emoji: "⛪", label: "Барселона · Эшампле" },
  "Sintra":    { hue1: 280, hue2: 140, emoji: "🏰", label: "Sintra" },
  "Москва":    { hue1: 20,  hue2: 220, emoji: "🏛", label: "Москва" },
};

export const CityPhoto = ({ city, h = 80, w = "100%", radius = 10 }) => {
  const p = CITY_PHOTO[city] || { hue1: 210, hue2: 30, emoji: "📍", label: city };
  const isDark = document.documentElement.dataset.theme === "dark";
  return (
    <div style={{
      width: w, height: h, borderRadius: radius,
      background: `linear-gradient(135deg, hsl(${p.hue1}, 55%, ${isDark ? 32 : 65}%) 0%, hsl(${(p.hue1 + p.hue2) / 2}, 50%, ${isDark ? 24 : 55}%) 60%, hsl(${p.hue2}, 60%, ${isDark ? 38 : 70}%) 100%)`,
      position: "relative", overflow: "hidden", flexShrink: 0,
    }}>
      <svg viewBox="0 0 200 100" preserveAspectRatio="none" style={{ position: "absolute", inset: 0, width: "100%", height: "100%", opacity: 0.35 }}>
        <path d="M0 60 Q 50 40 100 55 T 200 50 L 200 100 L 0 100 Z" fill="rgba(255,255,255,.5)" />
        <path d="M0 75 Q 60 55 120 70 T 200 65 L 200 100 L 0 100 Z" fill="rgba(255,255,255,.3)" />
      </svg>
      <div style={{ position: "absolute", top: 6, left: 8, fontSize: 18 }}>{p.emoji}</div>
    </div>
  );
};

// =====================================================================
// MODAL HOST — manages a stack of modal dialogs
// =====================================================================
export function ModalHost() {
  const [stack, setStack] = React.useState([]);
  React.useEffect(() => {
    window.__openModal = (content) => setStack(s => [...s, content]);
    window.__closeModal = () => setStack(s => s.slice(0, -1));
    window.__closeAllModals = () => setStack([]);
  }, []);
  if (stack.length === 0) return null;
  return stack.map((content, i) => (
    <div key={i} className="dlg-backdrop"
      onClick={(e) => { if (e.target === e.currentTarget) setStack(s => s.slice(0, -1)); }}
      style={{ zIndex: 200 + i * 10 }}
    >
      {content}
    </div>
  ));
}

// ---- Dialog primitive ----
export const Dialog = ({ title, icon, onClose, size, children, foot }) => (
  <div className={`dlg ${size ? "dlg--" + size : ""}`}>
    <div className="dlg__head">
      {icon && (
        <div style={{ width: 36, height: 36, borderRadius: 9, background: "var(--brand-soft)", color: "var(--brand)", display: "grid", placeItems: "center", flexShrink: 0 }}>
          <Icon name={icon} size={17} />
        </div>
      )}
      <h2>{title}</h2>
      <button className="icon-btn" onClick={() => { onClose?.(); window.__closeModal?.(); }}>
        <Icon name="close" size={16} />
      </button>
    </div>
    <div className="dlg__body">{children}</div>
    {foot && <div className="dlg__foot">{foot}</div>}
  </div>
);

// ---- Partner logo helper ----
const PARTNERS = {
  "booking.com":   { color: "#003580", label: "Booking",     short: "B" },
  "airbnb":        { color: "#ff385c", label: "Airbnb",      short: "A" },
  "marriott":      { color: "#a8945c", label: "Marriott",    short: "M" },
  "agoda":         { color: "#fe424d", label: "Agoda",       short: "A" },
  "renfe":         { color: "#7a1f3a", label: "Renfe",       short: "R" },
  "cp.pt":         { color: "#2f6ba8", label: "CP",          short: "CP" },
  "lufthansa":     { color: "#05164d", label: "Lufthansa",   short: "L" },
  "tap":           { color: "#c81f3a", label: "TAP",         short: "T" },
  "expedia":       { color: "#fcc60a", label: "Expedia",     short: "E" },
  "rentalcars":    { color: "#222e72", label: "RentalCars",  short: "R" },
  "sixt":          { color: "#ff6600", label: "Sixt",        short: "S" },
  "holafly":       { color: "#5ac6c1", label: "Holafly",     short: "H" },
};

export function detectPartner(url) {
  if (!url) return null;
  const u = url.toLowerCase();
  for (const [k, v] of Object.entries(PARTNERS)) {
    if (u.includes(k)) return { key: k, ...v };
  }
  return null;
}

export const PartnerLogo = ({ url, size = 18 }) => {
  const p = detectPartner(url);
  if (!p) return (
    <div style={{ width: size, height: size, borderRadius: 4, background: "var(--line)", color: "var(--muted)", display: "grid", placeItems: "center", fontSize: size * 0.55, fontWeight: 700 }}>
      <Icon name="link" size={size * 0.6} />
    </div>
  );
  return (
    <div style={{ width: size, height: size, borderRadius: 4, background: p.color, color: "white", display: "grid", placeItems: "center", fontSize: size * 0.5, fontWeight: 700, flexShrink: 0 }}>
      {p.short}
    </div>
  );
};

export const PartnerPill = ({ url, fallback = "Ссылка" }) => {
  const p = detectPartner(url);
  return (
    <span className="partner-pill">
      <PartnerLogo url={url} size={16} />
      {p?.label || fallback}
    </span>
  );
};

// =====================================================================
// BOOKING SUGGESTION CARD — used by AI in chats
// =====================================================================
export function BookingSuggestionCard({ type, name, partner, url, price, cur, rating, sub, extras }) {
  const p = detectPartner(url || partner);
  return (
    <div style={{
      background: "var(--surface)",
      border: "1.5px solid var(--ai-soft-12)",
      borderRadius: 12, padding: 12,
      display: "flex", gap: 12, maxWidth: 360,
    }}>
      <div style={{ width: 48, height: 48, borderRadius: 8, background: p?.color || "var(--brand)", color: "white", display: "grid", placeItems: "center", flexShrink: 0, fontSize: 18, fontWeight: 700 }}>
        <Icon name={type === "hotel" ? "bed" : type === "flight" ? "plane" : type === "train" ? "train" : "spark"} size={20} />
      </div>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ fontWeight: 600, fontSize: 13.5, marginBottom: 2 }}>{name}</div>
        <div className="muted" style={{ fontSize: 12 }}>{sub}</div>
        {rating && (
          <div style={{ marginTop: 4, display: "flex", alignItems: "center", gap: 5, fontSize: 11.5 }}>
            <Badge variant="success">{rating}/10</Badge>
            <span className="muted">{p?.label || partner}</span>
          </div>
        )}
        {extras && (
          <div style={{ marginTop: 6, display: "flex", flexWrap: "wrap", gap: 4 }}>
            {extras.map((e, i) => <Badge key={i} variant="quiet">{e}</Badge>)}
          </div>
        )}
        <div style={{ display: "flex", alignItems: "center", gap: 8, marginTop: 8 }}>
          <div className="num" style={{ fontWeight: 600, fontSize: 15 }}>{fmt(price, cur)}</div>
          <div style={{ flex: 1 }} />
          <Btn variant="ghost" size="sm" icon="external">{p?.label || "Открыть"}</Btn>
        </div>
      </div>
    </div>
  );
}

// =====================================================================
// SHARED TIMELINE UTILITIES — exported so all screens can use them
// =====================================================================

// ----- Utility: group event stream by date -----
export function groupByDate(events) {
  const groups = {};
  for (const e of events) {
    if (!groups[e.date]) groups[e.date] = [];
    groups[e.date].push(e);
  }
  return Object.entries(groups).map(([date, items]) => ({ date, items }));
}

const _WEEKDAYS = ["Вс", "Пн", "Вт", "Ср", "Чт", "Пт", "Сб"];
const _MONTHS = ["янв", "фев", "мар", "апр", "мая", "июн", "июл", "авг", "сен", "окт", "ноя", "дек"];

export function fmtDate(iso) {
  const d = new Date(iso + "T00:00:00");
  return `${d.getDate()} ${_MONTHS[d.getMonth()]}`;
}

export function weekday(iso) {
  return _WEEKDAYS[new Date(iso + "T00:00:00").getDay()];
}

// ----- Mock event stream -----
export const STREAM = [
  { type: "hotel-deadline", id: "d1", date: "2026-07-09", time: "23:59", city: "Лиссабон", title: "Дедлайн бесплатной отмены · Memmo Alfama",
    hotel: "Memmo Alfama", price: 880, cur: "EUR", note: "После — невозвратно. Решить сейчас, ехать ли." },
  { type: "flight", id: "f0", date: "2026-07-12", time: "08:35", duration: "4ч 25м", title: "TAP TP 1245",
    from: "SVO", to: "LIS", kind: "plane", carrier: "TAP Portugal", num: "TP 1245", price: 544, cur: "EUR",
    platformUrl: "https://tap.com", depart_loc: "Шереметьево T-D", arrive_loc: "Лиссабон-Портела" },
  { type: "hotel-checkin", id: "h1-in", date: "2026-07-12", time: "15:00", city: "Лиссабон", title: "Заезд · Memmo Alfama",
    hotelId: "h1", hotel: "Memmo Alfama", address: "Travessa das Merceeiras 27", price: 880, cur: "EUR", nights: 4,
    platformUrl: "https://booking.com/h/memmo", num: "BKN-72931" },
  { type: "activity", id: "a1", date: "2026-07-13", time: "10:00", duration: "1ч", city: "Лиссабон",
    title: "Завтрак · Pastéis de Belém", price: 24, cur: "EUR", category: "food", address: "R. de Belém 84-92" },
  { type: "activity", id: "a2", date: "2026-07-13", time: "14:00", duration: "2ч 30м", city: "Лиссабон",
    title: "Castelo de São Jorge", price: 30, cur: "EUR", category: "sight", address: "R. de Santa Cruz" },
  { type: "activity", id: "a3", date: "2026-07-14", time: "10:00", duration: "8ч", city: "Sintra",
    title: "Винный тур в Sintra", price: 145, cur: "EUR", category: "experience", address: "Sintra, Portugal · трансфер из отеля" },
  { type: "hotel-checkout", id: "h1-out", date: "2026-07-16", time: "11:00", city: "Лиссабон", title: "Выезд · Memmo Alfama", hotelId: "h1" },
  { type: "activity", id: "a-train-lunch", date: "2026-07-16", time: "13:00", duration: "1ч", city: "в пути",
    title: "Обед перед поездом · Time Out Market", price: 28, cur: "EUR", category: "food", address: "Av. 24 de Julho, Lisboa" },
  { type: "transfer", id: "t1", date: "2026-07-16", time: "14:25", duration: "3ч 15м", title: "CP IC 521",
    from: "Lisboa Oriente", to: "Porto Campanhã", from_city: "Лиссабон", to_city: "Порту",
    kind: "train", carrier: "Comboios CP", num: "IC 521", price: 36, cur: "EUR", platformUrl: "https://cp.pt" },
  { type: "hotel-checkin", id: "h2-in", date: "2026-07-16", time: "18:30", city: "Порту",
    title: "Заезд · Torel Avantgarde", hotelId: "h2", hotel: "Torel Avantgarde", address: "Rua da Restauração 336",
    price: 720, cur: "EUR", nights: 3, platformUrl: "https://booking.com/h/torel", num: "BKN-72932" },
  { type: "activity", id: "a4", date: "2026-07-17", time: "16:00", duration: "2ч", city: "Порту",
    title: "Дегустация в погребе Sandeman", price: 65, cur: "EUR", category: "experience",
    address: "Largo Miguel Bombarda, Vila Nova de Gaia" },
  { type: "transfer-missing", id: "tm1", date: "2026-07-19", time: "?", from: "Порту", to: "Барселона",
    title: "Нет переезда · добавить" },
  { type: "hotel-checkout", id: "h2-out", date: "2026-07-19", time: "11:00", city: "Порту", title: "Выезд · Torel Avantgarde", hotelId: "h2" },
  { type: "hotel-checkin", id: "h3-in", date: "2026-07-19", time: "16:00", city: "Барселона",
    title: "Заезд · Cotton House", hotelId: "h3", hotel: "Cotton House", address: "Gran Via 670",
    price: 1340, cur: "EUR", nights: 4, num: "—" },
  { type: "car-pickup", id: "cp1", date: "2026-07-19", time: "17:30", city: "Барселона", title: "Получение авто · Sixt",
    address: "Барселона аэропорт T1", platformUrl: "https://sixt.com" },
  { type: "activity", id: "a5", date: "2026-07-20", time: "10:25", duration: "1ч 35м", city: "Барселона",
    title: "Sagrada Família", price: 33, cur: "EUR", category: "sight", address: "C/ Mallorca 401" },
  { type: "activity", id: "a6", date: "2026-07-21", city: "Барселона",
    title: "Парк Гуэль", price: 18, cur: "EUR", category: "sight",
    warning: "Не указано время — желательно поставить", address: "C/ Olot, 5" },
  { type: "hotel-checkout", id: "h3-out", date: "2026-07-23", time: "12:00", city: "Барселона", title: "Выезд · Cotton House", hotelId: "h3" },
  { type: "car-return", id: "cr1", date: "2026-07-23", time: "13:00", city: "Барселона", title: "Возврат авто · Sixt",
    address: "Барселона аэропорт T1", platformUrl: "https://sixt.com" },
  { type: "flight", id: "f1", date: "2026-07-23", time: "15:40", duration: "5ч 30м", title: "Lufthansa LH 1731",
    from: "BCN", to: "SVO", from_city: "Барселона", to_city: "Москва",
    kind: "plane", carrier: "Lufthansa", num: "LH 1731", price: 412, cur: "EUR",
    platformUrl: "https://lufthansa.com" }
];

// ----- Transfer card helpers -----
const TRANSFER_KIND_META = {
  plane: { icon: "plane", label: "Перелёт" },
  train: { icon: "train", label: "Поезд" },
  bus:   { icon: "bus",   label: "Автобус" },
  ferry: { icon: "ferry", label: "Паром" },
  car:   { icon: "car",   label: "На авто" },
  walk:  { icon: "walk",  label: "Пешком" },
  foot:  { icon: "walk",  label: "Пешком" },
  bike:  { icon: "walk",  label: "Велосипед" }
};

function _transferMeta(e) {
  return TRANSFER_KIND_META[e.kind] || TRANSFER_KIND_META.car;
}

function _addDuration(time, dur) {
  if (!time || !dur) return null;
  const [h, m] = time.split(":").map(Number);
  const hm = dur.match(/(\d+)ч/);
  const mm = dur.match(/(\d+)м/);
  const dh = hm ? +hm[1] : 0;
  const dm = mm ? +mm[1] : 0;
  let nh = h + dh, nm = m + dm;
  nh += Math.floor(nm / 60); nm %= 60; nh %= 24;
  return `${String(nh).padStart(2, "0")}:${String(nm).padStart(2, "0")}`;
}

function TransferCardHub({ e, onClick }) {
  const meta = _transferMeta(e);
  const arriveTime = e.arrive_time || _addDuration(e.time, e.duration) || "—";
  return (
    <button onClick={onClick} style={{
      width: "100%", display: "grid", gridTemplateColumns: "auto 1fr auto 1fr auto", gap: 14,
      alignItems: "center", padding: "14px 16px", background: "var(--surface)",
      border: "1px solid var(--line)", borderLeft: "3px solid var(--ev-transfer)",
      borderRadius: 12, cursor: "pointer", textAlign: "left"
    }}
    onMouseEnter={(ev) => { ev.currentTarget.style.borderColor = "#dbe1ec"; ev.currentTarget.style.borderLeftColor = "var(--ev-transfer)"; ev.currentTarget.style.transform = "translateY(-1px)"; ev.currentTarget.style.boxShadow = "var(--shadow-soft)"; }}
    onMouseLeave={(ev) => { ev.currentTarget.style.borderColor = "var(--line)"; ev.currentTarget.style.borderLeftColor = "var(--ev-transfer)"; ev.currentTarget.style.transform = ""; ev.currentTarget.style.boxShadow = ""; }}>
      <div style={{ width: 36, height: 36, borderRadius: 9, background: "var(--ev-transfer-soft)", color: "var(--ev-transfer)", display: "grid", placeItems: "center", flexShrink: 0 }}>
        <Icon name={meta.icon} size={17} />
      </div>
      <div>
        <div className="num" style={{ fontFamily: "var(--font-display)", fontSize: 20, fontWeight: 700, letterSpacing: "-0.02em", lineHeight: 1 }}>{e.time}</div>
        <div style={{ fontSize: 12.5, fontWeight: 600, marginTop: 4 }}>{e.from}</div>
        {e.depart_loc && <div className="muted" style={{ fontSize: 11 }}>{e.depart_loc}</div>}
      </div>
      <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 4, minWidth: 80 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 4, width: "100%" }}>
          <div style={{ height: 1, flex: 1, borderTop: "1.5px dashed var(--ev-transfer)" }} />
          <span className="muted num" style={{ fontSize: 10.5, whiteSpace: "nowrap" }}>{e.duration}</span>
          <div style={{ height: 1, flex: 1, borderTop: "1.5px dashed var(--ev-transfer)" }} />
        </div>
        <div className="muted" style={{ fontSize: 10.5, textAlign: "center" }}>
          {e.carrier}{e.num && e.num !== "—" ? <> · <span className="num">{e.num}</span></> : null}
        </div>
      </div>
      <div style={{ textAlign: "right" }}>
        <div className="num" style={{ fontFamily: "var(--font-display)", fontSize: 20, fontWeight: 700, letterSpacing: "-0.02em", lineHeight: 1 }}>{arriveTime}</div>
        <div style={{ fontSize: 12.5, fontWeight: 600, marginTop: 4 }}>{e.to}</div>
        {e.arrive_loc && <div className="muted" style={{ fontSize: 11 }}>{e.arrive_loc}</div>}
      </div>
      <div style={{ textAlign: "right", borderLeft: "1px solid var(--line-2)", paddingLeft: 14, minWidth: 80 }}>
        {e.price && <div className="num" style={{ fontWeight: 600, fontSize: 15 }}>{fmt(e.price, e.cur)}</div>}
        {e.platformUrl && <div style={{ marginTop: 4 }}><PartnerPill url={e.platformUrl} /></div>}
      </div>
    </button>
  );
}

function TransferCardStrip({ e, onClick }) {
  const meta = _transferMeta(e);
  return (
    <button onClick={onClick} style={{
      width: "100%", display: "flex", alignItems: "center", gap: 14,
      padding: "12px 14px", background: "var(--surface)",
      border: "1px solid var(--line)", borderLeft: "3px solid var(--ev-transfer)",
      borderRadius: 12, cursor: "pointer", textAlign: "left"
    }}
    onMouseEnter={(ev) => { ev.currentTarget.style.borderColor = "#dbe1ec"; ev.currentTarget.style.borderLeftColor = "var(--ev-transfer)"; ev.currentTarget.style.transform = "translateY(-1px)"; ev.currentTarget.style.boxShadow = "var(--shadow-soft)"; }}
    onMouseLeave={(ev) => { ev.currentTarget.style.borderColor = "var(--line)"; ev.currentTarget.style.borderLeftColor = "var(--ev-transfer)"; ev.currentTarget.style.transform = ""; ev.currentTarget.style.boxShadow = ""; }}>
      <div className="num" style={{ fontFamily: "var(--font-display)", fontSize: 16, fontWeight: 700, letterSpacing: "-0.01em", minWidth: 52, color: "var(--ink)" }}>{e.time || "—"}</div>
      <div style={{ width: 32, height: 32, borderRadius: 8, background: "var(--ev-transfer-soft)", color: "var(--ev-transfer)", display: "grid", placeItems: "center", flexShrink: 0 }}>
        <Icon name={meta.icon} size={15} />
      </div>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 2, flexWrap: "wrap" }}>
          <span style={{ fontSize: 13.5, fontWeight: 600 }}>{meta.label}</span>
          <span className="muted" style={{ fontSize: 12.5 }}>
            {e.from_city || e.from} <Icon name="arrowR" size={10} style={{ verticalAlign: -1, color: "var(--muted-2)" }} /> {e.to_city || e.to}
          </span>
        </div>
        <div className="muted" style={{ fontSize: 12, display: "flex", flexWrap: "wrap", gap: 8 }}>
          {e.duration && <span className="num">{e.duration}</span>}
          {e.carrier && <span>· {e.carrier}{e.num && e.num !== "—" ? <> · <span className="num">{e.num}</span></> : null}</span>}
          {e.platformUrl && <PartnerPill url={e.platformUrl} />}
        </div>
      </div>
      {e.price && <span className="num" style={{ fontWeight: 600, fontSize: 14 }}>{fmt(e.price, e.cur)}</span>}
    </button>
  );
}

function TransferCardStacked({ e, onClick }) {
  const meta = _transferMeta(e);
  const arriveTime = e.arrive_time || _addDuration(e.time, e.duration) || "—";
  return (
    <button onClick={onClick} style={{
      width: "100%", display: "flex", alignItems: "center", gap: 14,
      padding: "14px 16px", background: "var(--surface)",
      border: "1px solid var(--line)", borderLeft: "3px solid var(--ev-transfer)",
      borderRadius: 12, cursor: "pointer", textAlign: "left"
    }}
    onMouseEnter={(ev) => { ev.currentTarget.style.borderColor = "#dbe1ec"; ev.currentTarget.style.borderLeftColor = "var(--ev-transfer)"; ev.currentTarget.style.transform = "translateY(-1px)"; ev.currentTarget.style.boxShadow = "var(--shadow-soft)"; }}
    onMouseLeave={(ev) => { ev.currentTarget.style.borderColor = "var(--line)"; ev.currentTarget.style.borderLeftColor = "var(--ev-transfer)"; ev.currentTarget.style.transform = ""; ev.currentTarget.style.boxShadow = ""; }}>
      <div style={{ width: 44, height: 44, borderRadius: 11, background: "var(--ev-transfer-soft)", color: "var(--ev-transfer)", display: "grid", placeItems: "center", flexShrink: 0 }}>
        <Icon name={meta.icon} size={20} />
      </div>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div className="eyebrow" style={{ marginBottom: 4, color: "var(--ev-transfer)" }}>
          {meta.label} · <span className="num">{e.duration}</span>
        </div>
        <div style={{ display: "flex", alignItems: "baseline", gap: 8, flexWrap: "wrap" }}>
          <span className="num" style={{ fontFamily: "var(--font-display)", fontSize: 18, fontWeight: 700, letterSpacing: "-0.02em" }}>{e.time}</span>
          <Icon name="arrowR" size={12} style={{ color: "var(--muted-2)" }} />
          <span className="num" style={{ fontFamily: "var(--font-display)", fontSize: 18, fontWeight: 700, letterSpacing: "-0.02em" }}>{arriveTime}</span>
          <span style={{ fontSize: 13, fontWeight: 600 }}>· {e.to_city || e.to}</span>
        </div>
        <div className="muted" style={{ fontSize: 12, marginTop: 2, display: "flex", flexWrap: "wrap", gap: 8 }}>
          <span>из {e.from_city || e.from}</span>
          {e.carrier && <span>· {e.carrier}{e.num && e.num !== "—" ? <> · <span className="num">{e.num}</span></> : null}</span>}
          {e.platformUrl && <PartnerPill url={e.platformUrl} />}
        </div>
      </div>
      {e.price && <div style={{ textAlign: "right", flexShrink: 0 }}><div className="num" style={{ fontWeight: 600, fontSize: 15 }}>{fmt(e.price, e.cur)}</div></div>}
    </button>
  );
}

export function StreamEventRow({ e, onClick, last, editMode }) {
  if (e.type === "transfer-missing") {
    const [hidden, setHidden] = React.useState(false);
    if (hidden) return null;
    return (
      <div style={{ width: "100%", display: "flex", alignItems: "center", gap: 12, padding: "12px 14px", background: "var(--warning-soft)", border: "1.5px dashed var(--warning)", borderRadius: 12, textAlign: "left" }}>
        <Icon name="warning" size={16} style={{ color: "var(--warning)" }} />
        <div style={{ flex: 1, fontSize: 13.5, fontWeight: 600 }}>Нет переезда · {e.from} → {e.to}</div>
        <Btn variant="primary" size="sm" icon="plus" onClick={onClick}>Добавить переезд</Btn>
        <button onClick={() => setHidden(true)} title="Скрыть варнинг" style={{ width: 24, height: 24, borderRadius: 6, border: "none", background: "transparent", color: "var(--warning)", cursor: "pointer", display: "grid", placeItems: "center" }}>
          <Icon name="close" size={12} />
        </button>
      </div>
    );
  }
  if (e.type === "flight" || e.type === "transfer") {
    const variant = window.__transferCardVariant || "V1";
    if (variant === "V2") return <TransferCardStrip e={e} onClick={onClick} />;
    if (variant === "V3") return <TransferCardStacked e={e} onClick={onClick} />;
    return <TransferCardHub e={e} onClick={onClick} />;
  }
  const META = {
    "hotel-checkin":  { icon: "bed",     c: "var(--ev-hotel)",    bg: "var(--ev-hotel-soft)",    label: "Заезд" },
    "hotel-checkout": { icon: "bed",     c: "var(--ev-hotel)",    bg: "var(--ev-hotel-soft)",    label: "Выезд" },
    "hotel-deadline": { icon: "warning", c: "var(--ev-deadline)", bg: "var(--ev-deadline-soft)", label: "Дедлайн" },
    "activity": {
      icon: e.category === "food" ? "cup" : e.category === "sight" ? "cam" : "spark",
      c: "var(--ev-activity)", bg: "var(--ev-activity-soft)"
    },
    "car-pickup": { icon: "car", c: "var(--ev-car)", bg: "var(--ev-car-soft)" },
    "car-return": { icon: "car", c: "var(--ev-car)", bg: "var(--ev-car-soft)" }
  };
  const meta = META[e.type] || { icon: "spark", c: "var(--ink)", bg: "var(--wash)" };
  const isCheckin = e.type === "hotel-checkin" || e.type === "hotel-checkout";
  return (
    <button onClick={onClick} style={{ width: "100%", display: "flex", alignItems: "center", gap: 14, padding: "12px 14px", background: "var(--surface)", border: "1px solid var(--line)", borderLeft: `3px solid ${meta.c}`, borderRadius: 12, cursor: "pointer", textAlign: "left" }}
      onMouseEnter={(ev) => { ev.currentTarget.style.borderColor = "#dbe1ec"; ev.currentTarget.style.borderLeftColor = meta.c; ev.currentTarget.style.transform = "translateY(-1px)"; ev.currentTarget.style.boxShadow = "var(--shadow-soft)"; }}
      onMouseLeave={(ev) => { ev.currentTarget.style.borderColor = "var(--line)"; ev.currentTarget.style.borderLeftColor = meta.c; ev.currentTarget.style.transform = ""; ev.currentTarget.style.boxShadow = ""; }}>
      <div className="num" style={{ fontFamily: "var(--font-display)", fontSize: 16, fontWeight: 700, letterSpacing: "-0.01em", minWidth: 52, color: e.time === "?" ? "var(--warning)" : "var(--ink)" }}>
        {e.time || "—"}
      </div>
      <div style={{ width: 32, height: 32, borderRadius: 8, background: meta.bg, color: meta.c, display: "grid", placeItems: "center", flexShrink: 0 }}>
        <Icon name={meta.icon} size={15} />
      </div>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 2, flexWrap: "wrap" }}>
          <span style={{ fontSize: 13.5, fontWeight: 600 }}>{e.title}</span>
          {e.warning && <Badge variant="warning" icon="warning">Нет времени</Badge>}
          {isCheckin && <Badge variant="success">{meta.label}</Badge>}
        </div>
        <div className="muted" style={{ fontSize: 12, display: "flex", flexWrap: "wrap", alignItems: "center", gap: 8 }}>
          {e.duration && <span className="num">{e.duration}</span>}
          {e.address && <span>· {e.address}</span>}
          {e.platformUrl && <PartnerPill url={e.platformUrl} />}
        </div>
      </div>
      {e.price && <span className="num" style={{ fontWeight: 600, fontSize: 14 }}>{fmt(e.price, e.cur)}</span>}
    </button>
  );
}

// =====================================================================
// TRIP IDENTITY STRIP — exported so all screens can use it
// =====================================================================

function _InfoChip({ icon, color, children }) {
  return (
    <span style={{ display: "inline-flex", alignItems: "center", gap: 6, padding: "5px 10px 5px 8px", borderRadius: 999, background: "var(--wash)", border: "1px solid var(--line-2)", fontSize: 12.5, color: "var(--ink-2)", fontWeight: 500 }}>
      <Icon name={icon} size={13} style={{ color }} />
      {children}
    </span>
  );
}

function _RoutePopover({ cities, onClose }) {
  React.useEffect(() => {
    const fn = () => onClose?.();
    setTimeout(() => document.addEventListener("click", fn, { once: true }), 0);
    return () => document.removeEventListener("click", fn);
  }, [onClose]);
  return (
    <div onClick={(e) => e.stopPropagation()} style={{ position: "absolute", top: "calc(100% + 6px)", left: 0, minWidth: 220, zIndex: 30, background: "var(--surface)", border: "1px solid var(--line)", borderRadius: 12, boxShadow: "var(--shadow-pop)", padding: 10 }}>
      <div className="eyebrow" style={{ marginBottom: 8 }}>Маршрут</div>
      <div style={{ display: "flex", flexDirection: "column", gap: 4, position: "relative" }}>
        <div style={{ position: "absolute", left: 10, top: 8, bottom: 8, width: 2, background: "var(--line)" }} />
        {cities.map((c, i) => (
          <div key={c} style={{ display: "flex", alignItems: "center", gap: 10, padding: "6px 6px 6px 28px", position: "relative" }}>
            <span style={{ position: "absolute", left: 4, top: "50%", transform: "translateY(-50%)", width: 14, height: 14, borderRadius: "50%", background: "var(--brand)", color: "white", fontSize: 9, fontWeight: 700, display: "grid", placeItems: "center", zIndex: 1 }}>{i + 1}</span>
            <div style={{ flex: 1, fontSize: 13, fontWeight: 500 }}>{c}</div>
          </div>
        ))}
      </div>
      <button onClick={() => { onClose?.(); window.__navigate?.("map"); }} style={{ marginTop: 6, padding: "6px 10px", width: "100%", textAlign: "center", background: "var(--brand-soft)", border: "none", color: "var(--brand)", borderRadius: 8, fontSize: 12, fontWeight: 600, cursor: "pointer" }}>
        Открыть на карте →
      </button>
    </div>
  );
}

export function TripIdentityStrip({ compact }) {
  const userHasSub = window.__userHasSub ?? true;
  const tripIsPro = window.__tripIsPro ?? true;
  const showCover = window.__tripShowCover ?? true;
  const editMode = window.__tripEditMode ?? false;
  const [routeOpen, setRouteOpen] = React.useState(false);
  const cities = TRIP.cities;

  return (
    <div style={{ marginBottom: 22, borderBottom: "1px solid var(--line-2)", paddingBottom: compact ? 16 : 22, paddingTop: compact ? 0 : 4 }}>
      {showCover && !compact && (
        <div style={{ position: "relative", marginBottom: 18, height: 160, borderRadius: 16, overflow: "hidden", background: "linear-gradient(135deg, hsl(210, 60%, 55%) 0%, hsl(195, 55%, 50%) 40%, hsl(25, 65%, 60%) 100%)" }}>
          <svg viewBox="0 0 800 200" preserveAspectRatio="none" style={{ position: "absolute", inset: 0, width: "100%", height: "100%", opacity: 0.55 }}>
            <path d="M0 130 Q 200 80 400 110 T 800 95 L 800 200 L 0 200 Z" fill="rgba(255,255,255,.55)" />
            <path d="M0 160 Q 250 110 450 140 T 800 130 L 800 200 L 0 200 Z" fill="rgba(255,255,255,.32)" />
            <circle cx="680" cy="50" r="28" fill="rgba(255,255,255,.65)" />
          </svg>
          <div style={{ position: "absolute", inset: 0, background: "linear-gradient(180deg, transparent 30%, rgba(0,0,0,.35) 100%)" }} />
          <div style={{ position: "absolute", left: 22, right: 22, bottom: 18, display: "flex", justifyContent: "space-between", alignItems: "flex-end", gap: 16 }}>
            <div style={{ minWidth: 0 }}>
              <div style={{ color: "white", fontFamily: "var(--font-display)", fontWeight: 700, fontSize: "clamp(26px, 4vw, 38px)", letterSpacing: "-0.03em", lineHeight: 1, textShadow: "0 2px 12px rgba(0,0,0,.3)" }}>{TRIP.title}</div>
              <div className="num" style={{ color: "rgba(255,255,255,.85)", fontSize: 13, marginTop: 8, fontWeight: 500 }}>{TRIP.start} → {TRIP.end} · {TRIP.year} · {TRIP.duration}</div>
            </div>
            <div style={{ display: "flex", gap: 6, flexShrink: 0 }}>
              {tripIsPro && !userHasSub && <span style={{ background: "rgba(255,255,255,.92)", color: "var(--warm)", padding: "4px 10px", borderRadius: 999, fontSize: 11, fontWeight: 700, letterSpacing: ".04em" }}>PRO</span>}
            </div>
          </div>
        </div>
      )}
      <div style={{ display: "flex", flexWrap: "wrap", gap: 18, alignItems: "flex-start", justifyContent: "space-between" }}>
        <div style={{ minWidth: 0, flex: "1 1 320px" }}>
          <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: showCover ? 0 : 8, flexWrap: "wrap" }}>
            <RoleBadge role={TRIP.role} />
            {!tripIsPro && !userHasSub && <Badge variant="quiet">Free</Badge>}
            {tripIsPro && !userHasSub && !showCover && <Badge variant="warm" icon="pro">Pro · этот трип</Badge>}
          </div>
          {!showCover && <h1 style={{ fontSize: compact ? 26 : 34, marginBottom: 6, marginTop: 4, letterSpacing: "-0.025em" }}>{TRIP.title}</h1>}
          {!showCover && (
            <div className="num" style={{ fontSize: 14, color: "var(--muted)", marginBottom: 14, display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
              <Icon name="calendar" size={13} style={{ color: "var(--muted-2)" }} />
              <span>{TRIP.start} → {TRIP.end} · {TRIP.year}</span>
              <span style={{ color: "var(--muted-2)" }}>·</span>
              <span>{TRIP.duration}</span>
            </div>
          )}
          <div style={{ display: "flex", flexWrap: "wrap", gap: 8, alignItems: "center", marginTop: showCover ? 14 : 0 }}>
            <span style={{ position: "relative", display: "inline-flex" }}>
              <button onClick={() => setRouteOpen(!routeOpen)} style={{ display: "inline-flex", alignItems: "center", gap: 6, padding: "5px 10px 5px 8px", borderRadius: 999, background: "var(--brand-soft)", border: "1px solid var(--brand-soft-12)", fontSize: 12.5, color: "var(--brand)", fontWeight: 600, cursor: "pointer" }}>
                <Icon name="pin" size={13} />
                {cities.length} {cities.length === 1 ? "город" : cities.length < 5 ? "города" : "городов"}
                <Icon name={routeOpen ? "chevD" : "chev"} size={11} />
              </button>
              {routeOpen && <_RoutePopover cities={cities} onClose={() => setRouteOpen(false)} />}
            </span>
            <_InfoChip icon="users" color="var(--success)">{TRIP.travelers} участника</_InfoChip>
          </div>
        </div>
        <div style={{ display: "flex", gap: 6, alignItems: "center", flexWrap: "wrap", flexShrink: 0 }}>
          {TRIP.role !== "viewer" && (
            editMode
              ? <Btn variant="primary" size="sm" icon="check" onClick={() => { window.__tripEditMode = false; window.dispatchEvent(new Event("__tweak")); }}>Готово</Btn>
              : <Btn variant="ghost" size="sm" icon="edit" onClick={() => { window.__tripEditMode = true; window.dispatchEvent(new Event("__tweak")); }}>Редактировать</Btn>
          )}
          <Btn variant="ghost" size="sm" icon="share" onClick={() => window.__openModal?.(<window.ShareDialog />)}>Поделиться</Btn>
          <Btn variant="ghost" size="sm" icon="download" onClick={() => window.__openModal?.(<window.ExportDialog />)}>Экспорт</Btn>
          <Btn variant="ghost" size="sm" icon="more" onClick={() => window.__openModal?.(<window.MoreMenuDialog />)} />
        </div>
      </div>
    </div>
  );
}
