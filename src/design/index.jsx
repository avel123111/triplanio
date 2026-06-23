import React from 'react';
import { Dialog as UIDialog, DialogContent } from '@/components/ui/dialog';
import { Icon } from './icons';
import { useT } from '@/lib/i18n/I18nContext';
import { avatarGradient } from '@/lib/avatarRamp';
import { fmtMoneyActive } from '@/lib/i18n/format';

// =====================================================================
// Shared components + mock data - converted from global scripts to ES modules
// =====================================================================

// ----- Avatar ----- (colours: src/lib/avatarRamp.js — single source)
export const Avatar = ({ name = "?", size, role, kind, photo, deleted, className = "", style: styleProp }) => {
  const initials = name.split(/\s+/).map(p => p[0]).join("").slice(0, 2).toUpperCase();
  if (deleted) {
    return <div className={`avatar ${size ? "avatar--" + size : ""} avatar--deleted ${className}`} style={styleProp} aria-label="Deleted account"><Icon name="user" size={size === "lg" ? 18 : size === "xl" ? 26 : size === "sm" ? 12 : 15} /></div>;
  }
  if (kind === "ai") {
    return <div className={`avatar ${size ? "avatar--" + size : ""} avatar--ai ${className}`} style={styleProp}>AI</div>;
  }
  if (kind === "placeholder") {
    return <div className={`avatar ${size ? "avatar--" + size : ""} avatar--placeholder ${className}`} style={styleProp}>{initials}</div>;
  }
  const style = photo
    ? { backgroundImage: `url(${photo})`, backgroundSize: "cover", backgroundPosition: "center", ...styleProp }
    : { background: avatarGradient(name), ...styleProp };
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
export const Severity = ({ level = "info", title, children, action, icon }) => (
  <div className={`sev sev--${level}`}>
    <span className="sev__icon">
      <Icon name={icon || (level === "info" ? "info" : level === "warning" ? "warning" : "error")} size={16} />
    </span>
    <div style={{ flex: 1, minWidth: 0 }}>
      {title && <div style={{ fontWeight: 800, color: "var(--ink)", marginBottom: 3 }}>{title}</div>}
      {children}
    </div>
    {action}
  </div>
);

// ----- Form Field -----
// Canonical inline error / warning lines (Lumo `.err` / `.wrn`, with icon).
const ErrLine = ({ children }) => (
  <span className="err">
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4"><circle cx="12" cy="12" r="10" /><path d="M12 8v4M12 16h.01" /></svg>
    <span>{children}</span>
  </span>
);
const WrnLine = ({ children }) => (
  <span className="wrn">
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4"><path d="M12 9v4M12 17h.01M10.3 3.9 1.8 18a2 2 0 0 0 1.7 3h17a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0z" /></svg>
    <span>{children}</span>
  </span>
);

export const Field = ({ label, hint, sub, ai, error, warning, children, required }) => (
  <div className={`field ${ai ? "field--ai" : ""} ${error ? "field--error" : warning ? "field--warning" : ""}`}>
    {label && (
      <label className="field__label">
        {label}{required && <span style={{ color: "var(--danger)" }}>*</span>}
        {hint && <span className="muted" style={{ fontWeight: 400, fontSize: 'var(--fs-micro)', marginLeft: 4 }}>· {hint}</span>}
      </label>
    )}
    {children}
    {sub && <span className="field__sub">{sub}</span>}
    {error && <ErrLine>{error}</ErrLine>}
    {!error && warning && <WrnLine>{warning}</WrnLine>}
  </div>
);

// ----- Buttons -----
export const Btn = ({ variant = "ghost", size, icon, iconRight, block, disabled, children, onClick, className = "", ariaLabel, title, ariaPressed, style }) => (
  <button
    className={`btn btn--${variant} ${size ? "btn--" + size : ""} ${block ? "btn--block" : ""} ${className}`}
    onClick={onClick}
    disabled={disabled}
    aria-label={ariaLabel}
    aria-pressed={ariaPressed}
    title={title}
    style={style}
  >
    {icon && <Icon name={icon} size={16} />}
    {children}
    {iconRight && <Icon name={iconRight} size={16} />}
  </button>
);

// ----- Badge -----
export const Badge = ({ variant = "", icon, dot, children, style }) => (
  <span className={`badge ${variant ? "badge--" + variant : ""}`} style={style}>
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
          {subtitle && <div className="muted" style={{ fontSize: 'var(--fs-meta)' }}>{subtitle}</div>}
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
      background: kind === "error" ? "var(--danger-soft)" : kind === "locked" ? "var(--pro-soft-2)" : "var(--brand-soft)",
      color: kind === "error" ? "var(--danger)" : kind === "locked" ? "var(--pro-ink)" : "var(--brand)",
      display: "grid", placeItems: "center", marginBottom: 16,
    }}>
      <Icon name={icon} size={28} />
    </div>
    <h3 style={{ color: "var(--ink)", marginBottom: 6 }}>{title}</h3>
    <div style={{ maxWidth: 340, fontSize: 'var(--fs-base)', lineHeight: 1.5 }}>{body}</div>
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
// Canonical money formatter (locale-aware, decimals only when present).
export const fmt = (n, cur = "EUR") => fmtMoneyActive(n, cur);

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
export const DismissibleSeverity = ({ level = "info", title, children, onDismiss, action, icon }) => {
  const t = useT();
  const [open, setOpen] = React.useState(true);
  if (!open) return null;
  return (
    <div className={`sev sev--${level}`} style={{ position: "relative" }}>
      <span className="sev__icon">
        <Icon name={icon || (level === "info" ? "info" : level === "warning" ? "warning" : "error")} size={16} />
      </span>
      <div style={{ flex: 1, minWidth: 0, paddingRight: 28 }}>
        {title && <div style={{ fontWeight: 800, color: "var(--ink)", marginBottom: 3 }}>{title}</div>}
        {children}
        {action && <div style={{ marginTop: 8 }}>{action}</div>}
      </div>
      <button onClick={() => { setOpen(false); onDismiss?.(); }} className="dz-xbtn" style={{
        position: "absolute", top: 8, right: 8,
        width: 22, height: 22, borderRadius: 6, border: "none",
        color: "var(--muted)", cursor: "pointer",
        display: "grid", placeItems: "center",
      }} title={t('common.close')} aria-label={t('common.close')}>
        <Icon name="close" size={12} />
      </button>
    </div>
  );
};

