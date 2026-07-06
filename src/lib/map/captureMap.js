// Share-card map capture (TRIP-193, phase 1).
//
// Renders the trip route on a dedicated, off-screen high-resolution Mapbox GL
// map and snapshots it to a PNG. The snapshot becomes the map layer of the
// share card (the server composites the branded frame/text/QR around it), so the
// card map uses the SAME live Standard v3 style + real route as the app - no
// Static Images API, no server-side Mapbox.
//
// Why a dedicated instance (not the on-screen map):
//   • we need `preserveDrawingBuffer: true` to read the canvas, which we don't
//     want to force on the shared app map (GL perf);
//   • we need a deterministic output size / aspect (card format), independent of
//     wherever the app map happens to be sized on screen.
//
// Crispness: the GL canvas backing store is (CSS size × devicePixelRatio). We
// size the container to the target and then downscale the (>= target) capture to
// the exact target with a 2D canvas, so the result is always at least 1:1 and
// normalised to the card's pixel size. On a retina device this yields a
// super-sampled, sharp image.
//
// NOTE: HTML markers (mapboxgl.Marker) are DOM overlays and are NOT part of the
// WebGL canvas, so a canvas snapshot would omit them. City points are therefore
// drawn as a GL `circle` layer here so they are captured.
import mapboxgl from 'mapbox-gl';
import { MAPBOX_TOKEN, MAP_STYLE, baseConfig, fitToPoints } from '@/lib/mapbox';
import { drawRouteLinesCached } from '@/lib/map/routeLines';
import { routeColor } from '@/lib/map/mapTokens';
import { sortVisits } from '@/lib/validation';

// Card pixel sizes per format (the map is captured full-bleed at card size;
// the server crops/places it per template).
const CARD_SIZE = {
  story: { w: 1080, h: 1920 },
  post: { w: 1080, h: 1350 },
};

/** Ordered geo points + route legs for the trip, mirroring MapView's rule. */
function buildRoute(visits, transfers, showSE) {
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

/** Draw city points as a captured GL layer (HTML markers wouldn't snapshot). */
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
  } else {
    map.addSource(src, { type: 'geojson', data });
    map.addLayer({
      id: 'sc-points-halo',
      type: 'circle',
      source: src,
      paint: { 'circle-radius': 9, 'circle-color': '#ffffff' },
    });
    map.addLayer({
      id: 'sc-points-dot',
      type: 'circle',
      source: src,
      paint: { 'circle-radius': 5.5, 'circle-color': routeColor() },
    });
  }
}

/**
 * Capture the trip route map to a PNG data URL.
 *
 * @param {object} o
 * @param {Array}  o.visits      city visits (with latitude/longitude/kind)
 * @param {Array}  o.transfers   transfers (for per-leg transport kind)
 * @param {'story'|'post'} o.format
 * @param {'DARK'|'LIGHT'} o.scheme
 * @param {string} o.lang        basemap label language
 * @param {'mercator'|'globe'} o.projection
 * @param {number} o.pitch       0..60
 * @param {number} o.bearing
 * @param {boolean} o.showSE     include start/end anchors
 * @returns {Promise<string|null>} PNG data URL, or null if unavailable
 */
export async function captureRouteMapPng(o) {
  const {
    visits = [], transfers = [], format = 'story', scheme = 'DARK', lang = 'en',
    projection = 'mercator', pitch = 0, bearing = 0, showSE = false,
  } = o || {};
  if (!MAPBOX_TOKEN) return null;

  const { w, h } = CARD_SIZE[format] || CARD_SIZE.story;
  const { ordered, legs } = buildRoute(visits, transfers, showSE);
  if (ordered.length === 0) return null;

  // Off-screen container sized to the card. GL renders it at CSS×DPR (>= target).
  const el = document.createElement('div');
  el.style.cssText = `position:fixed;left:-99999px;top:0;width:${w}px;height:${h}px;`;
  document.body.appendChild(el);

  let map;
  try {
    map = new mapboxgl.Map({
      container: el,
      style: MAP_STYLE,
      config: baseConfig(scheme),
      ...(lang ? { language: lang } : {}),
      projection,
      pitch,
      bearing,
      center: [ordered[0].longitude, ordered[0].latitude],
      zoom: 2,
      interactive: false,
      preserveDrawingBuffer: true,
      attributionControl: false,
      fadeDuration: 0,
    });

    await new Promise((res) => map.once('load', res));

    drawRouteLinesCached(map, `sc:${format}`, legs, { dashedId: 'sc-dashed', solidId: 'sc-solid' });
    drawPointLayer(map, ordered);
    fitToPoints(map, ordered.map((v) => [v.longitude, v.latitude]), { padding: 90, maxZoom: 9, animate: false });

    // Wait until tiles + route are fully rendered.
    await new Promise((res) => map.once('idle', res));

    const srcCanvas = map.getCanvas();
    // Normalise to exact card size (downscale the >= target capture).
    const out = document.createElement('canvas');
    out.width = w;
    out.height = h;
    out.getContext('2d').drawImage(srcCanvas, 0, 0, w, h);
    return out.toDataURL('image/png');
  } catch (e) {
    console.error('captureRouteMapPng failed', e);
    return null;
  } finally {
    if (map) map.remove();
    el.remove();
  }
}
