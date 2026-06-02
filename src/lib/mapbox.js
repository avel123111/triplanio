// Shared Mapbox GL setup - single source of truth for token + styles so the
// trip Map lens, the planner previews and the mini-map all render consistently.
// Note: Mapbox uses [lng, lat] order (GeoJSON), the opposite of Leaflet/Google.
import mapboxgl from 'mapbox-gl';

export const MAPBOX_TOKEN = import.meta.env.VITE_MAPBOX_TOKEN;
if (MAPBOX_TOKEN) mapboxgl.accessToken = MAPBOX_TOKEN;

// One Mapbox Standard style for every map surface. Light/dark is the
// `lightPreset` config (day/night), switched in place - the map is NOT
// re-created on theme change. `theme: 'default'`.
export const MAP_STYLE = 'mapbox://styles/mapbox/standard';
export const lightPresetFor = (scheme) => (scheme === 'DARK' ? 'night' : 'day');

// Initial style config - passed to `new mapboxgl.Map({ config })` to avoid a flash.
export const baseConfig = (scheme) => ({ basemap: { theme: 'default', lightPreset: lightPresetFor(scheme) } });

// Apply/refresh basemap config after the style is ready (for live theme toggling).
export function applyBasemapConfig(map, scheme) {
  if (!map) return;
  const set = () => {
    try {
      map.setConfigProperty('basemap', 'theme', 'default');
      map.setConfigProperty('basemap', 'lightPreset', lightPresetFor(scheme));
    } catch { /* style/config not ready */ }
  };
  if (map.isStyleLoaded()) set(); else map.once('style.load', set);
}

// Fit the map to a set of [lng, lat] points. Single point → centered; empty → no-op.
// Pass opts.animate (or opts.duration) to ease the camera to the new bounds
// instead of jumping - used while the route is being edited so the map glides
// out/in as cities are added, removed or reordered.
export function fitToPoints(map, points, opts = {}) {
  if (!map || !points || points.length === 0) return;
  const duration = opts.duration ?? (opts.animate ? 650 : 0);
  if (points.length === 1) {
    map.easeTo({ center: points[0], zoom: opts.singleZoom ?? 7, duration });
    return;
  }
  const b = new mapboxgl.LngLatBounds();
  points.forEach((p) => b.extend(p));
  map.fitBounds(b, { padding: opts.padding ?? 48, maxZoom: opts.maxZoom ?? 8, duration });
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
        // Mapbox Standard lights layers by the scene; without full emissive
        // strength custom lines render dark/black under the `night` preset.
        // Keeping it at 1 makes the line show its true colour in both themes.
        'line-emissive-strength': 1,
        ...(dashed ? { 'line-dasharray': [2, 2] } : {}),
      },
    });
  } else {
    map.getSource(id).setData(data);
  }
}

export { mapboxgl };