// ----- RoleBadge with icon -----
export const RoleBadge = ({ role, size = "md", status }) => {
  const t = useT();
  const ROLE_META = {
    owner:  { icon: "crown",  color: "var(--warm)", soft: "var(--warm-tint)" },
    admin:  { icon: "shield", color: "var(--brand)", soft: "var(--brand-soft)" },
    viewer: { icon: "eye",    color: "var(--muted)", soft: "var(--wash)" },
  };
  const key = ROLE_META[role] ? role : "viewer";
  const m = ROLE_META[key];
  return (
    <span style={{
      display: "inline-flex", alignItems: "center", gap: 5,
      padding: size === "sm" ? "2px 7px 2px 5px" : "3px 9px 3px 6px",
      borderRadius: 999, background: m.soft, color: m.color,
      fontSize: size === "sm" ? 11 : 11.5, fontWeight: 500,
    }}>
      <Icon name={m.icon} size={size === "sm" ? 10 : 11} />
      {t(`members.badge_${key}`)}{status === "pending" && ` · ${t('members.pending')}`}
    </span>
  );
};

// ----- City photo helper - uses gradient placeholder by city -----
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
      <div style={{ position: "absolute", top: 6, left: 8, fontSize: 'var(--fs-h3)' }}>{p.emoji}</div>
    </div>
  );
};

