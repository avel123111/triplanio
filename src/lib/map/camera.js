// Shared adaptive "calm" camera for every NON-public map (editor / stats / overview
// / planner / create + the hotel-overlay clustering). ONE tempo, reused everywhere
// so behaviour can't drift between surfaces.
//
// Why adaptive: a fixed duration makes a 1-level nudge and a 9-level decluster take
// the SAME time → the big jump feels fast. Here the duration scales with how far the
// camera travels (|Δzoom| dominates, plus a little for long center pans), so a
// multi-level decluster or a large zoom change glides over a longer, even animation
// while a small hop stays snappy. The public shared-trip reader runs its own reveal
// mechanics (revealActiveId) and deliberately does NOT use these.
//
// Pairs with ./cluster.js — together they are the reusable clustering + zoom-behaviour
// core for any future map surface. The pure duration math lives in ./calmDuration.js
// (dependency-free → unit-testable).
import { mapboxgl, fitToPoints, clampPadding } from '@/lib/mapbox';
import { calmDuration } from '@/lib/map/calmDuration';

export { calmDuration };

// How far (in screenfuls) the center would move to `center` ([lng,lat]).
function centerScreens(map, center) {
  if (!center) return 0;
  try {
    const a = map.project(map.getCenter());
    const b = map.project({ lng: center[0], lat: center[1] });
    const px = Math.hypot(b.x - a.x, b.y - a.y);
    const el = map.getContainer();
    const span = Math.max(el?.clientWidth || 0, el?.clientHeight || 0) || 1;
    return px / span;
  } catch { return 0; }
}

// flyTo with an adaptive calm duration. target: { center?: [lng,lat], zoom?: number }.
export function calmFlyTo(map, target = {}) {
  if (!map) return;
  const toZoom = target.zoom != null ? target.zoom : map.getZoom();
  const duration = calmDuration({ dZoom: toZoom - map.getZoom(), screens: centerScreens(map, target.center) });
  map.flyTo({ ...target, duration, essential: true });
}

// Fit a set of [lng,lat] points with an adaptive calm duration. The target zoom is
// derived from cameraForBounds so the duration matches the ACTUAL zoom delta, then
// the existing fitToPoints does the fit (single source for the fit mechanics).
export function calmFit(map, points, opts = {}) {
  if (!map || !points || points.length === 0) return;
  const padding = opts.padding ?? 60;
  const maxZoom = opts.maxZoom ?? 8;
  let toZoom = map.getZoom();
  let center = null;
  if (points.length === 1) {
    toZoom = opts.singleZoom ?? 7;
    center = points[0];
  } else {
    try {
      const b = new mapboxgl.LngLatBounds(points[0], points[0]);
      points.forEach((p) => b.extend(p));
      const cam = map.cameraForBounds(b, { padding: clampPadding(map, padding), maxZoom });
      if (cam?.zoom != null) { toZoom = Math.min(cam.zoom, maxZoom); center = [cam.center.lng, cam.center.lat]; }
    } catch { /* fall back to current zoom for the estimate */ }
  }
  const duration = calmDuration({ dZoom: toZoom - map.getZoom(), screens: centerScreens(map, center) });
  fitToPoints(map, points, { ...opts, padding, maxZoom, duration });
}
