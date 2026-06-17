// Shared route-line drawing for every Mapbox surface (trip MapView + create
// FlowMap). The two screens build their legs from different data (visits+
// transfers vs home/cities/transport) and render different markers, but the
// line geometry rule is identical: no transport → dashed straight; flight →
// solid geodesic arc; road → solid straight, upgraded to real OSRM geometry
// async; anything else → solid straight. This module owns that rule so it
// lives in exactly one place.
import { lineFeature, setLineLayer } from '@/lib/mapbox';
import { fetchOsrmRoute, geodesicLine, isFlightTransport, isRoadTransport } from '@/lib/routing';
import { DASHED_OPACITY, SOLID_WIDTH, DASHED_WIDTH } from './mapStyle';
import { routeColor, routeRingColor } from './mapTokens';

// Per-leg OSRM geometry cache, keyed by endpoints + transport. A road route for
// a fixed coordinate pair and mode is deterministic, so it's safe to keep for
// the page session. This is what stops "change one transfer → every leg
// recomputes": when the route is rebuilt, unchanged road legs are served from
// here instantly (final geometry, no fetch, no straight→road flicker) and only
// the leg that actually changed (a new key) hits the network.
const osrmCache = new Map();    // key → coords [[lng,lat], …]
const osrmInflight = new Map(); // key → Promise<coords|null>  (dedupes concurrent fetches)

const legKey = (from, to, kind) =>
  `${from.latitude.toFixed(5)},${from.longitude.toFixed(5)}->${to.latitude.toFixed(5)},${to.longitude.toFixed(5)}:${kind}`;

async function osrmGeometry(from, to, kind) {
  const key = legKey(from, to, kind);
  if (osrmCache.has(key)) return osrmCache.get(key);
  let p = osrmInflight.get(key);
  if (!p) {
    p = fetchOsrmRoute(from.latitude, from.longitude, to.latitude, to.longitude, kind)
      .then((route) => (route && route.length > 1 ? route.map(([la, lo]) => [lo, la]) : null))
      .catch(() => null);
    osrmInflight.set(key, p);
  }
  const coords = await p;
  osrmInflight.delete(key);
  if (coords) osrmCache.set(key, coords);
  return coords;
}

// legs: [{ from:{latitude,longitude}, to:{latitude,longitude}, kind?:string }]
//   kind = transport type (falsy ⇒ "no transport" ⇒ dashed).
// opts: { dashedId, solidId, dashedColor, solidColor,
//         dashedWidth=2, solidWidth=3.5, dashedOpacity=0.5 }
// Paints both layers immediately. Road legs already in the OSRM cache are drawn
// with their final geometry up front; only uncached road legs start straight and
// are upgraded async. Returns cancel() — call it on redraw to stop pending
// upgrades from writing into a parked/replaced map.
function drawRouteLines(map, legs, opts) {
  const {
    dashedId, solidId,
    dashedColor = routeColor(), solidColor = routeColor(),
    dashedWidth = DASHED_WIDTH, solidWidth = SOLID_WIDTH, dashedOpacity = DASHED_OPACITY,
  } = opts;

  const dashed = [];
  const solid = []; // indexed; uncached road legs upgraded in place after OSRM
  const roadTasks = [];

  legs.forEach((leg) => {
    const { from, to, kind } = leg;
    if (!from?.latitude || !to?.latitude) return;
    const straight = [[from.longitude, from.latitude], [to.longitude, to.latitude]];
    if (!kind) { dashed.push(lineFeature(straight)); return; }
    if (isFlightTransport(kind)) {
      const arc = geodesicLine(from.latitude, from.longitude, to.latitude, to.longitude).map(([la, lo]) => [lo, la]);
      solid.push(lineFeature(arc));
    } else if (isRoadTransport(kind)) {
      const cached = osrmCache.get(legKey(from, to, kind));
      if (cached) {
        solid.push(lineFeature(cached)); // final geometry now — no fetch, no flicker
      } else {
        const idx = solid.length;
        solid.push(lineFeature(straight)); // straight now, upgraded async below
        roadTasks.push({ idx, from, to, kind });
      }
    } else {
      solid.push(lineFeature(straight));
    }
  });

  setLineLayer(map, dashedId, dashed, { color: dashedColor, width: dashedWidth, dashed: true, opacity: dashedOpacity });
  setLineLayer(map, solidId, solid, { color: solidColor, width: solidWidth });

  let cancelled = false;
  (async () => {
    for (const task of roadTasks) {
      const coords = await osrmGeometry(task.from, task.to, task.kind);
      // Bail if the effect was cleaned up or this screen's layer is already gone
      // (e.g. the map was parked and the source removed on unmount).
      if (cancelled || !map.getSource(solidId)) return;
      if (coords) {
        solid[task.idx] = lineFeature(coords);
        setLineLayer(map, solidId, solid, { color: solidColor, width: solidWidth });
      }
    }
  })();

  return () => { cancelled = true; };
}

