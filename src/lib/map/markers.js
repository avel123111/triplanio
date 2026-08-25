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
// Роль → глиф. Старт и финиш РАЗНЫЕ (запрос Pavel): старт — обычный флаг-вымпел,
// финиш — КЛЕТЧАТЫЙ (гоночный) флаг (стойка + рамка + две залитые клетки 2×2,
// залитая часть несёт свой `fill`, перебивая общий `fill:none` у svgGlyph).
// Пересадка (waypoint) — иконка обмена (та же, что была).
const ICON_PATHS = {
  start: '<path d="M5 3v18"/><path d="M5 4h12l-2 4 2 4H5"/>',
  end: '<path d="M5 2v20"/><path stroke-width="1.1" d="M5 3h13v9H5z M11 3v9 M5 7h13"/><path fill="currentColor" stroke="none" d="M5 3h6v4H5z M11 7h7v5h-7z"/>',
  waypoint: '<path d="M7 7h13l-4-4M17 17H4l4 4"/>',
};

// Роль визита → глиф (старт/финиш/пересадка) или null (город = номер).
const GLYPH_FOR_KIND = { start: 'start', end: 'end', waypoint: 'waypoint' };
// Роль → класс-модификатор `.tmk` (несёт цвет `--tmk` и, у пересадки, меньший
// размер). Город (transit/undefined) роль-класса не несёт — база `.tmk` = brand.
//   старт   → зелёный (`--success`)
//   финиш   → оранжевый (`--warm`)
//   пересадка→ бирюза (`--ev-transfer`, цвет эвента «транспорт»), меньший размер
const ROLE_CLASS = { start: 'tmk--start', end: 'tmk--finish', waypoint: 'tmk--wp' };

// Group points that share a location (a city visited twice) into one pin that
// carries every label + kind + id at that spot.
// points: [{ lng, lat, label, kind?, id?, data? }] → [{ lng, lat, labels:[], kinds:[], ids:[], data:[] }]
// `ids` is the stable id of each point at this spot (falsy when the caller has
// none — e.g. the stats map, which never reads it). It is the ONE source the
// shared marker builder tags onto `data-mids` so the selection/hover toggle can
// address a pin without a rebuild — replacing the old per-screen `data-vids`
// (MapView, from visit.id) / `data-mid` (FlowMap, from the raw id) split.
// `precision` = coordinate rounding for the "same place" test (5 dp ≈ ~1 m).
export function groupByLocation(points, precision = 5) {
  const groups = new Map();
  points.forEach((p) => {
    if (p == null || p.lat == null || p.lng == null) return;
    const key = `${(+p.lat).toFixed(precision)},${(+p.lng).toFixed(precision)}`;
    if (!groups.has(key)) groups.set(key, { lng: +p.lng, lat: +p.lat, labels: [], kinds: [], ids: [], data: [] });
    const g = groups.get(key);
    g.labels.push(p.label);
    g.kinds.push(p.kind);
    g.ids.push(p.id);
    if (p.data !== undefined) g.data.push(p.data);
  });
  return [...groups.values()];
}

const svgGlyph = (icon) =>
  `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.3" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${ICON_PATHS[icon]}</svg>`;

// Одна ячейка слепленного пилюля: глиф своей роли (флаг/пересадка) ИЛИ номер
// города, покрашенные в цвет роли через её класс-модификатор (город — без класса,
// базовый brand). Номер экранируем (city label — данные).
function cellHtml(cell) {
  const glyph = GLYPH_FOR_KIND[cell?.kind];
  const rc = ROLE_CLASS[cell?.kind] || '';
  const inner = glyph ? svgGlyph(glyph) : escapeHtml(String(cell?.label ?? ''));
  return `<span class="${['tmk__h', rc].filter(Boolean).join(' ')}">${inner}</span>`;
}

