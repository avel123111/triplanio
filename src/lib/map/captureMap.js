// Share-card map helpers (TRIP-193 → TRIP-443).
//
// The share card's map is the LIVE Mapbox map the user composes in the dialog
// (ShareMapPreview). This module owns the shared pieces: building the ordered
// route + legs, drawing the route line + city markers onto a map, and rendering
// the composed map to a PNG for the browser-rasterised card.
//
// TRIP-443: the card map runs on the SAME Mapbox style as every other app
// surface (MAP_STYLE — the trip Map lens / overview). City markers are round
// COUNTRY-FLAG chips (Ilia's request: flags instead of plain dots), no city
// names. The map now also includes the start/finish cities (showSE) so the whole
// journey shows — the stats TEXT under the title stays transit-only (edge side).
//
// NOTE: HTML markers (mapboxgl.Marker) are DOM overlays and are NOT part of the
// WebGL canvas, so a canvas snapshot would omit them. City markers are therefore
// drawn as GL layers here (flag icons as a symbol layer, a fallback dot as a
// circle layer) so they are captured.
import mapboxgl from 'mapbox-gl';
import { MAPBOX_TOKEN, MAP_STYLE, baseConfig } from '@/lib/mapbox';
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
// `flag` = diameter of the round flag marker (logical px on the full-res card);
// `dot`/`halo` are the fallback marker for a city with no country code.
export const SC_WEIGHTS = { solid: 6, dashed: 4, dot: 7.5, halo: 11, flag: 46 };
const SC_DOT_COLOR = '#E11D48'; // rose-600 — fallback marker (flagless city)
const SC_FLAG_DPR = 2; // raster scale so the flag chip stays crisp
const SC_FLAG_RING = 3; // white ring width around the flag (logical px)

// Normalised ISO2 country code of a visit (lowercased), '' when absent.
const cityCc = (v) => (v.country_code || '').trim().toLowerCase();

// Decoded /flags/<cc>.svg <img> for drawImage (same flag source as the card frame).
function loadFlagImg(cc) {
  return new Promise((resolve, reject) => {
    const im = new globalThis.Image();
    im.onload = () => resolve(im);
    im.onerror = reject;
    im.src = `/flags/${cc}.svg`;
  });
}

// Composite one round flag chip (flag cover-fit inside a circle + white ring) to
// an ImageData at `d` logical px. A single image ⇒ the map only has to place one
// icon per city, pixel-exact and captured by the snapshot.
function composeFlagChip(flagImg, d) {
  const c = document.createElement('canvas');
  c.width = Math.round(d * SC_FLAG_DPR);
  c.height = Math.round(d * SC_FLAG_DPR);
  const ctx = c.getContext('2d');
  ctx.scale(SC_FLAG_DPR, SC_FLAG_DPR);
  const r = d / 2;
  // White ring backing (the flag is clipped to a slightly smaller circle).
  ctx.beginPath();
  ctx.arc(r, r, r, 0, Math.PI * 2);
  ctx.fillStyle = '#ffffff';
  ctx.fill();
  ctx.save();
  ctx.beginPath();
  ctx.arc(r, r, r - SC_FLAG_RING, 0, Math.PI * 2);
  ctx.clip();
  const iw = flagImg.width || 4;
  const ih = flagImg.height || 3;
  const scale = Math.max(d / iw, d / ih); // cover
  const dw = iw * scale;
  const dh = ih * scale;
  ctx.drawImage(flagImg, r - dw / 2, r - dh / 2, dw, dh);
  ctx.restore();
  return ctx.getImageData(0, 0, c.width, c.height);
}

// Build one flag image per unique country code present (id `sc-flag-<cc>`). Awaits
// each SVG; a per-flag failure just leaves that city on the fallback dot.
async function buildFlagImages(map, ordered) {
  const seen = new Set();
  for (const v of ordered) {
    const cc = cityCc(v);
    if (cc.length !== 2 || seen.has(cc)) continue;
    seen.add(cc);
    let img;
    try {
      // eslint-disable-next-line no-await-in-loop
      img = await loadFlagImg(cc);
    } catch { continue; } // name/flag missing → fallback dot handles this city
    const id = `sc-flag-${cc}`;
    const data = composeFlagChip(img, SC_WEIGHTS.flag);
    if (map.hasImage(id)) map.updateImage(id, data);
    else map.addImage(id, data, { pixelRatio: SC_FLAG_DPR });
  }
}

/** City point source + white-halo/red-dot layer under EVERY point. A city with a
 *  flag gets its round flag chip drawn ON TOP (sc-flags) which covers the dot;
 *  a city with no flag (or a flag that failed to load) keeps the dot — so no
 *  marker ever goes invisible. */
