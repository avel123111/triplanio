// Routing helpers: fetch road route via OSRM public demo server for ground transport,
// or generate a great-circle (geodesic) polyline for flights.

const ROAD_PROFILES = {
  car: 'driving',
  taxi: 'driving',
  bus: 'driving',
  train: 'driving', // OSRM has no rail profile; approximate by road
  ferry: 'driving',
  walk: 'foot',
};

// OSRM returns [lon, lat] — we convert to [lat, lon] for Leaflet.
export async function fetchOsrmRoute(fromLat, fromLon, toLat, toLon, transportType) {
  const profile = ROAD_PROFILES[transportType];
  if (!profile) return null;
  const url = `https://router.project-osrm.org/route/v1/${profile}/${fromLon},${fromLat};${toLon},${toLat}?overview=full&geometries=geojson`;
  try {
    const res = await fetch(url);
    if (!res.ok) return null;
    const data = await res.json();
    const coords = data?.routes?.[0]?.geometry?.coordinates;
    if (!coords) return null;
    return coords.map(([lon, lat]) => [lat, lon]);
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