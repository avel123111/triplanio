// Pure adaptive camera-duration math — dependency-free leaf so it stays unit-
// testable under `node --test` (no map/mapbox imports). Used by ./camera.js.
//
// Why adaptive: a fixed duration makes a 1-level nudge and a 9-level decluster take
// the SAME time → the big jump feels fast. Here the duration scales with how far the
// camera travels (|Δzoom| dominates, plus a little for long center pans), so a
// multi-level decluster or a large zoom change glides over a longer, even animation
// while a small hop stays snappy.
const BASE_MS = 380;        // floor contribution for a near-zero move
const PER_ZOOM_MS = 300;    // added per level of zoom change → big jumps take longer
const PER_SCREEN_MS = 130;  // added per screenful of center pan
const MIN_MS = 420;
const MAX_MS = 3000;
const SCREEN_CAP = 5;       // center-pan contribution is capped here

// Duration (ms) for a camera move of |dZoom| zoom levels and `screens` screenfuls of
// center translation. Clamped to [MIN_MS, MAX_MS].
export function calmDuration({ dZoom = 0, screens = 0 } = {}) {
  const ms = BASE_MS + Math.abs(dZoom) * PER_ZOOM_MS + Math.min(screens, SCREEN_CAP) * PER_SCREEN_MS;
  return Math.round(Math.max(MIN_MS, Math.min(MAX_MS, ms)));
}