// ---- Dialog: title/icon/foot/size convenience wrapper over the ONE canonical
//      modal engine (@/components/ui/dialog → Radix). The legacy ModalHost +
//      window.__openModal stack has been removed; every modal in the app now
//      runs on the same `ui/dialog` Dialog/DialogContent. ----
// iconTone swaps the header-icon tint to an existing Lumo event token set
// (default = brand). Add tones here as needed — no new tokens introduced.
const DLG_ICON_TONES = {
  activity: { bg: 'var(--ev-activity-soft)', fg: 'var(--ev-activity-ink)' },
};
export const Dialog = ({ title, subtitle, icon, iconTone, onClose, size, children, foot, open, onOpenChange }) => {
  const handleClose = () => { onClose?.(); onOpenChange?.(false); };
  const tone = DLG_ICON_TONES[iconTone] || { bg: 'var(--brand-soft)', fg: 'var(--brand)' };
  return (
    <UIDialog open={open === undefined ? true : open} onOpenChange={(o) => { if (!o) handleClose(); }}>
      <DialogContent className={size ? `dlg--${size}` : ''}>
        <div className="dlg__head">
          {icon && (
            <div style={{ width: 36, height: 36, borderRadius: 9, background: tone.bg, color: tone.fg, display: 'grid', placeItems: 'center', flexShrink: 0 }}>
              <Icon name={icon} size={17} />
            </div>
          )}
          <div style={{ flex: 1, minWidth: 0 }}>
            <h2>{title}</h2>
            {subtitle && <div className="muted" style={{ fontSize: 'var(--fs-meta)', fontWeight: 600, marginTop: 2 }}>{subtitle}</div>}
          </div>
          <button className="icon-btn" onClick={handleClose}>
            <Icon name="close" size={16} />
          </button>
        </div>
        <div className="dlg__body">{children}</div>
        {foot && <div className="dlg__foot">{foot}</div>}
      </DialogContent>
    </UIDialog>
  );
};

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
  // Real favicon of the booking site (same source as the event view/edit dialogs)
  // instead of a letter monogram. Falls back to the letter/link icon if the
  // favicon can't load or the URL has no host.
  let host = "";
  try {
    const s = String(url || "").trim();
    if (s) host = new URL(s.startsWith("http") ? s : `https://${s}`).hostname;
  } catch { /* ignore */ }
  const favicon = host ? `https://www.google.com/s2/favicons?domain=${host}&sz=64` : null;
  const [imgFailed, setImgFailed] = React.useState(false);

  if (favicon && !imgFailed) {
    return (
      <img
        src={favicon}
        alt=""
        onError={() => setImgFailed(true)}
        style={{ width: size, height: size, borderRadius: 4, objectFit: "cover", flexShrink: 0, background: "var(--wash)" }}
      />
    );
  }
  if (!p) return (
    <div style={{ width: size, height: size, borderRadius: 4, background: "var(--line)", color: "var(--muted)", display: "grid", placeItems: "center", fontSize: size * 0.55, fontWeight: 700, flexShrink: 0 }}>
      <Icon name="link" size={size * 0.6} />
    </div>
  );
  return (
    <div style={{ width: size, height: size, borderRadius: 4, background: p.color, color: "white", display: "grid", placeItems: "center", fontSize: size * 0.5, fontWeight: 700, flexShrink: 0 }}>
      {p.short}
    </div>
  );
};

export const PartnerPill = ({ url, fallback }) => {
  const t = useT();
  const p = detectPartner(url);
  return (
    <span className="partner-pill">
      <PartnerLogo url={url} size={16} />
      {p?.label || fallback || t('common.link')}
    </span>
  );
};

