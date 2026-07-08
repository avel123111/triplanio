// Share-card map helpers (TRIP-193).
//
// The share card's map is the LIVE Mapbox map the user composes in the dialog
// (ShareMapPreview). This module owns the shared pieces: building the ordered
// route + legs, drawing the route line + city points onto a map, and rendering
// the composed map to a PNG for the browser-rasterised card.
//
// NOTE: HTML markers (mapboxgl.Marker) are DOM overlays and are NOT part of the
// WebGL canvas, so a canvas snapshot would omit them. City points are therefore
// drawn as a GL `circle` layer here so they are captured.
import mapboxgl from 'mapbox-gl';
import { MAPBOX_TOKEN, SHARE_MAP_STYLE, baseConfig } from '@/lib/mapbox';
import { drawRouteLinesCached } from '@/lib/map/routeLines';
import { sortVisits } from '@/lib/validation';

/** Ordered geo points + route legs for the trip, mirroring MapView's rule. */
export function buildRoute(visits, transfers, showSE) {
  const all = sortVisits(visits).filter((v) => v.latitude && v.longitude);
  const ordered = showSE ? all : all.filter((v) => v.kind !== 'start' && v.kind !== 'end');
  const byPair = new globalThis.Map();
  (transfers || []).forEach((t) => {
    const k = `${t.from_city_visit_id}__${t.to_city_visit_id}`;
    if (!byPair.has(k)) byPair.set(k, t);
  });
  const legs = [];
  for (let i = 0; i < ordered.length - 1; i++) {
    const from = ordered[i];
    const to = ordered[i + 1];
    legs.push({ from, to, kind: byPair.get(`${from.id}__${to.id}`)?.transport_type });
  }
  return { ordered, legs };
}

// Share-card-only map weights (TRIP-193). Bolder than the app maps so the route
// reads at story/post scale. Kept in ONE place because the live preview scales
// these same base values (ShareMapPreview.applyWeights) to keep preview == final.
// `dot` is a red marker (Pavel's request). `badge` = base icon-size for the city
// label image (1 = its native pixels; the preview downscales it by the same `s`).
export const SC_WEIGHTS = { solid: 6, dashed: 4, dot: 7.5, halo: 11, badge: 1 };
export const SC_DOT_COLOR = '#E11D48'; // rose-600 — the "red dot" marker

// City-label badge geometry (all logical px). The badge is composited to ONE image
// (flag + name), so alignment is pixel-exact and the name size is whatever we draw
// here — no Mapbox inline-image quirks. Bigger than the first pass (was unreadable).
const SC_LABEL_PX = 26; // city-name font size
const SC_FLAG_H = Math.round(SC_LABEL_PX * 0.86); // flag height, a peer of the name
const SC_BADGE_PAD = 5; // padding around the content (room for the halo)
const SC_BADGE_FLAG_GAP = 7; // gap between flag and name
const SC_BADGE_HALO = 2.6; // halo stroke half-width (lineWidth = 2×)
const SC_BADGE_DPR = 2; // raster scale so the baked text stays crisp
const SC_BADGE_FONT = `700 ${SC_LABEL_PX}px "Montserrat", "Golos Text", system-ui, sans-serif`;
// Gap (icon-units) from the dot centre to the nearest badge edge — clears the red
// dot + halo. In icon space, so it scales with the badge when the preview shrinks.
const SC_DOT_GAP_UNITS = SC_WEIGHTS.halo + 7;

// Text + halo colours per basemap scheme (no plate — Pavel: "без плашки" — so the
// halo alone carries legibility): dark ink + light halo on the light basemap,
// inverted on the dark one. Baked into the badge image, so a theme flip rebuilds it.
function badgeColors(scheme = 'LIGHT') {
  return scheme === 'DARK'
    ? { text: '#ffffff', halo: 'rgba(10,12,28,.9)' }
    : { text: '#14152a', halo: 'rgba(255,255,255,.96)' };
}

// Normalised ISO2 country code of a visit (lowercased), '' when absent.
const cityCc = (v) => (v.country_code || '').trim().toLowerCase();

// Decoded /flags/<cc>.svg <img> for drawImage (same flag source as .cbadge).
function loadFlagImg(cc) {
  return new Promise((resolve, reject) => {
    const im = new globalThis.Image();
    im.onload = () => resolve(im);
    im.onerror = reject;
    im.src = `/flags/${cc}.svg`;
  });
}

// Shared throwaway 2D context for measuring text advance (no DOM churn per call).
let _measureCtx;
function measureCtx() {
  if (!_measureCtx) _measureCtx = document.createElement('canvas').getContext('2d');
  return _measureCtx;
}

