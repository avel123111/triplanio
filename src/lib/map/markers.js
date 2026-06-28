// Unified map-marker rendering for every Mapbox surface (trip MapView + create
// FlowMap). Both screens feed simple {lng,lat,label,kind} descriptors and get an
// identical-looking pin; the things that legitimately differ per screen — the
// click behaviour, the label text and the selected state — are passed in as
// data/options, not branched inside the renderer. Change the pin's look here once
// (markup) + in src/design/app.css (.tmk*) and it updates on Overview, Map lens,
// Edit mode, public trip and the planner together.
//
// Style = "Ring" (Lumo): a light-surface disc with a coloured ring + coloured
// glyph/number. Colours come from CSS design tokens (the marker is a real DOM
// node under <html data-theme>, so --brand/--surface/--warm cascade into it and
// it adapts to day/night with no redraw — no hard-coded hex here anymore).
//
// Marker roles (city_visits.kind):
//   transit  → numbered ring (1,2,3…). ONLY transit nodes get a number.
//   start    → start flag (brand ring).
//   end      → finish flag (warm ring).
//   waypoint → transit/interchange icon, smaller ring (a 0-night layover).

// Glyphs reused from the design system (src/design/icons.jsx), inlined as raw
// SVG paths because markers are plain DOM nodes, not React components. `flag`
// marks both endpoints (ring colour tells start from finish); `arrowSwap` marks
// a waypoint (transit / layover). Stroke is `currentColor` so the glyph follows
// the ring colour (and turns white when the pin is selected).
const ICON_PATHS = {
  start: '<path d="M5 3v18"/><path d="M5 4h12l-2 4 2 4H5"/>',
  end: '<path d="M5 3v18"/><path d="M5 4h12l-2 4 2 4H5"/>',
  waypoint: '<path d="M7 7h13l-4-4M17 17H4l4 4"/>',
};

// Pick the glyph for a (possibly grouped) pin. Anchors outrank waypoints, which
// outrank plain transit numbers, so a shared location renders its most
// significant role. Returns null when the pin should show its number(s) instead.
export function iconForKinds(kinds = []) {
  if (kinds.includes('start')) return 'start';
  if (kinds.includes('end')) return 'end';
  if (kinds.length > 0 && kinds.every((k) => k === 'waypoint')) return 'waypoint';
  return null;
}

// Group points that share a location (a city visited twice) into one pin that
// carries every label + kind at that spot.
// points: [{ lng, lat, label, kind?, data? }] → [{ lng, lat, labels:[], kinds:[], data:[] }]
// `precision` = coordinate rounding for the "same place" test (5 dp ≈ ~1 m).
export function groupByLocation(points, precision = 5) {
  const groups = new Map();
  points.forEach((p) => {
    if (p == null || p.lat == null || p.lng == null) return;
    const key = `${(+p.lat).toFixed(precision)},${(+p.lng).toFixed(precision)}`;
    if (!groups.has(key)) groups.set(key, { lng: +p.lng, lat: +p.lat, labels: [], kinds: [], data: [] });
    const g = groups.get(key);
    g.labels.push(p.label);
    g.kinds.push(p.kind);
    if (p.data !== undefined) g.data.push(p.data);
  });
  return [...groups.values()];
}

const svgGlyph = (icon) =>
  `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.3" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${ICON_PATHS[icon]}</svg>`;

// Build the DOM element for one mapboxgl.Marker (the Ring style).
// labels: array shown on the pin (1 → ring with number; 2+ → split pill of
//   first|last). Ignored when `icon` is set.
// opts: { onClick, title, icon }
//   icon ('start'|'end'|'waypoint') renders a glyph instead of a number;
//   onClick omitted ⇒ non-interactive pin.
// The selected/hover states are toggled by the consumer on the returned element
// (.is-sel / .is-hover) so hovering a list doesn't rebuild the markers.
// Visual transforms (scale/halo) sit on the inner .tmk__core so Mapbox's own
// inline transform on the root .tmk (positioning) is never clobbered.
export function createMarkerEl(labels, { onClick, title, icon } = {}) {
  const el = document.createElement('div');

  const classes = ['tmk'];
  let core; // inner HTML of .tmk__core

  if (icon && ICON_PATHS[icon]) {
    if (icon === 'end') classes.push('tmk--finish');
    if (icon === 'waypoint') classes.push('tmk--wp');
    core = svgGlyph(icon);
  } else {
    const list = Array.isArray(labels) ? labels : [labels];
    if (list.length <= 1) {
      core = String(list[0] ?? '');
    } else {
      classes.push('tmk--wide');
      if (list.length >= 3) classes.push('tmk--w3');
      const first = list[0];
      const last = list[list.length - 1];
      core = `<span class="tmk__h">${first}</span><span class="tmk__sep"></span><span class="tmk__h">${last}</span>`;
    }
  }

  if (onClick) classes.push('is-clickable');

  el.className = classes.join(' ');
  el.innerHTML = `<span class="tmk__halo"></span><span class="tmk__pulse"></span><span class="tmk__core">${core}</span>`;

  if (title) el.title = title;
  if (onClick) el.addEventListener('click', onClick);
  return el;
}

