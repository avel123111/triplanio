/**
 * Mapbox Static Images for the card map sticker (TRIP-193).
 *
 * NOTE: the app's live map uses a Mapbox Standard (v3) style, which the Static
 * Images API does NOT support yet. So the card uses a supported non-Standard
 * style (streets-v12) for now — close in spirit, not pixel-identical. When
 * Mapbox ships Standard support (or we build a dedicated Studio style), only
 * MAP_STYLE below changes. Max image dimension is 1280 px per request.
 *
 * The map is a static IMAGE fetch (I/O) — it does not count against the 2s edge
 * CPU limit. On any failure (no token / non-200 / too few points) we return
 * null and the template draws a neutral placeholder, so the card never fails.
 */

const MAP_STYLE = 'mapbox/streets-v12';
const ROUTE_COLOR = '2267e2'; // brand blue
const PIN_COLOR = 'e2483d'; // red

type Pt = { lat: number; lng: number };

/** Google-algorithm polyline encoder (precision 5), matching Mapbox `enc:`. */
function encodePolyline(points: Pt[]): string {
  let last = [0, 0];
  let out = '';
  const enc = (cur: number, prev: number) => {
    let v = Math.round(cur * 1e5) - Math.round(prev * 1e5);
    v = v < 0 ? ~(v << 1) : v << 1;
    let s = '';
    while (v >= 0x20) {
      s += String.fromCharCode((0x20 | (v & 0x1f)) + 63);
      v >>= 5;
    }
    s += String.fromCharCode(v + 63);
    return s;
  };
  for (const p of points) {
    out += enc(p.lat, last[0]);
    out += enc(p.lng, last[1]);
    last = [p.lat, p.lng];
  }
  return out;
}

/**
 * Build the Static Images URL. `points` are ordered city coords. Returns null
 * if fewer than 1 point or no token.
 */
export function buildStaticMapUrl(
  points: Pt[],
  width: number,
  height: number,
  token: string,
): string | null {
  if (!token || points.length < 1) return null;
  const w = Math.min(width, 1280);
  const h = Math.min(height, 1280);

  const overlays: string[] = [];
  if (points.length >= 2) {
    overlays.push(`path-5+${ROUTE_COLOR}-0.9(${encodeURIComponent(encodePolyline(points))})`);
  }
  for (const p of points) {
    overlays.push(`pin-s+${PIN_COLOR}(${p.lng.toFixed(5)},${p.lat.toFixed(5)})`);
  }
  const overlay = overlays.join(',');
  const viewport = points.length === 1
    ? `${points[0].lng.toFixed(5)},${points[0].lat.toFixed(5)},5`
    : 'auto';

  return `https://api.mapbox.com/styles/v1/${MAP_STYLE}/static/${overlay}/${viewport}/${w}x${h}` +
    `?padding=48&access_token=${token}`;
}

/** Fetch the static map PNG; null on any failure (card falls back gracefully). */
export async function fetchStaticMap(url: string | null): Promise<Uint8Array | null> {
  if (!url) return null;
  try {
    const res = await fetch(url);
    if (!res.ok) {
      console.error('mapbox static non-200', res.status, await res.text().catch(() => ''));
      return null;
    }
    return new Uint8Array(await res.arrayBuffer());
  } catch (e) {
    console.error('mapbox static fetch failed', (e as Error).message);
    return null;
  }
}
