// Unified map-marker rendering for every Mapbox surface (trip MapView + create
// FlowMap). Both screens feed simple {lng,lat,label} descriptors and get an
// identical-looking pin; the things that legitimately differ per screen — the
// click behaviour and the label text (plain numbers vs 🏠 / ↩) — are passed in
// as data/options, not branched inside the renderer. Change the pin's look here
// once and it updates on Overview, Map lens, Edit mode, public trip and the
// planner together.
import { MARKER_COLOR } from './mapStyle';

// Group points that share a location (a city visited twice) into one pin that
// carries every label at that spot.
// points: [{ lng, lat, label, data? }] → [{ lng, lat, labels:[], data:[] }]
// `precision` = coordinate rounding for the "same place" test (5 dp ≈ ~1 m).
export function groupByLocation(points, precision = 5) {
  const groups = new Map();
  points.forEach((p) => {
    if (p == null || p.lat == null || p.lng == null) return;
    const key = `${(+p.lat).toFixed(precision)},${(+p.lng).toFixed(precision)}`;
    if (!groups.has(key)) groups.set(key, { lng: +p.lng, lat: +p.lat, labels: [], data: [] });
    const g = groups.get(key);
    g.labels.push(p.label);
    if (p.data !== undefined) g.data.push(p.data);
  });
  return [...groups.values()];
}

// Build the DOM element for one mapboxgl.Marker.
// labels: array shown on the pin (1 → circle; 2+ → split pill of first|last).
// opts: { color, onClick, title } — onClick omitted ⇒ non-interactive pin.
export function createMarkerEl(labels, { color = MARKER_COLOR, onClick, title } = {}) {
  const el = document.createElement('div');
  const base = `background:${color};color:#fff;font-weight:700;box-shadow:0 4px 12px rgba(0,0,0,.25);border:2px solid #fff;border-radius:9999px;display:flex;align-items:center;justify-content:center;`;
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
