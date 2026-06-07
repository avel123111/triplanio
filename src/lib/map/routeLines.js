// Shared route-line drawing for every Mapbox surface (trip MapView + create
// FlowMap). The two screens build their legs from different data (visits+
// transfers vs home/cities/transport) and render different markers, but the
// line geometry rule is identical: no transport → dashed straight; flight →
// solid geodesic arc; road → solid straight, upgraded to real OSRM geometry
// async; anything else → solid straight. This module owns that rule so it
// lives in exactly one place.
import { lineFeature, setLineLayer } from '@/lib/mapbox';
import { fetchOsrmRoute, geodesicLine, isFlightTransport, isRoadTransport } from '@/lib/routing';

// legs: [{ from:{latitude,longitude}, to:{latitude,longitude}, kind?:string }]
//   kind = transport type (falsy ⇒ "no transport" ⇒ dashed).
// opts: { dashedId, solidId, dashedColor, solidColor,
//         dashedWidth=2, solidWidth=3.5, dashedOpacity=0.5 }
// Paints both layers immediately (straight/arc), then asynchronously replaces
// road legs with OSRM geometry. Returns cancel() — call it on unmount/redraw to
// stop pending OSRM upgrades from writing into a parked/replaced map.
export function drawRouteLines(map, legs, opts) {
  const {
    dashedId, solidId, dashedColor, solidColor,
    dashedWidth = 2, solidWidth = 3.5, dashedOpacity = 0.5,
  } = opts;

  const dashed = [];
  const solid = []; // indexed; road legs upgraded in place after OSRM
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
      const idx = solid.length;
      solid.push(lineFeature(straight)); // straight now, upgraded async below
      roadTasks.push({ idx, from, to, kind });
    } else {
      solid.push(lineFeature(straight));
    }
  });

  setLineLayer(map, dashedId, dashed, { color: dashedColor, width: dashedWidth, dashed: true, opacity: dashedOpacity });
  setLineLayer(map, solidId, solid, { color: solidColor, width: solidWidth });

  let cancelled = false;
  (async () => {
    for (const task of roadTasks) {
      const route = await fetchOsrmRoute(task.from.latitude, task.from.longitude, task.to.latitude, task.to.longitude, task.kind);
      // Bail if the effect was cleaned up or this screen's layer is already gone
      // (e.g. the map was parked and the source removed on unmount).
      if (cancelled || !map.getSource(solidId)) return;
      const coords = route && route.length > 1 ? route.map(([la, lo]) => [lo, la]) : null;
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