// =====================================================================
// BOOKING SUGGESTION CARD - used by AI in chats
// =====================================================================
export function BookingSuggestionCard({ type, name, partner, url, price, cur, rating, sub, extras }) {
  const t = useT();
  const p = detectPartner(url || partner);
  return (
    <div style={{
      background: "var(--surface)",
      border: "1.5px solid var(--ai-soft-12)",
      borderRadius: 12, padding: 12,
      display: "flex", gap: 12, maxWidth: 360,
    }}>
      <div style={{ width: 48, height: 48, borderRadius: 8, background: p?.color || "var(--brand)", color: "white", display: "grid", placeItems: "center", flexShrink: 0, fontSize: 'var(--fs-h3)', fontWeight: 700 }}>
        <Icon name={type === "hotel" ? "bed" : type === "flight" ? "plane" : type === "train" ? "train" : "ticket"} size={20} />
      </div>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ fontWeight: 600, fontSize: 'var(--fs-base)', marginBottom: 2 }}>{name}</div>
        <div className="muted" style={{ fontSize: 'var(--fs-meta)' }}>{sub}</div>
        {rating && (
          <div style={{ marginTop: 4, display: "flex", alignItems: "center", gap: 5, fontSize: 'var(--fs-micro)' }}>
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
          <div className="num" style={{ fontWeight: 600, fontSize: 'var(--fs-strong)' }}>{fmt(price, cur)}</div>
          <div style={{ flex: 1 }} />
          <Btn variant="ghost" size="sm" icon="external">{p?.label || t('common.open')}</Btn>
        </div>
      </div>
    </div>
  );
}

// =====================================================================
// SHARED TIMELINE UTILITIES - exported so all screens can use them
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

const _LOCMAP = { ru: 'ru-RU', en: 'en-US', es: 'es-ES' };
// ru output kept byte-identical (Public + ru callers unchanged); en/es via Intl.
export function fmtDate(iso, loc) {
  const d = new Date(iso + "T00:00:00");
  if (isNaN(d)) return '';
  if (loc && loc !== 'ru') {
    try { return new Intl.DateTimeFormat(_LOCMAP[loc] || loc, { day: 'numeric', month: 'short' }).format(d); } catch { /* fallthrough */ }
  }
  return `${d.getDate()} ${_MONTHS[d.getMonth()]}`;
}

export function weekday(iso, loc) {
  const d = new Date(iso + "T00:00:00");
  if (isNaN(d)) return '';
  if (loc && loc !== 'ru') {
    try { return new Intl.DateTimeFormat(_LOCMAP[loc] || loc, { weekday: 'short' }).format(d); } catch { /* fallthrough */ }
  }
  return _WEEKDAYS[d.getDay()];
}

const _WEEKDAYS_LONG = ["воскресенье", "понедельник", "вторник", "среда", "четверг", "пятница", "суббота"];
// Full weekday name (Lumo timeline header writes them out in full).
export function weekdayLong(iso, loc) {
  const d = new Date(iso + "T00:00:00");
  if (isNaN(d)) return '';
  if (loc && loc !== 'ru') {
    try { return new Intl.DateTimeFormat(_LOCMAP[loc] || loc, { weekday: 'long' }).format(d); } catch { /* fallthrough */ }
  }
  return _WEEKDAYS_LONG[d.getDay()];
}

