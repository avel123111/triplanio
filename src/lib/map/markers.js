// Unified map-marker rendering for every Mapbox surface (trip MapView + create
// FlowMap). Both screens feed simple {lng,lat,label,kind} descriptors and get an
// identical-looking pin; the things that legitimately differ per screen — the
// click behaviour and the label text — are passed in as data/options, not
// branched inside the renderer. Change the pin's look here once and it updates on
// Overview, Map lens, Edit mode, public trip and the planner together.
//
// Marker roles (city_visits.kind):
//   transit  → numbered circle (1,2,3…). ONLY transit nodes get a number.
//   start    → start flag (brand colour).
//   end      → finish flag (contrasting colour).
//   waypoint → transit/interchange icon (a 0-night layover).
import {
  MARKER_COLOR,
  MARKER_START_COLOR,
  MARKER_END_COLOR,
  MARKER_WAYPOINT_COLOR,
} from './mapStyle';

// Glyphs reused from the design system (src/design/icons.jsx), inlined as raw
// SVG paths because markers are plain DOM nodes, not React components. `flag`
// marks both endpoints (colour tells start from finish); `arrowSwap` marks a
// waypoint (transit / layover).
const ICON_PATHS = {
  start: '<path d="M5 3v18"/><path d="M5 4h12l-2 4 2 4H5"/>',
  end: '<path d="M5 3v18"/><path d="M5 4h12l-2 4 2 4H5"/>',
  waypoint: '<path d="M7 7h13l-4-4M17 17H4l4 4"/>',
};
const ICON_COLORS = {
  start: MARKER_START_COLOR,
  end: MARKER_END_COLOR,
  waypoint: MARKER_WAYPOINT_COLOR,
};

// Pick the glyph for a (possibly grouped) pin. Anchors outrank waypoints, which
// outrank plain transit numbers, so a shared location renders its most
// significant role. Returns null when the pin should show its number(s) instead.
export function iconForKinds(kinds = []) {
  if (kinds.includes('start')) return 'start';
  if (kinds.includes('end')) return 'end';
  if (kinds.length > 0 && kinds.every((k) => k === 'waypoint')) return 'waypoint';
  return null;
}

// Group points that share a location (a city visited twice) into one pin that
// carries every label + kind at that spot.
// points: [{ lng, lat, label, kind?, data? }] → [{ lng, lat, labels:[], kinds:[], data:[] }]
// `precision` = coordinate rounding for the "same place" test (5 dp ≈ ~1 m).
export function groupByLocation(points, precision = 5) {
  const groups = new Map();
  points.forEach((p) => {
    if (p == null || p.lat == null || p.lng == null) return;
    const key = `${(+p.lat).toFixed(precision)},${(+p.lng).toFixed(precision)}`;
    if (!groups.has(key)) groups.set(key, { lng: +p.lng, lat: +p.lat, labels: [], kinds: [], data: [] });
    const g = groups.get(key);
    g.labels.push(p.label);
    g.kinds.push(p.kind);
    if (p.data !== undefined) g.data.push(p.data);
  });
  return [...groups.values()];
}

// Build the DOM element for one mapboxgl.Marker.
// labels: array shown on the pin (1 → circle; 2+ → split pill of first|last).
// opts: { color, onClick, title, icon } — `icon` ('start'|'end'|'waypoint')
//   renders a glyph instead of a number; `onClick` omitted ⇒ non-interactive pin.
export function createMarkerEl(labels, { color, onClick, title, icon } = {}) {
  const el = document.createElement('div');
  const fill = color || (icon && ICON_COLORS[icon]) || MARKER_COLOR;
  const base = `background:${fill};color:#fff;font-weight:700;box-shadow:0 4px 12px rgba(0,0,0,.25);border:2px solid #fff;border-radius:9999px;display:flex;align-items:center;justify-content:center;`;

  // Icon pin (start / finish flag, waypoint transit glyph) — no number.
  if (icon && ICON_PATHS[icon]) {
    el.style.cssText = `${base}width:28px;height:28px;${onClick ? 'cursor:pointer;' : ''}`;
    el.innerHTML = `<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="#fff" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${ICON_PATHS[icon]}</svg>`;
    if (title) el.title = title;
    if (onClick) el.addEventListener('click', onClick);
    return el;
  }

  const list = Array.isArray(labels) ? labels : [labels];

  if (list.length <= 1) {
    el.style.cssText = `${base}width:28px;height:28px;font-size:12px;${onClick ? 'cursor:pointer;' : ''}`;
    el.textContent = String(list[0] ?? '');
  } else {
    const first = list[0];
    const last = list[list.length - 1];
    el.style.cssText = `${base}width:44px;height:28px;font-size:11px;overflow:hidden;align-items:stretch;${onClick ? 'cursor:pointer;' : ''}`;
    el.innerHTML = `
      <div style="flex:1;display:flex;align-items:center;justify-content:center;padding-right:1px;">${first}</div>
      <div style="width:1px;background:rgba(255,255,255,.7);transform:skewX(-20deg);"></div>
      <div style="flex:1;display:flex;align-items:center;justify-content:center;padding-left:1px;">${last}</div>`;
  }

  if (title) el.title = title;
  if (onClick) el.addEventListener('click', onClick);
  return el;
}
