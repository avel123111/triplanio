// Shared map route + marker rendering helpers, used by the trip Map lens and
// the manual-planner preview map so both providers (Leaflet + Google) look the
// same.

export const PIN_COLOR = '#2167e2';     // brand - air transfers / default
export const GROUND_COLOR = '#1f8a5b';  // ground transfers (train/bus/car/ferry/walk)
export const MISSING_COLOR = '#94a3b8'; // pale - no transfer added

const GROUND = new Set(['train', 'bus', 'car', 'ferry', 'walk']);

/**
 * Line style for a route segment, based on the transfer's transport type.
 * `kind` null/undefined → "no transfer": a paler, dashed straight line.
 */
export function segmentStyle(kind) {
  if (!kind) return { color: MISSING_COLOR, weight: 2, dash: '5 7', opacity: 0.55 };
  if (GROUND.has(kind)) return { color: GROUND_COLOR, weight: 3, dash: null, opacity: 0.9 };
  return { color: PIN_COLOR, weight: 3, dash: null, opacity: 0.9 }; // plane / unknown
}

/**
 * Group points that share a location (same city visited twice) so we can draw a
 * single split marker carrying both order numbers.
 * `pts`: [{ lat, lng, label }] → [{ lat, lng, labels:[], indices:[] }]
 */
export function groupMarkers(pts) {
  const map = new Map();
  pts.forEach((p, i) => {
    if (p.lat == null || p.lng == null) return;
    const key = `${(+p.lat).toFixed(4)},${(+p.lng).toFixed(4)}`;
    if (!map.has(key)) map.set(key, { lat: p.lat, lng: p.lng, labels: [], indices: [] });
    const g = map.get(key);
    g.labels.push(p.label);
    g.indices.push(i);
  });
  return [...map.values()];
}

let _uid = 0;
const TXT = 'font-family="system-ui,-apple-system,sans-serif" font-weight="700"';

/**
 * Marker as an SVG string. One label → solid circle; two+ → vertically split
 * circle showing the first and last numbers.
 */
export function markerSvg(labels, active = false) {
  const d = active ? 36 : 30;
  const r = d / 2;
  const fs = active ? 13 : 12;
  if (!labels || labels.length <= 1) {
    return `<svg xmlns="http://www.w3.org/2000/svg" width="${d}" height="${d}" viewBox="0 0 ${d} ${d}">`
      + `<circle cx="${r}" cy="${r}" r="${r - 2}" fill="${PIN_COLOR}" stroke="#fff" stroke-width="2.5"/>`
      + `<text x="${r}" y="${r}" dy="0.35em" text-anchor="middle" fill="#fff" ${TXT} font-size="${fs}">${labels?.[0] ?? ''}</text>`
      + `</svg>`;
  }
  const id = `mk${_uid++}`;
  const a = labels[0];
  const b = labels[labels.length - 1];
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${d}" height="${d}" viewBox="0 0 ${d} ${d}">`
    + `<defs><clipPath id="${id}"><circle cx="${r}" cy="${r}" r="${r - 2}"/></clipPath></defs>`
    + `<g clip-path="url(#${id})">`
    + `<rect x="0" y="0" width="${r}" height="${d}" fill="${PIN_COLOR}"/>`
    + `<rect x="${r}" y="0" width="${r}" height="${d}" fill="#16429a"/>`
    + `</g>`
    + `<circle cx="${r}" cy="${r}" r="${r - 2}" fill="none" stroke="#fff" stroke-width="2.5"/>`
    + `<line x1="${r}" y1="3" x2="${r}" y2="${d - 3}" stroke="#fff" stroke-width="1.5"/>`
    + `<text x="${r / 2}" y="${r}" dy="0.35em" text-anchor="middle" fill="#fff" ${TXT} font-size="${fs - 2}">${a}</text>`
    + `<text x="${r * 1.5}" y="${r}" dy="0.35em" text-anchor="middle" fill="#fff" ${TXT} font-size="${fs - 2}">${b}</text>`
    + `</svg>`;
}

export function svgDataUri(svg) {
  return 'data:image/svg+xml;charset=UTF-8,' + encodeURIComponent(svg);
}

export function markerPixelSize(active) { return active ? 36 : 30; }