// ----- Mock event stream -----
export const STREAM = [
  { type: "hotel-deadline", id: "d1", date: "2026-07-09", time: "23:59", city: "Лиссабон", title: "Дедлайн бесплатной отмены · Memmo Alfama",
    hotel: "Memmo Alfama", price: 880, cur: "EUR", note: "После - невозвратно. Решить сейчас, ехать ли." },
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
    price: 1340, cur: "EUR", nights: 4, num: "-" },
  { type: "car-pickup", id: "cp1", date: "2026-07-19", time: "17:30", city: "Барселона", title: "Получение авто · Sixt",
    address: "Барселона аэропорт T1", platformUrl: "https://sixt.com" },
  { type: "activity", id: "a5", date: "2026-07-20", time: "10:25", duration: "1ч 35м", city: "Барселона",
    title: "Sagrada Família", price: 33, cur: "EUR", category: "sight", address: "C/ Mallorca 401" },
  { type: "activity", id: "a6", date: "2026-07-21", city: "Барселона",
    title: "Парк Гуэль", price: 18, cur: "EUR", category: "sight",
    warning: "Не указано время - желательно поставить", address: "C/ Olot, 5" },
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
  plane: { icon: "plane", label: "Перелёт", labelKey: "tse.tk_plane" },
  train: { icon: "train", label: "Поезд", labelKey: "transfer.train" },
  bus:   { icon: "bus",   label: "Автобус", labelKey: "transfer.bus" },
  ferry: { icon: "ferry", label: "Паром", labelKey: "transfer.ferry" },
  car:   { icon: "car",   label: "На авто", labelKey: "event.tk_car" },
  walk:  { icon: "walk",  label: "Пешком", labelKey: "event.tk_walk" },
  foot:  { icon: "walk",  label: "Пешком", labelKey: "event.tk_walk" },
  bike:  { icon: "walk",  label: "Велосипед", labelKey: "transfer.bike" }
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
  const arriveTime = e.arrive_time || _addDuration(e.time, e.duration) || "-";
  return (
    <button onClick={onClick} className="dz-lift dz-lift--transfer" style={{
      width: "100%", display: "grid", gridTemplateColumns: "auto 1fr auto 1fr auto", gap: 14,
      alignItems: "center", padding: "14px 16px", background: "var(--surface)",
      borderRadius: 12, cursor: "pointer", textAlign: "left"
    }}>
      <div style={{ width: 36, height: 36, borderRadius: 9, background: "var(--ev-transfer-soft)", color: "var(--ev-transfer)", display: "grid", placeItems: "center", flexShrink: 0 }}>
        <Icon name={meta.icon} size={17} />
      </div>
      <div>
        <div className="num" style={{ fontFamily: "var(--font-display)", fontSize: 'var(--fs-h3)', fontWeight: 700, letterSpacing: "-0.02em", lineHeight: 1 }}>{e.time}</div>
        <div style={{ fontSize: 'var(--fs-meta)', fontWeight: 600, marginTop: 4 }}>{e.from}</div>
        {e.depart_loc && <div className="muted" style={{ fontSize: 'var(--fs-micro)' }}>{e.depart_loc}</div>}
      </div>
      <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 4, minWidth: 80 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 4, width: "100%" }}>
          <div style={{ height: 1, flex: 1, borderTop: "1.5px dashed var(--ev-transfer)" }} />
          <span className="muted num" style={{ fontSize: 'var(--fs-micro)', whiteSpace: "nowrap" }}>{e.duration}</span>
          <div style={{ height: 1, flex: 1, borderTop: "1.5px dashed var(--ev-transfer)" }} />
        </div>
        <div className="muted" style={{ fontSize: 'var(--fs-micro)', textAlign: "center" }}>
          {e.carrier}{e.num && e.num !== "-" ? <> · <span className="num">{e.num}</span></> : null}
        </div>
      </div>
      <div style={{ textAlign: "right" }}>
        <div className="num" style={{ fontFamily: "var(--font-display)", fontSize: 'var(--fs-h3)', fontWeight: 700, letterSpacing: "-0.02em", lineHeight: 1 }}>{arriveTime}</div>
        <div style={{ fontSize: 'var(--fs-meta)', fontWeight: 600, marginTop: 4 }}>{e.to}</div>
        {e.arrive_loc && <div className="muted" style={{ fontSize: 'var(--fs-micro)' }}>{e.arrive_loc}</div>}
      </div>
      <div style={{ textAlign: "right", borderLeft: "1px solid var(--line-2)", paddingLeft: 14, minWidth: 80 }}>
        {e.price && <div className="num" style={{ fontWeight: 600, fontSize: 'var(--fs-strong)' }}>{fmt(e.price, e.cur)}</div>}
        {e.platformUrl && <div style={{ marginTop: 4 }}><PartnerPill url={e.platformUrl} /></div>}
      </div>
    </button>
  );
}

