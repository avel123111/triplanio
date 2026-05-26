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
