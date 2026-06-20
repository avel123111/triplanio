// Bridge between the Lumo CSS design tokens and Mapbox paint. Mapbox GL paint
// properties (line-color, …) take a concrete colour string, not a CSS var, so we
// read the resolved value of a design token off the document root at draw time
// and feed it in. Reading it live (instead of a hard-coded hex) is what lets the
// route lines follow the day/night theme: on a theme switch we re-read the token
// and re-apply the paint (see repaintRouteLines + useMapSurface).
//
// `--map-route` / `--map-route-ring` are authored per-theme in src/design/app.css
// (the route colour mirrors --brand; the ring is its translucent selection
// casing). Markers don't go through here — they're DOM nodes that inherit the
// tokens directly via CSS.

const FALLBACK_ROUTE = '#2173C8'; // matches light --map-route; only used pre-paint / in SSR
const FALLBACK_RING = 'rgba(33,115,200,.30)';

// Resolved value of a CSS custom property on :root, trimmed. Returns the fallback
// when there's no document (SSR) or the property is unset. Module-internal.
function cssToken(name, fallback = '') {
  if (typeof document === 'undefined') return fallback;
  const v = getComputedStyle(document.documentElement).getPropertyValue(name).trim();
  return v || fallback;
}

// The single route colour (solid + dashed share it; dashed just paints faded).
export function routeColor() {
  return cssToken('--map-route', FALLBACK_ROUTE);
}

// Translucent casing colour drawn under a selected route segment.
export function routeRingColor() {
  return cssToken('--map-route-ring', FALLBACK_RING);
}

// Rose accent for the "planned" (future) country fill + city markers — read live
// from the existing --ev-activity token so it follows day/night with a repaint.
// trip + manual fills reuse the brand routeColor() above (distinguished by opacity).
export function futureFillColor() {
  return cssToken('--ev-activity', '#E8639B');
}