function TransferCardStrip({ e, onClick }) {
  const meta = _transferMeta(e);
  return (
    <button onClick={onClick} className="dz-lift dz-lift--transfer" style={{
      width: "100%", display: "flex", alignItems: "center", gap: 14,
      padding: "12px 14px", background: "var(--surface)",
      borderRadius: 12, cursor: "pointer", textAlign: "left"
    }}>
      <div className="num" style={{ fontFamily: "var(--font-display)", fontSize: 'var(--fs-h4)', fontWeight: 700, letterSpacing: "-0.01em", minWidth: 52, color: "var(--ink)" }}>{e.time || "-"}</div>
      <div style={{ width: 32, height: 32, borderRadius: 8, background: "var(--ev-transfer-soft)", color: "var(--ev-transfer)", display: "grid", placeItems: "center", flexShrink: 0 }}>
        <Icon name={meta.icon} size={15} />
      </div>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 2, flexWrap: "wrap" }}>
          <span style={{ fontSize: 'var(--fs-base)', fontWeight: 600 }}>{meta.label}</span>
          <span className="muted" style={{ fontSize: 'var(--fs-meta)' }}>
            {e.from_city || e.from} <Icon name="arrowR" size={10} style={{ verticalAlign: -1, color: "var(--muted-2)" }} /> {e.to_city || e.to}
          </span>
        </div>
        <div className="muted" style={{ fontSize: 'var(--fs-meta)', display: "flex", flexWrap: "wrap", gap: 8 }}>
          {e.duration && <span className="num">{e.duration}</span>}
          {e.carrier && <span>· {e.carrier}{e.num && e.num !== "-" ? <> · <span className="num">{e.num}</span></> : null}</span>}
          {e.platformUrl && <PartnerPill url={e.platformUrl} />}
        </div>
      </div>
      {e.price && <span className="num" style={{ fontWeight: 600, fontSize: 'var(--fs-strong)' }}>{fmt(e.price, e.cur)}</span>}
    </button>
  );
}

function TransferCardStacked({ e, onClick }) {
  const meta = _transferMeta(e);
  const arriveTime = e.arrive_time || _addDuration(e.time, e.duration) || "-";
  return (
    <button onClick={onClick} className="dz-lift dz-lift--transfer" style={{
      width: "100%", display: "flex", alignItems: "center", gap: 14,
      padding: "14px 16px", background: "var(--surface)",
      borderRadius: 12, cursor: "pointer", textAlign: "left"
    }}>
      <div style={{ width: 44, height: 44, borderRadius: 11, background: "var(--ev-transfer-soft)", color: "var(--ev-transfer)", display: "grid", placeItems: "center", flexShrink: 0 }}>
        <Icon name={meta.icon} size={20} />
      </div>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div className="eyebrow" style={{ marginBottom: 4, color: "var(--ev-transfer)" }}>
          {meta.label} · <span className="num">{e.duration}</span>
        </div>
        <div style={{ display: "flex", alignItems: "baseline", gap: 8, flexWrap: "wrap" }}>
          <span className="num" style={{ fontFamily: "var(--font-display)", fontSize: 'var(--fs-h3)', fontWeight: 700, letterSpacing: "-0.02em" }}>{e.time}</span>
          <Icon name="arrowR" size={12} style={{ color: "var(--muted-2)" }} />
          <span className="num" style={{ fontFamily: "var(--font-display)", fontSize: 'var(--fs-h3)', fontWeight: 700, letterSpacing: "-0.02em" }}>{arriveTime}</span>
          <span style={{ fontSize: 'var(--fs-base)', fontWeight: 600 }}>· {e.to_city || e.to}</span>
        </div>
        <div className="muted" style={{ fontSize: 'var(--fs-meta)', marginTop: 2, display: "flex", flexWrap: "wrap", gap: 8 }}>
          <span>из {e.from_city || e.from}</span>
          {e.carrier && <span>· {e.carrier}{e.num && e.num !== "-" ? <> · <span className="num">{e.num}</span></> : null}</span>}
          {e.platformUrl && <PartnerPill url={e.platformUrl} />}
        </div>
      </div>
      {e.price && <div style={{ textAlign: "right", flexShrink: 0 }}><div className="num" style={{ fontWeight: 600, fontSize: 'var(--fs-strong)' }}>{fmt(e.price, e.cur)}</div></div>}
    </button>
  );
}