// Composite one city badge (flag + name, halo, no plate) to an ImageData + its
// logical w/h. A single image ⇒ the flag and name are aligned exactly and move as
// one unit; the map only has to place this one icon. `flagImg` null ⇒ name-only.
function composeBadge(name, flagImg, scheme) {
  const { text, halo } = badgeColors(scheme);
  const m = measureCtx();
  m.font = SC_BADGE_FONT;
  const textW = Math.ceil(m.measureText(name).width);
  const flagH = flagImg ? SC_FLAG_H : 0;
  const flagW = flagImg ? Math.max(1, Math.round(flagH * (flagImg.width / flagImg.height || 4 / 3))) : 0;
  const gap = flagImg ? SC_BADGE_FLAG_GAP : 0;
  const w = flagW + gap + textW + SC_BADGE_PAD * 2;
  const h = Math.max(flagH, SC_LABEL_PX) + SC_BADGE_PAD * 2;

  const c = document.createElement('canvas');
  c.width = Math.round(w * SC_BADGE_DPR);
  c.height = Math.round(h * SC_BADGE_DPR);
  const ctx = c.getContext('2d');
  ctx.scale(SC_BADGE_DPR, SC_BADGE_DPR);
  if (flagImg) ctx.drawImage(flagImg, SC_BADGE_PAD, (h - flagH) / 2, flagW, flagH);
  ctx.font = SC_BADGE_FONT;
  ctx.textBaseline = 'middle';
  ctx.textAlign = 'left';
  ctx.lineJoin = 'round';
  const tx = SC_BADGE_PAD + flagW + gap;
  const ty = h / 2 + 1;
  ctx.strokeStyle = halo;
  ctx.lineWidth = SC_BADGE_HALO * 2;
  ctx.strokeText(name, tx, ty);
  ctx.fillStyle = text;
  ctx.fillText(name, tx, ty);
  return { imageData: ctx.getImageData(0, 0, c.width, c.height), w, h };
}

// Build/refresh every city's badge image on the map (id `sc-badge-<i>`) and record
// its logical size in map.__scBadge (placement reads it). Awaits fonts first so the
// baked text uses Montserrat, not a fallback. Per-flag failure ⇒ name-only badge.
export async function buildBadgeImages(map, ordered, scheme) {
  if (document?.fonts?.ready) { try { await document.fonts.ready; } catch { /* ignore */ } }
  const sizes = [];
  for (let i = 0; i < ordered.length; i++) {
    const v = ordered[i];
    const cc = cityCc(v);
    let flagImg = null;
    // eslint-disable-next-line no-await-in-loop
    if (cc.length === 2) { try { flagImg = await loadFlagImg(cc); } catch { /* name-only */ } }
    const { imageData, w, h } = composeBadge(v.city_name || '', flagImg, scheme);
    const id = `sc-badge-${i}`;
    if (map.hasImage(id)) map.updateImage(id, imageData);
    else map.addImage(id, imageData, { pixelRatio: SC_BADGE_DPR });
    sizes[i] = { w, h };
  }
  map.__scBadge = sizes;
}

// Bounding box (container px) a badge would occupy on a given side of the dot.
function badgeBox(side, p, wd, hd, gap) {
  switch (side) {
    case 'left': return { x0: p.x - gap - wd, y0: p.y - hd / 2, x1: p.x - gap, y1: p.y + hd / 2 };
    case 'top': return { x0: p.x - wd / 2, y0: p.y - gap - hd, x1: p.x + wd / 2, y1: p.y - gap };
    case 'bottom': return { x0: p.x - wd / 2, y0: p.y + gap, x1: p.x + wd / 2, y1: p.y + gap + hd };
    default: return { x0: p.x + gap, y0: p.y - hd / 2, x1: p.x + gap + wd, y1: p.y + hd / 2 }; // right
  }
}

// icon-offset (icon-units, for icon-anchor:'center') that puts the badge on `side`
// clear of the dot. Multiplied by icon-size at render, so it scales with the badge.
function badgeOffset(side, sz) {
  const hw = sz.w / 2;
  const hh = sz.h / 2;
  switch (side) {
    case 'left': return [-(SC_DOT_GAP_UNITS + hw), 0];
    case 'top': return [0, -(SC_DOT_GAP_UNITS + hh)];
    case 'bottom': return [0, SC_DOT_GAP_UNITS + hh];
    default: return [SC_DOT_GAP_UNITS + hw, 0]; // right
  }
}

/**
 * Adaptive placement (TRIP-193): pick each badge's side so it leans INWARD (toward
 * the map centre) and stays inside the frame. The card clips the map to an organic
 * blob, so a badge spilling past the edge would vanish under the white border; by
 * projecting each city to pixels and preferring the side that points at the centre
 * — falling back through the other three until one fits the safe area — badges near
 * an edge flip away from it instead of hiding under the frame. Rewrites the shared
 * sc-points data with each feature's chosen `off` (icon-offset). `iconScale` = the
 * badge's current icon-size (base on the card, base×s in the shrunk preview).
 */
