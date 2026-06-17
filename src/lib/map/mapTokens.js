// Bridge between the Lumo CSS design tokens and Mapbox paint. Mapbox GL paint
// properties (line-color, …) take a concrete colour string, not a CSS var, so we
// read the resolved value of a design token off the document root at draw time
// and feed it in. Reading it live (instead of a hard-coded hex) is what lets the
// route lines follow the day/night theme: on a theme switch we re-read the token
// and re-apply the paint (see repaintRouteLines + useMapSurface).
//
// `--map-route` is a concrete hex authored per-theme in src/design/app.css and
// mirrors --brand. Markers don't go through here — they're DOM nodes that inherit
// the tokens directly via CSS.

const FALLBACK_ROUTE = '#2173C8'; // matches light --map-route; only used pre-paint / in SSR

// Resolved value of a CSS custom property on :root, trimmed. Returns the fallback
// when there's no document (SSR) or the property is unset.
export function cssToken(name, fallback = '') {
  if (typeof document === 'undefined') return fallback;
  const v = getComputedStyle(document.documentElement).getPropertyValue(name).trim();
  return v || fallback;
}

// The single route colour (solid + dashed share it; dashed just paints faded).
export function routeColor() {
  return cssToken('--map-route', FALLBACK_ROUTE);
}