// ── Per-event color / icon / label (shared by desktop + mobile renderers) ──────
function _evMeta(e) {
  if (e.type === "flight" || e.type === "transfer") {
    const tm = _transferMeta(e);
    return { c: "var(--ev-transfer)", soft: "var(--ev-transfer-soft)", icon: tm.icon, label: tm.label, labelKey: tm.labelKey };
  }
  const MAP = {
    "hotel-checkin":  { c: "var(--ev-hotel)",    soft: "var(--ev-hotel-soft)",    icon: "bed",     label: "Заезд", labelKey: "tse.checkin" },
    "hotel-checkout": { c: "var(--ev-hotel)",    soft: "var(--ev-hotel-soft)",    icon: "bed",     label: "Выезд", labelKey: "tse.checkout" },
    "hotel-deadline": { c: "var(--ev-deadline)", soft: "var(--ev-deadline-soft)", icon: "warning", label: "Дедлайн отмены", labelKey: "tl.deadline" },
    "car-pickup":     { c: "var(--ev-car)",      soft: "var(--ev-car-soft)",      icon: "car",     label: "Получение авто", labelKey: "car.pickup_event" },
    "car-return":     { c: "var(--ev-car)",      soft: "var(--ev-car-soft)",      icon: "car",     label: "Возврат авто", labelKey: "car.dropoff_event" },
    "activity": {
      c: "var(--ev-activity)", soft: "var(--ev-activity-soft)",
      icon: "ticket",
      label: e.category === "food" ? "Еда" : e.category === "sight" ? "Достопримечательность" : "Активность",
      labelKey: e.category === "food" ? "tl.cat_food" : e.category === "sight" ? "tl.cat_sight" : "event.type_activity",
    },
  };
  return MAP[e.type] || { c: "var(--ink)", soft: "var(--wash)", icon: "ticket", label: "", labelKey: "" };
}

// ── Mobile transfer row - stacked with a vertical departure→arrival scale ──────
// Event-type → Lumo tile colour tokens (--evs soft bg / --evi ink).
const _EV_TOK = {
  hotel:    { s: "var(--ev-hotel-soft)",    i: "var(--ev-hotel-ink)" },
  transfer: { s: "var(--ev-transfer-soft)", i: "var(--ev-transfer-ink)" },
  activity: { s: "var(--ev-activity-soft)", i: "var(--ev-activity-ink)" },
  car:      { s: "var(--ev-car-soft)",      i: "var(--ev-car-ink)" },
  deadline: { s: "var(--ev-deadline-soft)", i: "var(--ev-deadline-ink)" },
};
function _evTok(e) {
  if (e.type === "flight" || e.type === "transfer") return _EV_TOK.transfer;
  if (e.type === "hotel-checkin" || e.type === "hotel-checkout") return _EV_TOK.hotel;
  if (e.type === "hotel-deadline") return _EV_TOK.deadline;
  if (e.type === "car-pickup" || e.type === "car-return") return _EV_TOK.car;
  return _EV_TOK.activity;
}

