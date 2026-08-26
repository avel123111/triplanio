// Share-card map helpers (TRIP-193 → TRIP-443).
//
// The share card's map is the LIVE Mapbox map the user composes in the dialog
// (ShareMapPreview). This module owns the shared pieces: building the ordered
// route + legs, drawing the route line + city markers onto a map, and rendering
// the composed map to a PNG for the browser-rasterised card.
//
// TRIP-443: the card map runs on the SAME Mapbox style as every other app
// surface (MAP_STYLE — the trip Map lens / overview). City markers are BOLD BLUE
// DOTS (Ilia's request: back to plain markers, no country flags), no city names.
// The dot colour reuses the route token `--map-route` (mapTokens.routeColor) so
// the markers match the route line and follow day/night. The map includes the
// start/finish cities (showSE) so the whole journey shows — the stats TEXT under
// the title stays transit-only (edge side).
//
// NOTE: HTML markers (mapboxgl.Marker) are DOM overlays and are NOT part of the
// WebGL canvas, so a canvas snapshot would omit them. City markers are therefore
// drawn as GL circle layers here (a white halo + a blue dot) so they are captured.
import mapboxgl from 'mapbox-gl';
import { MAPBOX_TOKEN, MAP_STYLE, baseConfig } from '@/lib/mapbox';
import { drawRouteLinesCached } from '@/lib/map/routeLines';
import { routeColor } from '@/lib/map/mapTokens';
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

// Share-card-only map weights (TRIP-193 → TRIP-443). Bolder than the app maps so
// the route + markers read at story/post scale. Kept in ONE place because the live
// preview scales these same base values (ShareMapPreview.applyWeights) to keep
// preview == final. `dot` = the blue city marker radius; `halo` = the white casing
// under it (logical px on the full-res card).
export const SC_WEIGHTS = { solid: 6, dashed: 4, dot: 13, halo: 17 };

/** City point source + white-halo/blue-dot marker layer under EVERY point. The
 *  dot colour reuses the route token (`--map-route`) so markers match the line
 *  and follow day/night; the white halo keeps the dot legible on any basemap. */
function drawPointLayer(map, ordered) {
  const src = 'sc-points';
  const data = {
    type: 'FeatureCollection',
    features: ordered.map((v) => ({
      type: 'Feature',
      geometry: { type: 'Point', coordinates: [v.longitude, v.latitude] },
      properties: {},
    })),
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
    paint: { 'circle-radius': SC_WEIGHTS.dot, 'circle-color': routeColor() },
  });
}

/**
 * Draw the route line + city markers on a map (shared by capture + live preview).
 * Markers are plain GL circle layers (added synchronously), so — unlike the old
 * flag-icon path — there is nothing async to await before snapshotting.
 */
export function drawTripRoute(map, ordered, legs) {
  drawRouteLinesCached(map, 'sc-route', legs, {
    dashedId: 'sc-dashed', solidId: 'sc-solid',
    solidWidth: SC_WEIGHTS.solid, dashedWidth: SC_WEIGHTS.dashed,
  });
  drawPointLayer(map, ordered);
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
    // preview hit). Draw on 'idle' once the style is ready; markers are plain
    // circle layers added synchronously, so the next idle can snapshot directly.
    const tryDraw = () => {
      if (drew || !map.isStyleLoaded()) return;
      try {
        drawTripRoute(map, ordered, legs);
        drew = true;
      } catch { /* retry next idle */ }
    };
    const onIdle = () => { if (!drew) tryDraw(); else snapshot(); };
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