// Build the DOM element for one mapboxgl.Marker (the Ring style).
// cells: [{ kind, label }] — ПО ОДНОЙ на визит в этой точке, в порядке визитов.
//   1 визит  → одиночное кольцо: старт/финиш/пересадка рисуют свой глиф в своём
//              цвете, город — номер (label) в brand.
//   2+ визита → слепленный пилюль (тот же облик, что и раньше) из ПЕРВЫХ 3 ячеек;
//              каждая ячейка несёт свой глиф/номер в цвете своей роли. Так один
//              спот с любыми ролями (старт/финиш, город/пересадка, старт/город…)
//              читается целиком, а не теряет часть под один глиф.
// opts: { onClick, onHover } — onClick omitted ⇒ non-interactive pin.
// The selected/hover states are toggled by the consumer on the returned element
// (.is-sel / .is-hover) so hovering a list doesn't rebuild the markers.
// Visual transforms (scale/halo) sit on the inner .tmk__core so Mapbox's own
// inline transform on the root .tmk (positioning) is never clobbered.
export function createMarkerEl(cells, { onClick, onHover } = {}) {
  const el = document.createElement('div');
  const list = (Array.isArray(cells) ? cells : [cells]).filter(Boolean);

  const classes = ['tmk'];
  let core; // inner HTML of .tmk__core

  if (list.length <= 1) {
    const c = list[0] || {};
    const glyph = GLYPH_FOR_KIND[c.kind];
    if (glyph) {
      const rc = ROLE_CLASS[c.kind];
      if (rc) classes.push(rc);
      core = svgGlyph(glyph);
    } else {
      core = escapeHtml(String(c.label ?? ''));
    }
  } else {
    // Слепленный пилюль: первые 3 визита, каждый своей ячейкой со скошенным швом.
    classes.push('tmk--wide');
    const shown = list.slice(0, 3);
    if (shown.length >= 3) classes.push('tmk--w3');
    core = shown.map(cellHtml).join('<span class="tmk__sep"></span>');
  }

  if (onClick) classes.push('is-clickable');

  el.className = classes.join(' ');
  el.innerHTML = `<span class="tmk__halo"></span><span class="tmk__pulse"></span><span class="tmk__core">${core}</span>`;

  // Swallow the pin's own click so it never bubbles up to the map canvas 'click'
  // (Mapbox mounts HTML markers inside the canvas container, so a bubbling click
  // would ALSO fire map 'click' — on the Map lens that re-cleared the selection the
  // pin had just set, making pin clicks look dead). A marker click is never a map
  // click.
  if (onClick) el.addEventListener('click', (e) => { e.stopPropagation(); onClick(e); });
  // onHover(entering:boolean) — lets a parent mirror pin hover into a list/badge
  // (Map lens tooltip). The pin's own :hover look stays pure CSS.
  if (onHover) {
    el.addEventListener('mouseenter', () => onHover(true));
    el.addEventListener('mouseleave', () => onHover(false));
  }
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
// a compact disc carrying just the leaf COUNT. REUSES the hotel badge shell
// (.s22mk / .s22mk__core) via the .s22mk--cluster modifier — same surface, border,
// shadow, hover lift and outside-toggled .is-hover, so the two never drift apart.
// Clicking a bubble zooms into it. opts: { onClick, onHover, title }.
export function createClusterBubbleEl(count, { onClick, onHover, title } = {}) {
  const el = document.createElement('div');
  el.className = 's22mk s22mk--cluster is-clickable';
  if (title) el.title = title;
  el.innerHTML = `<span class="s22mk__core"><span class="s22mk__count">${count ?? ''}</span></span>`;

  if (onClick) el.addEventListener('click', onClick);
  if (onHover) {
    el.addEventListener('mouseenter', () => onHover(true));
    el.addEventListener('mouseleave', () => onHover(false));
  }
  return el;
}

// Minimal HTML-escape for values interpolated into a marker's innerHTML (city
// names are user/DB data). Keeps markers.js dependency-free (no React here).
const escapeHtml = (s) =>
  String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

// Chevron-right glyph for the badge CTA (same path lucide `ChevronRight` draws,
// inlined because the badge is plain DOM, not a React icon).
const CHEVRON_SVG = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="m9 18 6-6-6-6"/></svg>';

// City label badge (Map «Маршрут»/редактор + planner). A translucent "glass"
// pill that pairs the country flag with the city name + date range, shown next
// to the ACTIVE city's pin. Plain DOM like every marker here: the flag is an
// <img> from /flags and the glass skin lives in `.cbadge` (src/design/app.css)
// on the canon surface tokens.
//
// The label itself is passive (the popup is pointer-events:none so it never eats
// a map click). ONE exception: when the caller passes `onAction`, the badge grows
// a chevron CTA (`.cbadge__go`) that re-enables pointer events on ITSELF only and
// opens the city. The редактор uses it for the two-step click (fix badge → CTA
// opens + zooms); the planner never passes it, so its badge stays a pure label.
// data: { countryCode, name, dates, actionLabel } — dates preformatted; actionLabel
//   is the CTA's accessible name. opts: { onAction } — click handler for the CTA.
export function createCityBadgeEl({ countryCode, name, dates, actionLabel } = {}, { onAction } = {}) {
  const el = document.createElement('div');
  el.className = 'cbadge';
  const cc = typeof countryCode === 'string' && countryCode.trim().length === 2 ? countryCode.trim().toLowerCase() : '';
  const flag = cc
    ? `<img class="cflag" src="/flags/${cc}.svg" alt="" aria-hidden="true" loading="lazy" onerror="this.style.visibility='hidden'" />`
    : '';
  const nm = name ? `<span class="cbadge__name t-label trunc">${escapeHtml(name)}</span>` : '';
  const dt = dates ? `<span class="cbadge__dates t-meta">${escapeHtml(dates)}</span>` : '';
  // CTA появляется только с `onAction`. Клик глушим: попап живёт в слое канваса
  // карты, и без stopPropagation он бы долетел до 'click' карты — а там сброс
  // выбора, то есть кнопка гасила бы ровно то, что открывает.
  // Переиспользуем канон-примитив `.icon-btn` (rule #6), а не свой класс: тот же
  // облик, что у всех иконочных кнопок ДС (маленькая КВАДРАТНАЯ outline — дефолт
  // `.icon-btn` уже rounded-square `--r-sm`, без `--round`). Единственная добавка
  // в CSS — вернуть кнопке события поверх passiv-попапа (см. app.css).
  const cta = onAction
    ? `<button type="button" class="icon-btn icon-btn--outline icon-btn--sm cbadge__go">${CHEVRON_SVG}</button>`
    : '';
  // Name over dates in a column; the flag sits beside it, top-aligned with the name.
  el.innerHTML = `${flag}<span class="cbadge__col">${nm}${dt}</span>${cta}`;
  if (onAction) {
    const btn = el.querySelector('.cbadge__go');
    if (btn) {
      // aria-label ставим СВОЙСТВОМ, а не в разметке: значение и так локализовано
      // (родитель шлёт `t()`-строку), но литерал `aria-label="…"` спотыкает i18n-гард.
      if (actionLabel) btn.setAttribute('aria-label', actionLabel);
      btn.addEventListener('click', (e) => { e.stopPropagation(); onAction(e); });
      // Кнопка рождается СВЁРНУТОЙ (CSS `.cbadge__go`: max-width 0). Её выезд и
      // сворачивание — CSS-переход ширины, который включает `useCityBadge`, ставя
      // `[data-on]`. Попап при фиксации города НЕ пересоздаётся (шов живёт по
      // городу, а не по наличию CTA) — потому и нет мигания.
    }
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