export function placeCityBadges(map, ordered, { cw, ch, iconScale }) {
  const src = map.getSource('sc-points');
  if (!src || !cw || !ch) return;
  const sizes = map.__scBadge || [];
  const margin = Math.max(10, Math.min(cw, ch) * 0.06); // keep clear of the blob edge/border
  const cx = cw / 2;
  const cy = ch / 2;
  const gap = SC_DOT_GAP_UNITS * iconScale;
  const features = ordered.map((v, i) => {
    const sz = sizes[i] || { w: 64, h: 28 };
    const wd = sz.w * iconScale;
    const hd = sz.h * iconScale;
    const p = map.project([v.longitude, v.latitude]);
    const horiz = p.x <= cx ? 'right' : 'left';
    const vert = p.y <= cy ? 'bottom' : 'top';
    const order = [horiz, vert, vert === 'bottom' ? 'top' : 'bottom', horiz === 'right' ? 'left' : 'right'];
    let side = horiz;
    for (const s of order) {
      const b = badgeBox(s, p, wd, hd, gap);
      if (b.x0 >= margin && b.y0 >= margin && b.x1 <= cw - margin && b.y1 <= ch - margin) { side = s; break; }
    }
    return {
      type: 'Feature',
      geometry: { type: 'Point', coordinates: [v.longitude, v.latitude] },
      properties: { badge: `sc-badge-${i}`, off: badgeOffset(side, sz) },
    };
  });
  src.setData({ type: 'FeatureCollection', features });
}

/** Draw city dots as a captured GL layer (HTML markers wouldn't snapshot). Seeds
 *  the sc-points source that both the dots and the badge symbols read. */
function drawPointLayer(map, ordered) {
  const src = 'sc-points';
  const data = {
    type: 'FeatureCollection',
    features: ordered.map((v, i) => ({
      type: 'Feature',
      geometry: { type: 'Point', coordinates: [v.longitude, v.latitude] },
      // `off` is refined by placeCityBadges once badge sizes are known; a plain
      // right-side default avoids a first-frame jump before that runs.
      properties: { badge: `sc-badge-${i}`, off: [SC_DOT_GAP_UNITS, 0] },
    })),
  };
  if (map.getSource(src)) {
    map.getSource(src).setData(data);
  } else {
    map.addSource(src, { type: 'geojson', data });
    map.addLayer({
      id: 'sc-points-halo',
      type: 'circle',
      source: src,
      paint: { 'circle-radius': SC_WEIGHTS.halo, 'circle-color': '#ffffff' },
    });
    map.addLayer({
      id: 'sc-points-dot',
      type: 'circle',
      source: src,
      paint: { 'circle-radius': SC_WEIGHTS.dot, 'circle-color': SC_DOT_COLOR },
    });
  }
}

// Add the city-badge symbol layer once. One icon per city (the composited badge),
// placed by a data-driven icon-offset; overlapping badges are hidden so a dense
// route stays legible (the dots always remain).
function ensureBadgeLayer(map) {
  if (map.getLayer('sc-labels')) return;
  map.addLayer({
    id: 'sc-labels',
    type: 'symbol',
    source: 'sc-points',
    layout: {
      'icon-image': ['get', 'badge'],
      'icon-size': SC_WEIGHTS.badge,
      'icon-anchor': 'center',
      'icon-offset': ['get', 'off'],
      'icon-allow-overlap': false,
      'icon-optional': false,
    },
  });
}

/**
 * Draw the route line + city dots + city-name badges on a map (shared by capture +
 * live preview). Badge images build async (fonts + flags); once ready they are
 * placed adaptively. The returned promise (map.__scLabels) lets the capture wait
 * for images + placement before snapshotting. `cw`/`ch` = map container px,
 * `iconScale` = current badge icon-size (for the fit maths).
 */
export function drawTripRoute(map, ordered, legs, opts = {}) {
  const { scheme = 'LIGHT', cw = 0, ch = 0, iconScale = SC_WEIGHTS.badge } = opts;
  drawRouteLinesCached(map, 'sc-route', legs, {
    dashedId: 'sc-dashed', solidId: 'sc-solid',
    solidWidth: SC_WEIGHTS.solid, dashedWidth: SC_WEIGHTS.dashed,
  });
  drawPointLayer(map, ordered);
  ensureBadgeLayer(map);
  map.__scLabels = (async () => {
    await buildBadgeImages(map, ordered, scheme);
    placeCityBadges(map, ordered, { cw, ch, iconScale });
  })();
}

// ---- browser-side card rendering (TRIP-193 Ф2) ------------------------------
// The final card is rasterised in the browser now (no edge resvg -> no HTTP 546,
// no 600px map cap). Two pieces live here: render the composed route map at the
// card's real resolution, and turn the card SVG (with that map baked in) into a
// PNG blob.

