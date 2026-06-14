// Offline IANA timezone lookup from coordinates via tz-lookup.
//
// tz-lookup is public-domain (Dark Sky waived all rights), bundled, synchronous,
// and built on OpenStreetMap / timezone-boundary-builder data — zero API calls,
// zero cost, commercial use + storage OK. It replaces the previous network
// resolvers: Open-Meteo (geo.js getTimezone) and Google Time Zone
// (timezone-resolver.js), both of which were removed as part of the geo-stack
// migration (TRIP-85).
//
// Note: it maps coordinates → IANA zone name only ("Europe/Madrid"); DST/offset
// rules come from the runtime Intl/Date as before. City-level accuracy is ample.
import tzlookup from 'tz-lookup';

// Returns an IANA timezone string for the given coordinates, or 'UTC' when the
// coordinates are missing or out of range. Synchronous — no await needed.
export function tzFromCoords(lat, lon) {
  const la = Number(lat);
  const lo = Number(lon);
  if (!Number.isFinite(la) || !Number.isFinite(lo)) return 'UTC';
  try {
    return tzlookup(la, lo) || 'UTC';
  } catch {
    return 'UTC';
  }
}
