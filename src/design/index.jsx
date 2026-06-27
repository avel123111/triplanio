import React from 'react';
import { Dialog as UIDialog, DialogContent, DialogTitle } from '@/components/ui/dialog';
import { Icon } from './icons';
import { useT } from '@/lib/i18n/I18nContext';
import { avatarGradient } from '@/lib/avatarRamp';
import { fmtMoneyActive } from '@/lib/i18n/format';

// =====================================================================
// Primitive layer (Radix-backed) — single import surface.
// These wrap @radix-ui/* + Lumo tokens and live under src/components/ui/*.
// Re-exported here so every caller imports from '@/design' and the ui/*
// folder stays an internal implementation detail (not a public surface).
// The raw Radix dialog root is exposed as `DialogRoot` to avoid colliding
// with the composed <Dialog> (title/icon/foot chrome) defined below.
// =====================================================================
export { UIDialog as DialogRoot, DialogContent, DialogTitle };
export {
  AlertDialog, AlertDialogContent, AlertDialogHeader, AlertDialogFooter,
  AlertDialogTitle, AlertDialogDescription, AlertDialogAction, AlertDialogCancel,
} from '@/components/ui/alert-dialog';
export { Popover, PopoverTrigger, PopoverContent, PopoverAnchor } from '@/components/ui/popover';
export { Sheet } from '@/components/ui/Sheet';
export { ActionMenu } from '@/components/ui/ActionMenu';
export { useToast, toast } from '@/components/ui/use-toast';
export { Toaster } from '@/components/ui/toaster';
export { default as SearchSelect } from '@/components/ui/SearchSelect';
export { default as CurrencyCombobox } from '@/components/ui/CurrencyCombobox';
export { default as AiField } from '@/components/ui/AiField';

// =====================================================================
// Shared components + mock data - converted from global scripts to ES modules
// =====================================================================

// ----- Avatar ----- (colours: src/lib/avatarRamp.js — single source)
export const Avatar = ({ name = "?", size, role, kind, photo, deleted, className = "", style: styleProp }) => {
  const t = useT();
  const initials = name.split(/\s+/).map(p => p[0]).join("").slice(0, 2).toUpperCase();
  if (deleted) {
    return <div className={`avatar ${size ? "avatar--" + size : ""} avatar--deleted ${className}`} style={styleProp} aria-label={t('common.deleted_user')}><Icon name="user" size={size === "lg" ? 18 : size === "xl" ? 26 : size === "sm" ? 12 : 15} /></div>;
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
// `loading` renders the canonical Lumo in-button spinner (.btn .spin) in place
// of the leading icon, disables the button and flags aria-busy — the single
// source of truth for "operation in flight" feedback across the app.
export const Btn = ({ variant = "ghost", size, icon, iconRight, block, disabled, loading, children, onClick, className = "", ariaLabel, title, ariaPressed, style }) => (
  <button
    className={`btn btn--${variant} ${size ? "btn--" + size : ""} ${block ? "btn--block" : ""} ${className}`}
    onClick={onClick}
    disabled={disabled || loading}
    aria-busy={loading || undefined}
    aria-label={ariaLabel}
    aria-pressed={ariaPressed}
    title={title}
    style={style}
  >
    {loading ? <span className="spin" /> : (icon && <Icon name={icon} size={16} />)}
    {children}
    {iconRight && !loading && <Icon name={iconRight} size={16} />}
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
// `busy` shows an in-knob spinner and blocks interaction while the change is
// being persisted server-side — toggles never report a state the backend
// hasn't confirmed (no optimistic flips).
export const Toggle = ({ on, onChange, locked, busy, label }) => (
  <button
    onClick={() => !locked && !busy && onChange && onChange(!on)}
    disabled={busy || undefined}
    aria-busy={busy || undefined}
    style={{
      width: 36, height: 21, padding: 0, border: "none",
      borderRadius: 999,
      background: locked ? "var(--wash)" : on ? "var(--brand)" : "var(--line)",
      position: "relative", flexShrink: 0,
      opacity: locked ? 0.5 : 1, cursor: (locked || busy) ? "not-allowed" : "pointer",
      transition: "background .15s ease",
    }}
    aria-label={label}
  >
    <span style={{
      position: "absolute", top: 2, left: on ? 17 : 2,
      width: 17, height: 17, borderRadius: "50%",
      background: "white", boxShadow: "0 1px 2px rgba(0,0,0,.2)",
      transition: "left .15s ease",
      display: "grid", placeItems: "center", color: on ? "var(--brand)" : "var(--muted)",
    }}>
      {busy && <span className="spin" style={{ width: 11, height: 11, border: "2px solid currentColor", borderRightColor: "transparent", borderRadius: "50%" }} />}
    </span>
  </button>
);

// ----- Currency formatting -----
// Canonical money formatter (locale-aware, decimals only when present).
export const fmt = (n, cur = "EUR") => fmtMoneyActive(n, cur);

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

// ----- Transfer card helpers -----
const TRANSFER_KIND_META = {
  plane: { icon: "plane", labelKey: "tse.tk_plane" },
  train: { icon: "train", labelKey: "transfer.train" },
  bus:   { icon: "bus",   labelKey: "transfer.bus" },
  ferry: { icon: "ferry", labelKey: "transfer.ferry" },
  car:   { icon: "car",   labelKey: "event.tk_car" },
  walk:  { icon: "walk",  labelKey: "event.tk_walk" },
  foot:  { icon: "walk",  labelKey: "event.tk_walk" },
  bike:  { icon: "walk",  labelKey: "transfer.bike" }
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

// ── Per-event color / icon / label (shared by desktop + mobile renderers) ──────
function _evMeta(e) {
  if (e.type === "flight" || e.type === "transfer") {
    const tm = _transferMeta(e);
    return { c: "var(--ev-transfer)", soft: "var(--ev-transfer-soft)", icon: tm.icon, labelKey: tm.labelKey };
  }
  const MAP = {
    "hotel-checkin":  { c: "var(--ev-hotel)",    soft: "var(--ev-hotel-soft)",    icon: "bed",     labelKey: "tse.checkin" },
    "hotel-checkout": { c: "var(--ev-hotel)",    soft: "var(--ev-hotel-soft)",    icon: "bed",     labelKey: "tse.checkout" },
    "hotel-deadline": { c: "var(--ev-deadline)", soft: "var(--ev-deadline-soft)", icon: "warning", labelKey: "tl.deadline" },
    "car-pickup":     { c: "var(--ev-car)",      soft: "var(--ev-car-soft)",      icon: "car",     labelKey: "car.pickup_event" },
    "car-return":     { c: "var(--ev-car)",      soft: "var(--ev-car-soft)",      icon: "car",     labelKey: "car.dropoff_event" },
    "activity": {
      c: "var(--ev-activity)", soft: "var(--ev-activity-soft)",
      icon: "ticket",
      labelKey: e.category === "food" ? "tl.cat_food" : e.category === "sight" ? "tl.cat_sight" : "event.type_activity",
    },
  };
  return MAP[e.type] || { c: "var(--ink)", soft: "var(--wash)", icon: "ticket", labelKey: "" };
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