/**
 * Render the trip route map to a PNG blob at `width`x`height`, reproducing the
 * camera the user composed in the preview. A throwaway offscreen map is used so
 * we can render at the card's real resolution instead of the tiny on-screen
 * preview - this is what makes the map sharp. Zoom is compensated for the larger
 * pixel size (`+log2(width/previewCssWidth)`) so the FRAMING matches the preview.
 * Resolves null if the map can't be produced (caller surfaces an error).
 */
export function renderCardMapPng({
  visits, transfers, showSE = false,
  center, zoom, bearing = 0, pitch = 0, projection = 'mercator', scheme = 'DARK',
  previewCssWidth, width, height,
}) {
  return new Promise((resolve) => {
    if (!MAPBOX_TOKEN || !center || !width || !height) { resolve(null); return; }
    const { ordered, legs } = buildRoute(visits, transfers, showSE);
    if (!ordered.length) { resolve(null); return; }

    const holder = document.createElement('div');
    holder.style.cssText = `position:absolute;left:-99999px;top:0;width:${width}px;height:${height}px;`;
    document.body.appendChild(holder);

    const zoomAdj = previewCssWidth > 0 ? zoom + Math.log2(width / previewCssWidth) : zoom;
    const map = new mapboxgl.Map({
      container: holder,
      style: SHARE_MAP_STYLE,
      config: baseConfig(scheme),
      center,
      zoom: zoomAdj,
      bearing,
      pitch,
      projection,
      interactive: false,
      attributionControl: false,
      preserveDrawingBuffer: true, // canvas must be readable for the snapshot
      fadeDuration: 0,
    });

    let settled = false;
    let drew = false;
    let safety;
    const cleanup = () => { try { map.remove(); } catch { /* already gone */ } holder.remove(); };
    const snapshot = () => {
      if (settled) return;
      settled = true;
      clearTimeout(safety);
      map.off('idle', onIdle);
      try {
        const src = map.getCanvas();
        const out = document.createElement('canvas');
        out.width = width;
        out.height = height;
        out.getContext('2d').drawImage(src, 0, 0, width, height);
        out.toBlob((b) => { cleanup(); resolve(b); }, 'image/png');
      } catch (e) { console.error('card map render failed', e); cleanup(); resolve(null); }
    };
    // On the Standard style 'load' can precede style readiness, so addLayer would
    // silently no-op and the snapshot would miss the route (same trap the live
    // preview hit). Draw on 'idle' once the style is ready, and only snapshot
    // AFTER the route has been added and repainted.
    const tryDraw = () => {
      if (drew || !map.isStyleLoaded()) return;
      try {
        drawTripRoute(map, ordered, legs, { scheme, cw: width, ch: height, iconScale: SC_WEIGHTS.badge });
        drew = true;
        // Snapshot only AFTER the badge images build + place (or fail) so the labels
        // are painted; a repaint on resolve gives the idle handler its cue.
        (map.__scLabels || Promise.resolve()).then(() => { map.__scLabelsDone = true; try { map.triggerRepaint(); } catch { /* gone */ } });
      } catch { /* retry next idle */ }
    };
    const onIdle = () => { if (!drew) tryDraw(); else if (map.__scLabelsDone) snapshot(); };
    map.once('load', tryDraw);
    map.on('idle', onIdle);
    // Safety net: never hang the "build card" button if 'idle' never settles.
    safety = setTimeout(snapshot, 8000);
  });
}

/** Read a Blob as a data URI (to inline the map into the card SVG). */
export function blobToDataUri(blob) {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(r.result);
    r.onerror = reject;
    r.readAsDataURL(blob);
  });
}

/**
 * Rasterise a self-contained card SVG string (fonts + images all data URIs) to a
 * PNG blob at `width`x`height`. Fonts are awaited first so the SVG paints with the
 * embedded faces, not a fallback. Everything inside the SVG is a data URI, so the
 * canvas is not tainted and toBlob() succeeds.
 */
export async function rasterizeSvgToPng(svg, width, height) {
  if (document?.fonts?.ready) { try { await document.fonts.ready; } catch { /* ignore */ } }
  const url = URL.createObjectURL(new Blob([svg], { type: 'image/svg+xml;charset=utf-8' }));
  try {
    const img = await new Promise((resolve, reject) => {
      const im = new Image();
      im.onload = () => resolve(im);
      im.onerror = () => reject(new Error('svg image load failed'));
      im.src = url;
    });
    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    canvas.getContext('2d').drawImage(img, 0, 0, width, height);
    return await new Promise((resolve, reject) => {
      canvas.toBlob((b) => (b ? resolve(b) : reject(new Error('toBlob returned null'))), 'image/png');
    });
  } finally {
    URL.revokeObjectURL(url);
  }
}
