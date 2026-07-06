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
import { routeColor, futureFillColor } from './mapTokens';

const SRC_ID = 'tp-countries';
const FILL_ID = 'tp-country-fill';
const SOURCE_LAYER = 'country_boundaries';
const VECTOR_URL = 'mapbox://mapbox.country-boundaries-v1';

// Exposed so the stats map can wire a click on the fill layer (country → panel).
export const COUNTRY_FILL_LAYER = FILL_ID;

// Per-visit-type fill. The priority (trip > manual > future) is resolved upstream
// in StatsMap via dominantTone, then stamped onto each country as feature-state
// `kind`. trip + manual share the brand colour and differ only by opacity; future
// is the rose accent. Values are easy to tune here.
const OPACITY = { trip: 0.42, manual: 0.16, future: 0.18 };
// Extra opacity when a country is hovered OR selected (its panel is open).
const HOVER_BOOST = 0.14;

// fill-color depends on feature-state `kind`: future → rose, else brand. Rebuilt on
// a theme switch (repaintCountryFill) so both colours follow day/night.
function fillColorExpr() {
  return ['case', ['==', ['feature-state', 'kind'], 'future'], futureFillColor(), routeColor()];
}
// Base fill-opacity per kind; unset (unvisited) → 0 (no fill).
const BASE_OPACITY_EXPR = [
  'case',
  ['==', ['feature-state', 'kind'], 'trip'], OPACITY.trip,
  ['==', ['feature-state', 'kind'], 'manual'], OPACITY.manual,
  ['==', ['feature-state', 'kind'], 'future'], OPACITY.future,
  0,
];
// Final opacity = base + a hover/selected boost, but ONLY where there is a fill
// (base > 0) so hovering an unvisited country never paints it.
const FILL_OPACITY_EXPR = [
  'let', 'base', BASE_OPACITY_EXPR,
  ['case',
    ['==', ['var', 'base'], 0], 0,
    ['any',
      ['boolean', ['feature-state', 'hover'], false],
      ['boolean', ['feature-state', 'selected'], false]],
    ['min', 1, ['+', ['var', 'base'], HOVER_BOOST]],
    ['var', 'base']],
];

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
        // country-boundaries-v1 ships SEVERAL overlapping polygons per country —
        // one per political `worldview` (US/CN/IN/RU/…) plus disputed areas. With a
        // translucent fill those overlaps paint on top of each other and the alpha
        // compounds, so multi-worldview countries (Russia, Serbia/Kosovo, Ukraine,
        // China…) render darker than the rest. Pin to ONE worldview so every
        // country is filled exactly once and the opacity reads uniformly.
        filter: ['any', ['==', 'all', ['get', 'worldview']], ['in', 'US', ['get', 'worldview']]],
        layout: { visibility: visible ? 'visible' : 'none' },
        paint: {
          'fill-color': fillColorExpr(),
          // Per-type opacity; unvisited (no `kind`) → 0 (no fill).
          'fill-opacity': FILL_OPACITY_EXPR,
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
export function setCountryKinds(map, kindByCode = {}) {
  if (!map || !map.getSource(SRC_ID)) return;
  try { map.removeFeatureState({ source: SRC_ID, sourceLayer: SOURCE_LAYER }); } catch { /* nothing set yet */ }
  // removeFeatureState wiped hover/selected too — drop the trackers so the next
  // setCountryHover/Selected re-applies cleanly (the consumer re-asserts selected).
  map.__cfHover = null; map.__cfSelected = null;
  for (const [code, kind] of Object.entries(kindByCode)) {
    if (!code || !kind) continue;
    try {
      map.setFeatureState(
        { source: SRC_ID, sourceLayer: SOURCE_LAYER, id: String(code).trim().toUpperCase() },
        { kind },
      );
    } catch { /* id not in tiles — ignore */ }
  }
}

// Hover / selected highlight via feature-state (boosts fill-opacity — see
// FILL_OPACITY_EXPR). Each tracks the single highlighted country id on the instance
// so the previous one is cleared without wiping the per-country `kind`.
export function setCountryHover(map, code) {
  if (!map || !map.getSource(SRC_ID)) return;
  const id = code ? String(code).trim().toUpperCase() : null;
  if (map.__cfHover === id) return;
  try { if (map.__cfHover) map.setFeatureState({ source: SRC_ID, sourceLayer: SOURCE_LAYER, id: map.__cfHover }, { hover: false }); } catch { /* ignore */ }
  try { if (id) map.setFeatureState({ source: SRC_ID, sourceLayer: SOURCE_LAYER, id }, { hover: true }); } catch { /* ignore */ }
  map.__cfHover = id;
}
export function setCountrySelected(map, code) {
  if (!map || !map.getSource(SRC_ID)) return;
  const id = code ? String(code).trim().toUpperCase() : null;
  if (map.__cfSelected === id) return;
  try { if (map.__cfSelected) map.setFeatureState({ source: SRC_ID, sourceLayer: SOURCE_LAYER, id: map.__cfSelected }, { selected: false }); } catch { /* ignore */ }
  try { if (id) map.setFeatureState({ source: SRC_ID, sourceLayer: SOURCE_LAYER, id }, { selected: true }); } catch { /* ignore */ }
  map.__cfSelected = id;
}

// Show/hide the fill layer. Trip screens keep it hidden (they never call
// ensureCountryFill, but if a stats screen created it earlier in the session the
// layer persists on the instance, so a consumer hides it on unmount).
export function setCountryFillVisible(map, visible) {
  // This runs from the stats-screen UNMOUNT cleanup, which can fire after the
  // shared singleton map was torn down (map.style gone) — a bare map.getLayer()
  // then throws "Cannot read properties of undefined (reading 'getOwnLayer')".
  // Guard the layer read itself, not just `!map` (TRIP-195).
  if (!map || !map.style) return;
  try { if (!map.getLayer(FILL_ID)) return; } catch { return; }
  try { map.setLayoutProperty(FILL_ID, 'visibility', visible ? 'visible' : 'none'); } catch { /* ignore */ }
}

// Re-read the (theme-dependent) fill colour and re-apply it — called on a
// day/night switch so the fill follows the theme without rebuilding the source.
export function repaintCountryFill(map) {
  if (!map || !map.getLayer(FILL_ID)) return;
  try { map.setPaintProperty(FILL_ID, 'fill-color', fillColorExpr()); } catch { /* ignore */ }
}
