// Reusable client-side map clustering core (TRIP-141).
//
// Wraps `supercluster` with the bits every map surface needs, kept presentation-
// free so any screen (not just the hotel overlay) can reuse it:
//   • buildClusterIndex — load points into an index
//   • queryViewport     — getClusters for the CURRENT view, padded outward so a
//                         marker doesn't vanish while still visible at the edge
//   • isIrreducible     — a cluster of (near-)coincident points no zoom can split
//   • spiderfyLayout    — fan such a cluster's leaves into a ring so each becomes
//                         individually clickable (the clean fix for stacked pins)
// DOM rendering stays with the caller (e.g. createHotelBadgeEl / createClusterBubbleEl).
import Supercluster from 'supercluster';

// supercluster `radius` is in SCREEN PIXELS (points within this on-screen distance
// merge at a given zoom) — NOT kilometres. Default is 40; 48 is a touch looser.
export const CLUSTER_RADIUS = 48;
// Above this zoom points never cluster — high enough that pins a few metres apart
// separate by zooming, leaving only truly coincident pins for spiderfy.
export const CLUSTER_MAX_ZOOM = 20;
// Fraction of the visible span queried BEYOND each edge so markers stay mounted a
// little past the viewport instead of popping out the moment they touch the border.
export const VIEWPORT_PAD = 0.25;

export function buildClusterIndex(points, { radius = CLUSTER_RADIUS, maxZoom = CLUSTER_MAX_ZOOM, map, reduce } = {}) {
  const index = new Supercluster({ radius, maxZoom, ...(map && { map }), ...(reduce && { reduce }) });
  index.load(points);
  return index;
}

// getClusters for the current viewport, padded outward by `pad` (fraction of span).
export function queryViewport(index, map, { pad = VIEWPORT_PAD } = {}) {
  const b = map.getBounds();
  const w = b.getWest(); const s = b.getSouth(); const e = b.getEast(); const n = b.getNorth();
  const dx = (e - w) * pad; const dy = (n - s) * pad;
  const bbox = [w - dx, s - dy, e + dx, n + dy];
  return index.getClusters(bbox, Math.round(map.getZoom()));
}

// True when a cluster's points sit so close that no zoom (up to maxZoom) splits
// them — supercluster pins the expansion zoom above maxZoom for those.
export function isIrreducible(index, clusterId, maxZoom = CLUSTER_MAX_ZOOM) {
  return index.getClusterExpansionZoom(clusterId) > maxZoom;
}

// Expansion zoom for a cluster, clamped so a flyTo never overshoots the map.
export function expansionZoom(index, clusterId, maxZoom = CLUSTER_MAX_ZOOM) {
  return Math.min(index.getClusterExpansionZoom(clusterId), maxZoom);
}

// The lowest integer zoom at which `hotelId` stops being clustered (becomes its
// own point), or maxZoom if its pins are coincident (caller spiderfies there).
// Lets a list→map selection fly to the stay in ONE smooth zoom instead of stepping
// through each expansion level. Cheap: a handful of getClusters over a tiny bbox
// around the point (pool is capped at a few hundred). No animation/side effects.
export function isolationZoom(index, hotelId, lngLat, { maxZoom = CLUSTER_MAX_ZOOM, minZoom = 0 } = {}) {
  const [lng, lat] = lngLat;
  const eps = 0.02; // ~2 km box — wide enough to catch the enclosing cluster's centroid
  const bbox = [lng - eps, lat - eps, lng + eps, lat + eps];
  const id = String(hotelId);
  for (let z = Math.max(0, Math.floor(minZoom)); z <= maxZoom; z++) {
    const solo = index.getClusters(bbox, z).some((c) => !c.properties.cluster && String(c.properties.hotelId) === id);
    if (solo) return z;
  }
  return maxZoom;
}

// Fan a cluster's leaves into a ring around its centre so coincident pins become
// individually clickable. Positions are computed in screen space (deterministic
// angles, no randomness) and unprojected back to lng/lat, so they recompute stably
// on every move/zoom. radius grows a little for crowded spots.
// Returns [{ leaf, lngLat:[lng,lat] }].
export function spiderfyLayout(map, center, leaves, { radius = 32 } = {}) {
  const c = map.project(center);
  const m = leaves.length;
  const ring = radius + Math.max(0, m - 6) * 4;
  return leaves.map((leaf, i) => {
    const angle = (i / m) * Math.PI * 2 - Math.PI / 2; // start at top, go clockwise
    const ll = map.unproject({ x: c.x + ring * Math.cos(angle), y: c.y + ring * Math.sin(angle) });
    return { leaf, lngLat: [ll.lng, ll.lat] };
  });
}
