// Routing helpers: fetch a road route via the Mapbox Directions API for ground
// transport, or generate a great-circle (geodesic) polyline for flights.
// Mapbox Directions is called client-side with the same public token used for
// the map tiles (MAPBOX_TOKEN). Results are rendered on the Mapbox map and are
// NOT persisted (Mapbox forbids storing Directions results) — routeLines.js
// keeps only a short-lived in-memory cache for the page session.
import { MAPBOX_TOKEN } from '@/lib/mapbox';

// Our transport types → Mapbox Directions profiles. Mapbox has no rail or ferry
// profile, so trains/ferries approximate by road (as the previous integration
// did). Walking has its own profile.
const ROAD_PROFILES = {
  car: 'driving',
  taxi: 'driving',
  bus: 'driving',
  train: 'driving', // Mapbox has no rail profile; approximate by road
  ferry: 'driving', // Mapbox has no ferry profile; approximate by road
  walk: 'walking',
};

// Fetch a road route from Mapbox Directions. Returns the geometry as
// [[lng, lat], …] (GeoJSON order, ready for Mapbox GL) or null on any error or
// missing token, so callers fall back to a straight line.
export async function fetchRoadRoute(fromLat, fromLon, toLat, toLon, transportType) {
  const profile = ROAD_PROFILES[transportType];
  if (!profile || !MAPBOX_TOKEN) return null;
  const coords = `${fromLon},${fromLat};${toLon},${toLat}`;
  const url = `https://api.mapbox.com/directions/v5/mapbox/${profile}/${coords}`
    + `?geometries=geojson&overview=full&access_token=${MAPBOX_TOKEN}`;
  try {
    const res = await fetch(url);
    if (!res.ok) return null;
    const data = await res.json();
    const line = data?.routes?.[0]?.geometry?.coordinates;
    if (!line || line.length < 2) return null;
    return line; // already [[lng, lat], …]
  } catch {
    return null;
  }
}

// Great-circle polyline (for flights). Returns [[lat, lon], ...] with N+1 points.
export function geodesicLine(fromLat, fromLon, toLat, toLon, steps = 64) {
  const toRad = (d) => (d * Math.PI) / 180;
  const toDeg = (r) => (r * 180) / Math.PI;
  const lat1 = toRad(fromLat), lon1 = toRad(fromLon);
  const lat2 = toRad(toLat), lon2 = toRad(toLon);

  const d = 2 * Math.asin(Math.sqrt(
    Math.sin((lat2 - lat1) / 2) ** 2 +
    Math.cos(lat1) * Math.cos(lat2) * Math.sin((lon2 - lon1) / 2) ** 2
  ));
  if (d === 0) return [[fromLat, fromLon], [toLat, toLon]];

  const points = [];
  for (let i = 0; i <= steps; i++) {
    const f = i / steps;
    const A = Math.sin((1 - f) * d) / Math.sin(d);
    const B = Math.sin(f * d) / Math.sin(d);
    const x = A * Math.cos(lat1) * Math.cos(lon1) + B * Math.cos(lat2) * Math.cos(lon2);
    const y = A * Math.cos(lat1) * Math.sin(lon1) + B * Math.cos(lat2) * Math.sin(lon2);
    const z = A * Math.sin(lat1) + B * Math.sin(lat2);
    const lat = Math.atan2(z, Math.sqrt(x * x + y * y));
    const lon = Math.atan2(y, x);
    points.push([toDeg(lat), toDeg(lon)]);
  }
  return points;
}

export function isFlightTransport(t) {
  return t === 'plane';
}
export function isRoadTransport(t) {
  return Object.prototype.hasOwnProperty.call(ROAD_PROFILES, t);
}
