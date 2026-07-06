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
import { supabase } from '@/api/supabaseClient';
import { MAPBOX_TOKEN, MAP_STYLE, baseConfig, fitToPoints } from '@/lib/mapbox';
import { drawRouteLinesCached, prewarmRoadGeometry } from '@/lib/map/routeLines';
import { routeColor } from '@/lib/map/mapTokens';
import { sortVisits } from '@/lib/validation';

const SHARE_MAPS_BUCKET = 'share-maps';

// Capture resolution per format (the map keeps the card's aspect but is snapshot
// at a reduced size). This is DELIBERATELY well below the 1080-wide card: the
// server rasterizes this map INTO the card via resvg, and a full 1080x1920 map
// raster pushed the edge function past its CPU/memory limit (HTTP 546). ~600px
// wide keeps resvg comfortably under budget and is still crisp in the map slot;
// raise it later if we move the render to more compute / optimize the pipeline.
const CARD_SIZE = {
  story: { w: 600, h: 1067 },
  post: { w: 600, h: 750 },
};

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

/** Draw the route line + city points on a map (shared by capture + live preview). */
export function drawTripRoute(map, ordered, legs) {
  drawRouteLinesCached(map, 'sc-route', legs, { dashedId: 'sc-dashed', solidId: 'sc-solid' });
  drawPointLayer(map, ordered);
}

/**
 * Capture the trip route map to a PNG blob.
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
 * @returns {Promise<Blob|null>} PNG blob, or null if unavailable
 */
export async function captureRouteMapBlob(o) {
  const {
    visits = [], transfers = [], format = 'story', scheme = 'DARK', lang = 'en',
    projection = 'mercator', pitch = 0, bearing = 0, showSE = false, camera = null, size = null,
  } = o || {};
  if (!MAPBOX_TOKEN) return null;

  // Capture at the map-window size (from the template slot) when given, else the
  // whole-card fallback. Keeping it modest keeps the server resvg render light.
  const { w, h } = (size && size.w && size.h) ? size : (CARD_SIZE[format] || CARD_SIZE.story);
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

    // Resolve road geometry while the map style loads, so drawTripRoute paints
    // roads with their final curved shape (not the straight-then-async fallback
    // that the snapshot would otherwise capture).
    await Promise.all([
      new Promise((res) => map.once('load', res)),
      prewarmRoadGeometry(legs),
    ]);

    drawTripRoute(map, ordered, legs);
    if (camera && Array.isArray(camera.center)) {
      // Mirror the exact view the user composed in the interactive preview.
      map.jumpTo({ center: camera.center, zoom: camera.zoom, bearing: camera.bearing || 0, pitch: camera.pitch || 0 });
    } else {
      fitToPoints(map, ordered.map((v) => [v.longitude, v.latitude]), { padding: 90, maxZoom: 9, animate: false });
    }

    // Wait until tiles + route are fully rendered.
    await new Promise((res) => map.once('idle', res));

    const srcCanvas = map.getCanvas();
    // Normalise to exact card size (downscale the >= target capture).
    const out = document.createElement('canvas');
    out.width = w;
    out.height = h;
    out.getContext('2d').drawImage(srcCanvas, 0, 0, w, h);
    return await new Promise((resolve) => out.toBlob((b) => resolve(b), 'image/png'));
  } catch (e) {
    console.error('captureRouteMapBlob failed', e);
    return null;
  } finally {
    if (map) map.remove();
    el.remove();
  }
}

/**
 * Capture the route map and upload it to `share-maps/{tripId}/{uuid}.png`.
 * Returns the storage path (for render-share-card's `map_path`), or null if the
 * capture or upload fails - the caller then falls back to the server map.
 */
export async function captureAndUploadRouteMap(tripId, opts) {
  if (!tripId) return null;
  const blob = await captureRouteMapBlob(opts);
  if (!blob) return null;
  const path = `${tripId}/${crypto.randomUUID()}.png`;
  const { error } = await supabase.storage.from(SHARE_MAPS_BUCKET)
    .upload(path, blob, { contentType: 'image/png', upsert: false });
  if (error) { console.error('share-maps upload failed', error); return null; }
  return path;
}