// Timeline event plate — Lumo "Таймлайн поездки" (.tl3-ev): time on the left
// (mono), .tl3-card with a coloured .tile + title/sub. Transfers render as the
// column .tl3-card--tr (from → mode → to). Missing-transfer → .tl3-warn.
export function StreamEventRow({ e, onClick }) {
  const t = useT();

  if (e.type === "transfer-missing") {
    const [hidden, setHidden] = React.useState(false);
    if (hidden) return null;
    return (
      <div className="tl3-warn">
        <span className="tile"><Icon name="warning" size={19} /></span>
        <div className="x">
          <b>{t('view.map_no_transfer')}</b>
          <span>{e.from} → {e.to}</span>
        </div>
        <button onClick={onClick}>{t('tse.add_transfer')}</button>
        <button onClick={() => setHidden(true)} title={t('tl.hide_warning')}
          style={{ background: "transparent", color: "var(--warning-ink)", border: 0, padding: 6, cursor: "pointer", display: "grid", placeItems: "center", borderRadius: 8 }}>
          <Icon name="close" size={14} />
        </button>
      </div>
    );
  }

  const meta = _evMeta(e);
  const price = e.price != null ? fmt(e.price, e.cur) : null;

  if (e.type === "flight" || e.type === "transfer") {
    // Prefer the explicit end time from the data model (e.endTime is derived
    // from end_datetime in buildEventStream). _addDuration only parses Cyrillic
    // "Nч/Nм" duration strings, so on en/es locales (or a missing duration) it
    // added zero and the arrival time collapsed to the departure time.
    const arrive = e.endTime || e.arrive_time || _addDuration(e.time, e.duration) || "—";
    const small = [e.carrier, e.duration].filter(Boolean).join(" · ");
    return (
      <div className="tl3-ev tl3-ev--tr">
        <div className="time time--tr"><span>{e.time || "—"}</span><span>{arrive}</span></div>
        <button className="tl3-card tl3-card--tr" onClick={onClick}>
          <div className="rv-end">
            <b>{e.from || "—"}</b>
            {e.from_address && e.from_address !== e.from && <span>{e.from_address}</span>}
          </div>
          <div className="rv-conn">
            <span className="dline" />
            <span className="rv-mode">
              <span className="ic"><Icon name={meta.icon} size={16} /></span>
              {t(meta.labelKey)}{small && <small> · {small}</small>}
            </span>
            <span className="dline" />
          </div>
          <div className="rv-end">
            {e.to_address && e.to_address !== e.to && <span>{e.to_address}</span>}
            <b>{e.to || "—"}</b>
          </div>
        </button>
      </div>
    );
  }

  const tok = _evTok(e);
  const sub = [t(meta.labelKey), e.duration, e.address].filter(Boolean).join(" · ");
  return (
    <div className="tl3-ev">
      <div className="time">{e.time && e.time !== "?" ? e.time : "—"}</div>
      <button className="tl3-card" style={{ "--evs": tok.s, "--evi": tok.i }} onClick={onClick}>
        <span className="tile"><Icon name={meta.icon} size={20} /></span>
        <div className="body">
          <b>{e.title}</b>
          {sub && <div className="sb">{sub}</div>}
        </div>
        {(price || e.platformUrl) && (
          <span className="meta" style={{ display: "inline-flex", alignItems: "center", gap: 8 }}>
            {price && <span>{price}</span>}
            {e.platformUrl && <PartnerPill url={e.platformUrl} />}
          </span>
        )}
      </button>
    </div>
  );
}

// =====================================================================
// TRIP IDENTITY STRIP - exported so all screens can use it
// =====================================================================

function _InfoChip({ icon, color, children }) {
  return (
    <span style={{ display: "inline-flex", alignItems: "center", gap: 6, padding: "5px 10px 5px 8px", borderRadius: 999, background: "var(--wash)", border: "1px solid var(--line-2)", fontSize: 'var(--fs-meta)', color: "var(--ink-2)", fontWeight: 500 }}>
      <Icon name={icon} size={13} style={{ color }} />
      {children}
    </span>
  );
}

