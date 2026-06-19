import React from 'react';
import { Btn } from '@/design/index';

// Shared presentational widgets for the travel-stats screens (Trips home +
// "My statistics"). Pure, props-driven, no data fetching — so the greeting hero,
// the stat-bar and the "world explored" ring render identically on both screens
// instead of being copy-pasted. Numbers come from src/lib/travel-stats.js.

export function initialsOf(name = '') {
  const parts = String(name).trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return '?';
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
}

// Inline glyphs (markers/cards in Trips keep their own; these are the stat-bar set).
export const IconGlobe     = () => <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><circle cx="12" cy="12" r="9"/><path d="M3.6 9h16.8M3.6 15h16.8M12 3a14 14 0 0 0 0 18"/></svg>;
export const IconBuildings = () => <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M3 21h18M5 21V8l5-3v16M14 21V10l5-2v13"/></svg>;
export const IconContinent = () => <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M12 2 2 7l10 5 10-5z"/><path d="M2 12l10 5 10-5M2 17l10 5 10-5"/></svg>;
export const IconSuitcase  = () => <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="3" y="7" width="18" height="13" rx="2"/><path d="M8 7V5a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/></svg>;
export const IconTransfer  = () => <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M3 8h14l-3-3M21 16H7l3 3"/></svg>;
export const IconArrowR    = () => <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round"><path d="M5 12h14M13 6l6 6-6 6"/></svg>;

// Greeting hero — highlights the name inside the localized greeting string
// (every locale places {name} last, so we slice before its last occurrence).
export function Greeting({ greeting, name, photo, sub }) {
  const at = name ? greeting.lastIndexOf(name) : -1;
  const prefix = at >= 0 ? greeting.slice(0, at) : greeting;
  return (
    <div className="head">
      <div className="blob b1" />
      <div className="blob b2" />
      <div className="head__row">
        <span className="head__av">
          {photo
            ? <img src={photo} alt="" onError={(e) => { e.currentTarget.style.display = 'none'; }} />
            : <span style={{ position: 'absolute', inset: 0, display: 'grid', placeItems: 'center', color: '#fff', fontFamily: 'var(--font-display)', fontWeight: 700, fontSize: 'var(--fs-h3)' }}>{initialsOf(name)}</span>}
        </span>
        <div className="grow">
          <h1>{prefix}{name && <span className="nm">{name}</span>}</h1>
          {sub && <div className="sub">{sub}</div>}
        </div>
      </div>
    </div>
  );
}

// Horizontal stat-bar. `items` = [{ key, value, label, tone, icon }] where tone
// maps to the .c-* icon colour (city/trip/transfer). Optional trailing CTA node.
export function StatBar({ items = [], cta = null }) {
  return (
    <div className="statbar">
      {items.map((it) => (
        <div key={it.key} className={`s${it.tone ? ` c-${it.tone}` : ''}`}>
          <span className="ic">{it.icon}</span>
          <div><div className="v">{it.value}</div><div className="k">{it.label}</div></div>
        </div>
      ))}
      {cta && <div className="cta">{cta}</div>}
    </div>
  );
}

// "World explored" ring + bar over the /total (195) denominator.
// world = { visited, total, pct } from travel-stats.worldExplored().
export function WorldMini({ world, title, caption }) {
  const R = 30;
  const C = 2 * Math.PI * R;
  const frac = world.total ? Math.min(1, world.visited / world.total) : 0;
  return (
    <div className="wmini">
      <div className="blob b1" style={{ width: 160, height: 160, background: 'var(--brand-grad)', top: -90, right: -40, opacity: 0.1 }} />
      <div className="top">
        <div className="ring" style={{ width: 72, height: 72 }}>
          <svg viewBox="0 0 72 72" width="72" height="72">
            <circle className="ring__track" cx="36" cy="36" r={R} strokeWidth="9" />
            <circle className="ring__fg" cx="36" cy="36" r={R} strokeWidth="9" style={{ strokeDasharray: C, strokeDashoffset: C * (1 - frac) }} />
          </svg>
          <div className="ring__c" style={{ fontSize: 'var(--fs-h4)' }}>{world.pct}%</div>
        </div>
        <div>
          <div className="ttl">{title}</div>
          <div className="sub">{caption}</div>
        </div>
      </div>
      <div className="bar"><i style={{ width: `${frac * 100}%` }} /></div>
    </div>
  );
}

// CTA helper for the stat-bar action so callers don't reach for Btn directly.
export function AllStatsCta({ label, onClick }) {
  return <Btn variant="soft" onClick={onClick}>{label}<IconArrowR /></Btn>;
}

// ─── Ф5 widgets (My-statistics screen) ───────────────────────────────────────
// All pure / props-driven, same as the Ф4 set above. Statistics.jsx derives the
// data from travel-stats.statisticsBundle (year-filtered) and feeds these.

