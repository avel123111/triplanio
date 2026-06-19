// Country-fill layer for the user travel map (Trips home + "My statistics").
//
// Lives on the SAME app-wide singleton Mapbox map as the trip route lines, so
// the map still renders exactly once per session — this module only ADDS a fill
// layer + a vector source to the existing instance (mirroring how routeLines.js
// adds line layers), then toggles its visibility per screen. The instance is
// never re-created.
//
// Product decisions baked in here:
//  • Visited countries get a translucent fill; UNVISITED countries are left
//    unfilled (fill-opacity 0) — no land token, by design.
//  • Single colour for now (per-visit-type trip/manual/future colouring is
//    deliberately deferred). The colour is read live from the existing
//    `--map-route` design token via mapTokens.routeColor() — the same source the
//    route lines use, so the fill follows day/night with a cheap repaint and we
//    introduce ZERO new tokens.
//
// Mapbox detail: the fill targets the official `mapbox.country-boundaries-v1`
// vector tileset. `promoteId` lifts each country's ISO-3166-1 alpha-2 code to the
// feature id so we can paint visited countries with setFeatureState({ visited })
// keyed by ISO code — no need to enumerate features or know their numeric ids.
import { routeColor } from './mapTokens';

const SRC_ID = 'tp-countries';
const FILL_ID = 'tp-country-fill';
const SOURCE_LAYER = 'country_boundaries';
const VECTOR_URL = 'mapbox://mapbox.country-boundaries-v1';

// Exposed so the stats map can wire a click on the fill layer (country → panel).
export const COUNTRY_FILL_LAYER = FILL_ID;

const VISITED_OPACITY = 0.45;

// Create the source + fill layer once on the shared instance. Idempotent: on a
// reused map (later screen) it just re-asserts visibility. Caller must ensure the
// style is loaded (consumers gate on useMapSurface `ready`).
// slot:'middle' places the fill above the basemap land but below labels/roads on
// the Mapbox Standard style, so country names and the route line stay readable.
export function ensureCountryFill(map, { visible = true } = {}) {
  if (!map) return;
  // Guarded: a Mapbox style/slot quirk must degrade to "no fill", never crash the
  // screen that mounts the map (this can't be browser-verified until deployed).
  try {
    if (!map.getSource(SRC_ID)) {
      map.addSource(SRC_ID, {
        type: 'vector',
        url: VECTOR_URL,
        promoteId: { [SOURCE_LAYER]: 'iso_3166_1' },
      });
    }
    if (!map.getLayer(FILL_ID)) {
      map.addLayer({
        id: FILL_ID,
        type: 'fill',
        source: SRC_ID,
        'source-layer': SOURCE_LAYER,
        slot: 'middle',
        layout: { visibility: visible ? 'visible' : 'none' },
        paint: {
          'fill-color': routeColor(),
          // Visited → translucent; everything else → fully transparent (no fill).
          'fill-opacity': ['case', ['boolean', ['feature-state', 'visited'], false], VISITED_OPACITY, 0],
          // Mapbox Standard lights layers by the scene; without full emissive
          // strength the fill renders dark under the `night` preset (same fix the
          // route lines use).
          'fill-emissive-strength': 1,
        },
      });
    } else {
      setCountryFillVisible(map, visible);
    }
  } catch { /* fill unavailable — map still renders pins + basemap */ }
}

// Paint the given ISO-3166-1 alpha-2 codes as visited (case-insensitive). Clears
// any previous visited state first, so the same call re-colours the map when the
// year filter changes — entirely client-side, no tile refetch.
export function setVisitedCountries(map, isoCodes = []) {
  if (!map || !map.getSource(SRC_ID)) return;
  try { map.removeFeatureState({ source: SRC_ID, sourceLayer: SOURCE_LAYER }); } catch { /* nothing set yet */ }
  for (const code of isoCodes) {
    if (!code) continue;
    try {
      map.setFeatureState(
        { source: SRC_ID, sourceLayer: SOURCE_LAYER, id: String(code).trim().toUpperCase() },
        { visited: true },
      );
    } catch { /* id not in tiles — ignore */ }
  }
}

// Show/hide the fill layer. Trip screens keep it hidden (they never call
// ensureCountryFill, but if a stats screen created it earlier in the session the
// layer persists on the instance, so a consumer hides it on unmount).
export function setCountryFillVisible(map, visible) {
  if (!map || !map.getLayer(FILL_ID)) return;
  try { map.setLayoutProperty(FILL_ID, 'visibility', visible ? 'visible' : 'none'); } catch { /* ignore */ }
}

// Re-read the (theme-dependent) fill colour and re-apply it — called on a
// day/night switch so the fill follows the theme without rebuilding the source.
export function repaintCountryFill(map) {
  if (!map || !map.getLayer(FILL_ID)) return;
  try { map.setPaintProperty(FILL_ID, 'fill-color', routeColor()); } catch { /* ignore */ }
}
