import React from 'react';
import { Btn, Avatar } from '@/design/index';
import { Icon } from '@/design/icons';

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

// Greeting hero — highlights the name inside the localized greeting string
// (every locale places {name} last, so we slice before its last occurrence).
export function Greeting({ greeting, name, avatarName, photo, sub }) {
  const at = name ? greeting.lastIndexOf(name) : -1;
  const prefix = at >= 0 ? greeting.slice(0, at) : greeting;
  return (
    <div className="head">
      <div className="head__row">
        <Avatar name={avatarName || name || '?'} photo={photo} className="head__av" />
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
export function StatBar({ items = [], cta = null, className = '' }) {
  return (
    <div className={`statbar${className ? ` ${className}` : ''}`}>
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
      <div className="top">
        <div className="wring" style={{ width: 72, height: 72 }}>
          <svg viewBox="0 0 72 72" width="72" height="72">
            <circle className="ring__track" cx="36" cy="36" r={R} strokeWidth="9" />
            <circle className="ring__fg" cx="36" cy="36" r={R} strokeWidth="9" style={{ strokeDasharray: C, strokeDashoffset: C * (1 - frac) }} />
          </svg>
          <div className="ring__c t-label">{world.pct}%</div>
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
  return <Btn variant="soft" onClick={onClick}>{label}<Icon name="arrowR" size={16} /></Btn>;
}

// ─── Ф5 widgets (My-statistics screen) ───────────────────────────────────────
// All pure / props-driven, same as the Ф4 set above. Statistics.jsx derives the
// data from travel-stats.statisticsBundle (year-filtered) and feeds these.

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
      <div className="wring" style={{ width: 148, height: 148 }}>
        <svg viewBox="0 0 148 148" width="148" height="148">
          <circle className="ring__track" cx="74" cy="74" r={R} strokeWidth="12" />
          <circle className="ring__fg" cx="74" cy="74" r={R} strokeWidth="12" style={{ strokeDasharray: C, strokeDashoffset: C * (1 - frac) }} />
        </svg>
        <div className="ring__c" style={{ flexDirection: 'column' }}>
          <span className="t-title">{world.pct}%</span>
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
          <span className="fl" style={r.cc ? { background: 'transparent' } : undefined}>
            {r.cc
              ? <img src={`/flags/${r.cc}.svg`} alt="" loading="lazy" onError={(e) => { if (e.currentTarget.dataset.fb !== '1') { e.currentTarget.dataset.fb = '1'; e.currentTarget.src = '/flags/xx.svg'; } }} />
              : r.badge}
          </span>
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