export const IconFlight   = () => <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M21 16v-2l-8-5V3.5A1.5 1.5 0 0 0 11.5 2 1.5 1.5 0 0 0 10 3.5V9l-8 5v2l8-2.5V19l-2 1.5V22l3.5-1 3.5 1v-1.5L13 19v-5.5z"/></svg>;
export const IconCalendar = () => <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round"><path d="M8 2v4M16 2v4M3 10h18M5 4h14a2 2 0 0 1 2 2v13a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2z"/></svg>;
export const IconHeart    = () => <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round"><path d="M12 21s-7-4.7-7-11a4 4 0 0 1 7-2.6A4 4 0 0 1 19 10c0 6.3-7 11-7 11z"/></svg>;
export const IconStar     = () => <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round"><path d="M12 2l2.4 7.4H22l-6 4.4 2.3 7.2L12 16.6 5.7 21l2.3-7.2-6-4.4h7.6z"/></svg>;
export const IconPin      = () => <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M12 21s-7-5.7-7-11a7 7 0 0 1 14 0c0 5.3-7 11-7 11z"/><circle cx="12" cy="10" r="2.5"/></svg>;

// Summary tiles. items = [{ key, value, label, tone, icon, soon }]. `tone` maps
// to .c-* (city/cont/trip/flight/transfer); `soon` greys a not-yet-computed value.
export function SummaryTiles({ items = [] }) {
  return (
    <div className="summary">
      {items.map((it) => (
        <div key={it.key} className={`sfig${it.tone ? ` c-${it.tone}` : ''}${it.soon ? ' is-soon' : ''}`}>
          <span className="ic">{it.icon}</span>
          <div className="v">{it.value}</div>
          <div className="k">{it.label}</div>
        </div>
      ))}
    </div>
  );
}

// Big "world explored" ring (148px) + caption. world = { visited, total, pct }.
export function WorldRing({ world, label, caption }) {
  const R = 61;
  const C = 2 * Math.PI * R;
  const frac = world.total ? Math.min(1, world.visited / world.total) : 0;
  return (
    <div className="world__ring">
      <div className="ring" style={{ width: 148, height: 148 }}>
        <svg viewBox="0 0 148 148" width="148" height="148">
          <circle className="ring__track" cx="74" cy="74" r={R} strokeWidth="12" />
          <circle className="ring__fg" cx="74" cy="74" r={R} strokeWidth="12" style={{ strokeDasharray: C, strokeDashoffset: C * (1 - frac) }} />
        </svg>
        <div className="ring__c" style={{ flexDirection: 'column' }}>
          <span style={{ fontSize: 'var(--fs-h1)' }}>{world.pct}%</span>
          <span className="l">{label}</span>
        </div>
      </div>
      {caption && <div className="cap">{caption}</div>}
    </div>
  );
}

// Continent bars. rows = [{ key, label, count, color, pct, countLabel }].
export function ContinentBars({ title, rows = [] }) {
  return (
    <div className="world__cont">
      <div className="ttl">{title}</div>
      {rows.map((r) => (
        <div key={r.key} className="crow">
          <span className="nm">{r.label}</span>
          <span className="bar"><i style={{ width: `${r.pct}%`, background: r.color }} /></span>
          <span className="c">{r.count} <small>{r.countLabel}</small></span>
        </div>
      ))}
    </div>
  );
}

// Records grid. items = [{ key, iconClass, icon, label, value, sub }].
export function Records({ items = [] }) {
  return (
    <div className="records">
      {items.map((it) => (
        <div key={it.key} className="rec">
          <span className={`ic ${it.iconClass}`}>{it.icon}</span>
          <div className="k">{it.label}</div>
          <div className="v">{it.value}</div>
          <div className="s">{it.sub}</div>
        </div>
      ))}
    </div>
  );
}

// Trips-per-year bar chart. bars = [{ year, value, height, on }]; caption string.
export function YearChart({ bars = [], caption }) {
  return (
    <div className="panel chart">
      <div className="chart__bars">
        {bars.map((b) => (
          <div key={b.year} className={`cbar${b.on ? ' on' : ''}`}>
            <span className="val">{b.value}</span>
            <span className="col" style={{ height: `${b.height}px` }} />
            <span className="yr">{b.year}</span>
          </div>
        ))}
      </div>
      {caption && <div className="chart__cap">{caption}</div>}
    </div>
  );
}

// Country / city list. rows = [{ type, key, badge, name, sub, count, tone, selected }].
// `tone` colours the leading badge via inline soft-mix (existing event tokens).
export function VisitList({ rows = [], emptyText, onSelect }) {
  if (rows.length === 0) {
    return <div className="vlist"><div className="list-empty">{emptyText}</div></div>;
  }
  return (
    <div className="vlist">
      {rows.map((r) => (
        <button
          key={r.key}
          type="button"
          className={`vrow${r.selected ? ' sel' : ''}`}
          onClick={() => onSelect?.(r)}
        >
          <span className="fl" style={{ background: `color-mix(in srgb, ${r.tone} 13%, transparent)`, color: r.tone }}>{r.badge}</span>
          <span>
            <span className="nm">{r.name}</span>
            {r.sub && <span className="s">{r.sub}</span>}
          </span>
          <span className="c">{r.count}</span>
        </button>
      ))}
    </div>
  );
}
