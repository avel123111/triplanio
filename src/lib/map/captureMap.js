// Share-card map helpers (TRIP-193).
//
// The share card's map is the LIVE Mapbox map the user composes in the dialog
// (ShareMapPreview): the branded frame is laid over it and the parent snapshots
// that exact canvas (WYSIWYG) via ShareMapPreview.captureBlob(). This module owns
// the shared pieces of that flow: building the ordered route + legs, drawing the
// route line + city points onto a map, and uploading a captured PNG to
// `share-maps`.
//
// NOTE: HTML markers (mapboxgl.Marker) are DOM overlays and are NOT part of the
// WebGL canvas, so a canvas snapshot would omit them. City points are therefore
// drawn as a GL `circle` layer here so they are captured.
import { supabase } from '@/api/supabaseClient';
import { drawRouteLinesCached } from '@/lib/map/routeLines';
import { routeColor } from '@/lib/map/mapTokens';
import { sortVisits } from '@/lib/validation';

const SHARE_MAPS_BUCKET = 'share-maps';

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

/** Upload a captured map PNG to share-maps/{tripId}/{uuid}.png; returns the path. */
export async function uploadMapBlob(tripId, blob) {
  if (!tripId || !blob) return null;
  const path = `${tripId}/${crypto.randomUUID()}.png`;
  const { error } = await supabase.storage.from(SHARE_MAPS_BUCKET)
    .upload(path, blob, { contentType: 'image/png', upsert: false });
  if (error) { console.error('share-maps upload failed', error); return null; }
  return path;
}