function drawPointLayer(map, ordered) {
  const src = 'sc-points';
  const data = {
    type: 'FeatureCollection',
    features: ordered.map((v) => {
      const cc = cityCc(v);
      return {
        type: 'Feature',
        geometry: { type: 'Point', coordinates: [v.longitude, v.latitude] },
        properties: { flag: cc.length === 2 ? cc : '' },
      };
    }),
  };
  if (map.getSource(src)) {
    map.getSource(src).setData(data);
    return;
  }
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

// Round-flag symbol layer: one flag chip per city (icon-image resolved from the
// feature's country code). allow-overlap so a dense route keeps every flag.
function ensureFlagLayer(map, iconScale) {
  if (map.getLayer('sc-flags')) {
    map.setLayoutProperty('sc-flags', 'icon-size', iconScale);
    return;
  }
  map.addLayer({
    id: 'sc-flags',
    type: 'symbol',
    source: 'sc-points',
    filter: ['!=', ['get', 'flag'], ''],
    layout: {
      'icon-image': ['concat', 'sc-flag-', ['get', 'flag']],
      'icon-size': iconScale,
      'icon-anchor': 'center',
      'icon-allow-overlap': true,
      'icon-ignore-placement': true,
    },
  });
}

/**
 * Draw the route line + flag markers on a map (shared by capture + live preview).
 * Flag images build async (SVG decode); the returned promise (map.__scFlags) lets
 * the capture wait for them before snapshotting. `iconScale` = the flag layer's
 * icon-size (1 on the full card, `s` in the shrunk preview).
 */
export function drawTripRoute(map, ordered, legs, opts = {}) {
  const { iconScale = 1 } = opts;
  drawRouteLinesCached(map, 'sc-route', legs, {
    dashedId: 'sc-dashed', solidId: 'sc-solid',
    solidWidth: SC_WEIGHTS.solid, dashedWidth: SC_WEIGHTS.dashed,
  });
  drawPointLayer(map, ordered);
  // Порядок в КОРНЕ убирает гонку иконок (TRIP-261): слой `sc-flags` ссылается на
  // `sc-flag-<cc>`, поэтому добавлять его МОЖНО только ПОСЛЕ того, как
  // buildFlagImages (async — декодит SVG) эти иконки положил.
  map.__scFlags = (async () => {
    await buildFlagImages(map, ordered);
    ensureFlagLayer(map, iconScale);
  })();
}

// ---- browser-side card rendering (TRIP-193 Ф2) ------------------------------
// The final card is rasterised in the browser now (no edge resvg -> no HTTP 546,
// no 600px map cap). Two pieces live here: render the composed route map at the
// card's real resolution, and turn the card SVG (with that map baked in) into a
// PNG blob.

/**
 * Перенос зума композиции между поверхностями РАЗНОЙ ширины — единственный дом
 * формулы (читают capture ниже и живой ShareMapPreview): зум mapbox мерит мир в
 * пикселях, та же геосцена на вдвое широкой поверхности = +1 зум. Неизвестная
 * ширина с любой стороны → зум не пересчитывается (сдвиг 0), NaN невозможен.
 */
export const rescaleZoom = (zoom, fromW, toW) =>
  zoom + Math.log2((toW || fromW || 1) / (fromW || toW || 1));

/**
 * Render the trip route map to a PNG blob at `width`x`height`, reproducing the
 * camera the user composed in the preview. A throwaway offscreen map is used so
 * we can render at the card's real resolution instead of the tiny on-screen
 * preview - this is what makes the map sharp. Zoom is compensated for the larger
 * pixel size (`+log2(width/previewCssWidth)`) so the FRAMING matches the preview.
 * Resolves null if the map can't be produced (caller surfaces an error).
 */
export function renderCardMapPng({
  visits, transfers, showSE = true,
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

    const zoomAdj = rescaleZoom(zoom, previewCssWidth, width);
    const map = new mapboxgl.Map({
      container: holder,
      style: MAP_STYLE,
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
    // AFTER the route + flag markers are added and repainted.
    const tryDraw = () => {
      if (drew || !map.isStyleLoaded()) return;
      try {
        drawTripRoute(map, ordered, legs, { iconScale: 1 });
        drew = true;
        // Snapshot only AFTER the flag images build + place (or fail) so the
        // markers are painted; a repaint on resolve gives the idle handler its cue.
        (map.__scFlags || Promise.resolve()).then(() => { map.__scFlagsDone = true; try { map.triggerRepaint(); } catch { /* gone */ } });
      } catch { /* retry next idle */ }
    };
    const onIdle = () => { if (!drew) tryDraw(); else if (map.__scFlagsDone) snapshot(); };
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
