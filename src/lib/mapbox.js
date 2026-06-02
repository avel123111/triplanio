// Shared Mapbox GL setup — single source of truth for token + styles so the
// trip Map lens, the planner previews and the mini-map all render consistently.
// Note: Mapbox uses [lng, lat] order (GeoJSON), the opposite of Leaflet/Google.
import mapboxgl from 'mapbox-gl';

export const MAPBOX_TOKEN = import.meta.env.VITE_MAPBOX_TOKEN;
if (MAPBOX_TOKEN) mapboxgl.accessToken = MAPBOX_TOKEN;

// Match the app's light/dark theme toggle (colorScheme LIGHT/DARK).
export const STYLE_LIGHT = 'mapbox://styles/avel1231/cmdj48my7004r01s8grdu846i';
export const STYLE_DARK = 'mapbox://styles/avel1231/cmpvw5xmt000y01s7ekeghrxs';
export const styleFor = (scheme) => (scheme === 'DARK' ? STYLE_DARK : STYLE_LIGHT);

// Fit the map to a set of [lng, lat] points. Single point → centered; empty → no-op.
export function fitToPoints(map, points, opts = {}) {
  if (!map || !points || points.length === 0) return;
  if (points.length === 1) {
    map.setCenter(points[0]);
    map.setZoom(opts.singleZoom ?? 7);
    return;
  }
  const b = new mapboxgl.LngLatBounds();
  points.forEach((p) => b.extend(p));
  map.fitBounds(b, { padding: opts.padding ?? 48, maxZoom: opts.maxZoom ?? 8, duration: 0 });
}

// Wrap an SVG/HTML string into a DOM element usable as a mapboxgl.Marker.
export function htmlMarkerEl(html) {
  const el = document.createElement('div');
  el.innerHTML = html;
  el.style.cursor = 'pointer';
  el.style.lineHeight = '0';
  return el;
}

// GeoJSON LineString feature from [[lng,lat], ...].
export const lineFeature = (coords) => ({
  type: 'Feature',
  geometry: { type: 'LineString', coordinates: coords },
  properties: {},
});

// Idempotently create a line source+layer, then push features into it.
export function setLineLayer(map, id, features, { color, width, dashed = false, opacity }) {
  const data = { type: 'FeatureCollection', features };
  if (!map.getSource(id)) {
    map.addSource(id, { type: 'geojson', data });
    map.addLayer({
      id,
      type: 'line',
      source: id,
      layout: { 'line-cap': 'round', 'line-join': 'round' },
      paint: {
        'line-color': color,
        'line-width': width,
        'line-opacity': opacity ?? (dashed ? 0.5 : 1),
        ...(dashed ? { 'line-dasharray': [2, 2] } : {}),
      },
    });
  } else {
    map.getSource(id).setData(data);
  }
}

export { mapboxgl };
