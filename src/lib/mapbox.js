// Shared Mapbox GL setup - single source of truth for token + styles so the
// trip Map lens, the planner previews and the mini-map all render consistently.
// Note: Mapbox uses [lng, lat] order (GeoJSON), the opposite of Leaflet/Google.
import mapboxgl from 'mapbox-gl';

export const MAPBOX_TOKEN = import.meta.env.VITE_MAPBOX_TOKEN;
if (MAPBOX_TOKEN) mapboxgl.accessToken = MAPBOX_TOKEN;

// One Mapbox Standard style for every map surface. Light/dark is the
// `lightPreset` config (day/night), switched in place - the map is NOT
// re-created on theme change. `theme: 'default'`.
export const MAP_STYLE = 'mapbox://styles/avel1231/cmqogtezo001s01qzal5699es';
// Dedicated Standard-based style for the share card map only (TRIP-193). Same
// `lightPreset` day/night config as MAP_STYLE, so the card's light/dark toggle
// keeps working; the in-app map surfaces stay on MAP_STYLE.
export const SHARE_MAP_STYLE = 'mapbox://styles/avel1231/cmr9qqc7u001801r1923v90fn';
export const lightPresetFor = (scheme) => (scheme === 'DARK' ? 'night' : 'day');

// Initial style config - passed to `new mapboxgl.Map({ config })` to avoid a flash.
// `theme` is the Standard basemap theme: 'default' (colour) everywhere, except the
// Trips home + "My statistics" maps which pass 'monochrome' (grey). Switching it is
// an in-place setConfigProperty (same as lightPreset) — NOT setStyle — so the single
// session instance is preserved (tiles/sources/markers/lines stay).
// NOTE: label language is NOT a basemap config property — it is the top-level Map
// option `language` set at construction in MapProvider (see ensureMap).
export const baseConfig = (scheme, theme = 'default') => ({ basemap: { theme, lightPreset: lightPresetFor(scheme) } });

// Apply/refresh basemap config after the style is ready (for live theme toggling).
export function applyBasemapConfig(map, scheme, theme = 'default') {
  if (!map) return;
  const set = () => {
    try {
      map.setConfigProperty('basemap', 'theme', theme);
      map.setConfigProperty('basemap', 'lightPreset', lightPresetFor(scheme));
    } catch { /* style/config not ready */ }
  };
  if (map.isStyleLoaded()) set(); else map.once('style.load', set);
}

// Clamp a numeric bounds-fit padding to the map's current canvas so a fit is always
// geometrically possible. Mapbox's cameraForBounds (used by fitBounds AND directly)
// emits warnOnce("Map cannot fit within canvas with the given bounds, padding, and/or
// offset.") and silently refuses the fit whenever the padding meets/exceeds the canvas
// on either axis. The `canFit` gate (useMapSurface) already blocks a ZERO-size slot;
// this closes the SMALL-but-nonzero slot (a mini-map, a short lens) where e.g.
// padding 110 needs a >220px axis. On a normal-size canvas the clamp is a no-op, so
// the common path is unchanged — it only ever shrinks padding that literally cannot
// fit, making the illegal camera command unrepresentable rather than papering over it.
export function clampPadding(map, padding = 0) {
  if (!map || typeof padding !== 'number' || !(padding > 0)) return padding;
  let smaller = 0;
  try {
    const el = map.getContainer();
    smaller = Math.min(el?.clientWidth || 0, el?.clientHeight || 0);
  } catch { return padding; }
  if (!smaller) return padding; // unmeasured — the canFit gate should have prevented this
  // Leave ≥16px of canvas between the two paddings so the fit stays valid.
  const maxPad = Math.max(0, Math.floor(smaller / 2) - 8);
  return Math.min(padding, maxPad);
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
  map.fitBounds(b, { padding: clampPadding(map, opts.padding ?? 48), maxZoom: opts.maxZoom ?? 8, duration });
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