// Hotel badge marker for the editor's hotel-pick overlay (TRIP-140). A pill that
// pairs the primary supplier's square logo with its price; price-less stays render
// the logo alone. Built like createMarkerEl: the consumer toggles .is-sel /
// .is-hover on the returned element (no rebuild on hover) and the visual scale +
// elevation live on the inner .s22mk__core so Mapbox's own inline transform on the
// root .s22mk (positioning) is never clobbered. Stacking order (a badge raised
// above its neighbours on hover/select) is set imperatively by the consumer via
// el.style.zIndex, mirroring the way MapView toggles classes.
// hotel: { supplierLogo, priceLabel }  — priceLabel is preformatted (locale money)
//   or falsy → logo-only badge.
// opts: { onClick, onHover, title } — onHover(entering:boolean) fires on the pill.
export function createHotelBadgeEl({ supplierLogo, priceLabel } = {}, { onClick, onHover, title } = {}) {
  const el = document.createElement('div');
  el.className = 's22mk is-clickable';
  if (title) el.title = title;

  const logo = supplierLogo
    ? `<img class="s22mk__logo" src="${supplierLogo}" alt="" loading="lazy" />`
    : '';
  const price = priceLabel
    ? `<span class="s22mk__price">${priceLabel}</span>`
    : '';
  // logo-only badges get a modifier so the pill stays round rather than stretched.
  if (!priceLabel) el.classList.add('s22mk--logo');
  el.innerHTML = `<span class="s22mk__core">${logo}${price}</span>`;

  if (onClick) el.addEventListener('click', onClick);
  if (onHover) {
    el.addEventListener('mouseenter', () => onHover(true));
    el.addEventListener('mouseleave', () => onHover(false));
  }
  return el;
}

// Cluster bubble marker for the hotel-pick overlay (TRIP-141). When a city has
// 150–300 stays the map shows supercluster bubbles instead of hundreds of badges:
// a rounded pill carrying the leaf COUNT and (optionally) the cheapest "от $X" in
// that cluster. Built like createHotelBadgeEl — the consumer toggles .is-hover on
// the root (no rebuild) while the scale lives on the inner .s22cl__core (Mapbox
// owns the root's inline transform). Clicking a bubble zooms into it.
// cluster: { count, priceLabel } — priceLabel is preformatted ("от $80") or falsy.
// opts: { onClick, onHover, title } — onHover(entering:boolean) fires on the pill.
export function createClusterBubbleEl({ count, priceLabel } = {}, { onClick, onHover, title } = {}) {
  const el = document.createElement('div');
  el.className = 's22cl is-clickable';
  if (title) el.title = title;
  if (!priceLabel) el.classList.add('s22cl--bare');
  const price = priceLabel ? `<span class="s22cl__price">${priceLabel}</span>` : '';
  el.innerHTML = `<span class="s22cl__core"><span class="s22cl__count">${count ?? ''}</span>${price}</span>`;

  if (onClick) el.addEventListener('click', onClick);
  if (onHover) {
    el.addEventListener('mouseenter', () => onHover(true));
    el.addEventListener('mouseleave', () => onHover(false));
  }
  return el;
}

// Mini marker for the stats / home travel map — a small coloured dot (~11px),
// deliberately NOT the trip Ring pin: these screens show an unordered set of
// lifetime visits over a country fill, so the pins must be tiny and unobtrusive.
// tone ('trip'|'manual'|'future') drives the colour via .smk--* (the marker is a
// DOM node, so it inherits the design tokens directly): trip = solid brand,
// manual = hollow brand ring, future = solid rose.
export function createMiniMarkerEl(tone = 'trip', { onClick, title } = {}) {
  const el = document.createElement('div');
  el.className = `smk smk--${tone}`;
  if (onClick) el.classList.add('is-clickable');
  if (title) el.title = title;
  // The visual dot is an INNER element: Mapbox owns the root's inline transform
  // (positioning), so hover/selected scale .smk__dot — scaling the root would be
  // clobbered by Mapbox's translate and silently do nothing.
  el.innerHTML = '<span class="smk__dot"></span>';
  if (onClick) el.addEventListener('click', onClick);
  return el;
}