// Every line layer id any surface can draw. Used to wipe a previous route
// (this screen's or another surface's) before drawing a different one.
const ALL_LINE_LAYER_IDS = ['mv-dashed', 'mv-solid', 'flow-dashed', 'flow-solid'];

// Re-apply the (theme-dependent) route colour to whatever line layers exist on
// the shared instance. Called on a day/night switch so the lines follow the
// theme without rebuilding their geometry (geometry is theme-independent, so a
// cheap setPaintProperty is enough — no OSRM refetch, no flicker).
// Highlight (selected route segment) layer ids: a translucent wide casing under a
// re-coloured main line, drawn on top of the base route.
const HL_CASING_ID = 'mv-hl-casing';
const HL_MAIN_ID = 'mv-hl-main';

export function repaintRouteLines(map) {
  if (!map) return;
  const color = routeColor();
  const ring = routeRingColor();
  ALL_LINE_LAYER_IDS.forEach((id) => {
    try { if (map.getLayer(id)) map.setPaintProperty(id, 'line-color', color); } catch { /* layer not present */ }
  });
  try { if (map.getLayer(HL_MAIN_ID)) map.setPaintProperty(HL_MAIN_ID, 'line-color', color); } catch { /* not present */ }
  try { if (map.getLayer(HL_CASING_ID)) map.setPaintProperty(HL_CASING_ID, 'line-color', ring); } catch { /* not present */ }
}

// Remove the selected-segment highlight (no-op if it isn't drawn).
export function clearRouteHighlight(map) {
  if (!map) return;
  [HL_MAIN_ID, HL_CASING_ID].forEach((id) => {
    try { if (map.getLayer(id)) map.removeLayer(id); } catch { /* ignore */ }
    try { if (map.getSource(id)) map.removeSource(id); } catch { /* ignore */ }
  });
}

// Draw the "selected route" state for a single leg, over the base route. Works
// for legs with transport (solid) and without (dashed) — a wide translucent
// casing + the route colour on top. Geometry follows the same rule as the base
// line (flight arc / cached OSRM road / straight) so the highlight traces the
// exact rendered path. Re-added each call so it stays above a re-drawn base.
// leg: { from:{latitude,longitude}, to:{latitude,longitude}, kind?:string }
export function drawRouteHighlight(map, leg) {
  if (!map || !leg?.from?.latitude || !leg?.to?.latitude) { clearRouteHighlight(map); return; }
  const { from, to, kind } = leg;
  let coords;
  if (isFlightTransport(kind)) {
    coords = geodesicLine(from.latitude, from.longitude, to.latitude, to.longitude).map(([la, lo]) => [lo, la]);
  } else if (isRoadTransport(kind)) {
    coords = osrmCache.get(legKey(from, to, kind)) || [[from.longitude, from.latitude], [to.longitude, to.latitude]];
  } else {
    coords = [[from.longitude, from.latitude], [to.longitude, to.latitude]];
  }
  const features = [lineFeature(coords)];
  clearRouteHighlight(map); // re-add on top of the (possibly just redrawn) base
  const base = kind ? SOLID_WIDTH : DASHED_WIDTH;
  setLineLayer(map, HL_CASING_ID, features, { color: routeRingColor(), width: base + 8, opacity: 1 });
  setLineLayer(map, HL_MAIN_ID, features, { color: routeColor(), width: base + 1.5, dashed: !kind, opacity: 1 });
}

// Cached variant. Keeps the drawn route ON THE MAP INSTANCE between screen
// opens. If `sig` matches what's already rendered (and the layers still exist),
// it does NOTHING — so reopening the map doesn't rebuild the route or re-hit
// OSRM. That removes both the straight→road "snap" flicker and the repeated
// network calls the user was seeing on every open. When the route actually
// changes (or a different surface takes over), it cancels any pending OSRM,
// wipes every known line layer and redraws. The cancel handle lives on the
// instance, so it survives the React unmount that triggered the previous draw
// (letting an in-flight OSRM upgrade finish into the persistent layer).
export function drawRouteLinesCached(map, sig, legs, opts) {
  const st = map.__routeLines || (map.__routeLines = { sig: null, cancel: null });
  if (st.sig === sig && map.getSource(opts.solidId)) return; // unchanged → leave it
  if (st.cancel) { try { st.cancel(); } catch { /* ignore */ } st.cancel = null; }
  ALL_LINE_LAYER_IDS.forEach((id) => {
    try { if (map.getLayer(id)) map.removeLayer(id); } catch { /* ignore */ }
    try { if (map.getSource(id)) map.removeSource(id); } catch { /* ignore */ }
  });
  st.cancel = drawRouteLines(map, legs, opts);
  st.sig = sig;
}
