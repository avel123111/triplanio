import React, { useState, useMemo, useEffect, useLayoutEffect, useRef } from 'react';
import { Icon } from '../design/icons';
import MapView from '@/components/views/MapView';
import { useI18n } from '@/lib/i18n/I18nContext';
import { DateTime } from 'luxon';
import { sortVisits } from '@/lib/validation';
import { uniqueCityCount } from '@/lib/trip-cities';

// =====================================================================
// TRIP MAP LENS (TRIP-33) — full-bleed map + a floating glass route panel.
// The old right rail (active-city card, transfer/hotel CTAs, activities) is
// gone: those actions live on the Timeline / Edit screens. This lens is a
// geographic browser — pick a city in the route (or click its pin) to fly the
// camera there; the active city gets a translucent badge on the map.
// =====================================================================

// Short localized date "16 июл" / "16 Jul" — Luxon uses the app-wide active
// locale (set on language change), so no hardcoded tag.
function fmtShortDate(iso) {
  if (!iso) return '';
  try {
    const dt = DateTime.fromISO(iso);
    return dt.isValid ? dt.toFormat('d LLL') : '';
  } catch { return ''; }
}

// City date range "1 июл – 5 июл" (single date if only one end is known).
function fmtRange(a, b) {
  const s = fmtShortDate(a);
  const e = fmtShortDate(b);
  if (s && e) return `${s} – ${e}`;
  return s || e || '';
}

// Pulled-back reader zoom when focusing a single city (smaller than the editor's
// city zoom — the city sits in its region rather than filling the frame).
const FOCUS_ZOOM = 6;

function ScreenMap({ visits = [], transfers = [], active = true }) {
  const [activeIdx, setActiveIdx] = useState(0);
  // The camera stays on the whole-route frame until the user picks a city; then
  // it flies to that city (MapView's `focus`). Re-picking the active city clears
  // the focus and eases back to the whole trip.
  const [picked, setPicked] = useState(false);
  const [hoverId, setHoverId] = useState(null); // city hovered (pin OR route row)

  // Real route — visits with coordinates, in trip order.
  const route = useMemo(() => sortVisits(visits).filter(v => v.latitude && v.longitude), [visits]);

  useEffect(() => {
    if (activeIdx >= route.length) { setActiveIdx(0); setPicked(false); }
  }, [route.length, activeIdx]);

  const isDark = document.documentElement.dataset.theme === 'dark';
  const activeVisit = route[activeIdx] || null;

  // Re-picking the active city toggles focus off (back to the whole-trip frame);
  // picking another city flies to it.
  const select = (i) => {
    if (i === activeIdx) { setPicked((p) => !p); return; }
    setActiveIdx(i);
    setPicked(true);
  };

  // The badge follows the hovered city (tooltip) and otherwise the active one.
  const hoverVisit = hoverId != null ? route.find(v => v.id === hoverId) : null;
  const badgeVisit = hoverVisit || activeVisit;
  const cityBadge = badgeVisit ? {
    lng: badgeVisit.longitude,
    lat: badgeVisit.latitude,
    countryCode: badgeVisit.country_code,
    name: badgeVisit.city_name,
    dates: fmtRange(badgeVisit.start_date, badgeVisit.end_date),
  } : null;

  const focus = picked && activeVisit ? [[activeVisit.longitude, activeVisit.latitude]] : null;

  return (
    // The parent <main> is padding:0 + overflow:hidden for the map lens, so this
    // fills the lens viewport; the map is absolute full-bleed, the panel floats.
    <div className="trip-map-shell" style={{ position: 'relative', height: '100%', background: 'var(--surface)' }}>
      <div className="trip-map-canvas" style={{
        position: 'absolute', inset: 0, overflow: 'hidden',
        background: isDark ? '#0e1a2e' : '#dceaf5', // design-token-exempt: map backdrop tint behind the canvas
      }}>
        <MapView
          visits={visits}
          transfers={transfers}
          showStartEnd
          mapControls
          active={active}
          colorScheme={isDark ? 'DARK' : 'LIGHT'}
          selectedVisitId={activeVisit?.id}
          hoveredVisitId={hoverId}
          focus={focus}
          focusZoom={FOCUS_ZOOM}
          cityBadge={cityBadge}
          cooperativeGestures={false}
          onCityClick={(visitsAtPoint) => {
            const idx = route.findIndex(v => v.id === visitsAtPoint[0]?.id);
            if (idx !== -1) select(idx);
          }}
          onCityHover={(visitsAtPoint) => setHoverId(visitsAtPoint ? (visitsAtPoint[0]?.id ?? null) : null)}
          onMapClick={() => { setActiveIdx(null); setPicked(false); }}
        />
      </div>

      <RoutePanel
        route={route}
        activeIdx={activeIdx}
        onSelect={select}
        onHover={setHoverId}
      />
    </div>
  );
}

// ----- Route panel --------------------------------------------------------
// Desktop: a floating glass panel top-left over the map. Phones (≤640px): the
// same element becomes an always-on bottom sheet above the bottom nav — peek by
// default (grip + title), tap the grip to expand the scrollable route, and it
// collapses again when a city is picked. Each stop = a leading marker (transit
// number / interchange glyph / start·finish flag), the city name and its dates.
function RoutePanel({ route, activeIdx, onSelect, onHover }) {
  const { t } = useI18n();
  // Mobile bottom-sheet expand/collapse (no effect on desktop, where the panel
  // always shows its list).
  const [expanded, setExpanded] = useState(false);
  const sheetRef = useRef(null);
  const listRef = useRef(null);
  const drag = useRef(null);
  // Snap heights, measured from the element so the drag maths need no hard-coded
  // safe-area: collapsed = the CSS peek (grip + title, incl. safe-area), expanded
  // = the full content height capped at 62vh.
  const range = useRef({ collapsed: 128, expanded: 320 });

  // JS only owns the height on phones — the desktop panel keeps its CSS sizing.
  const isPhone = () => window.matchMedia('(max-width: 640px)').matches;

  const measure = () => {
    const el = sheetRef.current; if (!el) return range.current;
    // The list is an internal scroller (overflow:auto), so el.scrollHeight is
    // clipped to the peek — read the LIST's full scrollHeight instead and add the
    // grip+title above it to get the sheet's natural height.
    const list = listRef.current;
    const above = list ? Math.max(0, list.getBoundingClientRect().top - el.getBoundingClientRect().top) : 0;
    const full = list ? above + list.scrollHeight : el.scrollHeight;
    const exH = Math.min(full, Math.round(window.innerHeight * 0.62));
    range.current.expanded = Math.max(exH, range.current.collapsed + 80);
    return range.current;
  };
  const applyHeight = (exp, animate) => {
    const el = sheetRef.current; if (!el) return;
    if (!isPhone()) { el.style.maxHeight = ''; el.style.transition = ''; return; }
    const { collapsed, expanded: exH } = measure();
    el.style.transition = animate ? 'max-height .3s cubic-bezier(.22,1,.36,1)' : 'none';
    el.style.maxHeight = (exp ? exH : collapsed) + 'px';
  };

  // Capture the CSS collapsed peek (incl. safe-area) once; from then on JS owns
  // the sheet height so the drag follows the finger 1:1 (the old grip only
  // toggled on release → the sheet jumped between the two heights).
  useLayoutEffect(() => {
    const el = sheetRef.current;
    if (el && isPhone()) range.current.collapsed = Math.round(el.getBoundingClientRect().height);
  }, []);
  useEffect(() => { applyHeight(expanded, true); }, [expanded]);

  // Grip drag — the sheet grows/shrinks with the finger (pointer events cover
  // touch + mouse); on release it settles to the nearer state with a soft spring,
  // matching the feel of the app's other bottom sheets (useSheetSwipe).
  const onGripDown = (e) => {
    const el = sheetRef.current; if (!el) return;
    measure();
    el.style.transition = 'none';
    drag.current = { startY: e.clientY, baseH: el.getBoundingClientRect().height, moved: false };
    e.currentTarget.setPointerCapture?.(e.pointerId);
  };
  const onGripMove = (e) => {
    const d = drag.current; if (!d) return;
    const dy = e.clientY - d.startY;
    if (Math.abs(dy) > 3) d.moved = true;
    const el = sheetRef.current;
    if (el) el.style.maxHeight = Math.min(range.current.expanded, Math.max(range.current.collapsed, d.baseH - dy)) + 'px';
  };
  const onGripUp = (e) => {
    const d = drag.current; if (!d) return; drag.current = null;
    const dy = e.clientY - d.startY;
    const next = !d.moved ? !expanded : dy < 0; // tap toggles; drag up → expand, down → collapse
    applyHeight(next, true);
    setExpanded(next);
  };
  const grip = (
    <button type="button" className="sheet-grip" onPointerDown={onGripDown} onPointerMove={onGripMove} onPointerUp={onGripUp} onPointerCancel={onGripUp} aria-label={t('trip.sidebar_route')}><i /></button>
  );

  if (route.length === 0) {
    return (
      <aside className="map-route surface-glass" ref={sheetRef}>
        {grip}
        <div className="map-route__empty">
          <Icon name="pin" size={26} style={{ opacity: 0.4, marginBottom: 8 }} />
          <div className="t-body muted">{t('view.map_no_cities')}</div>
        </div>
      </aside>
    );
  }

  const nCities = uniqueCityCount(route); // dedup repeated cities for the count
  const citiesWord = nCities === 1 ? t('trip.cities_count_one') : nCities < 5 ? t('trip.cities_count_few') : t('trip.cities_count_many');

  // Number ONLY transit stops (1,2,3…), mirroring the map pins; start/finish and
  // waypoints get a glyph instead.
  let transitNo = 0;
  const rows = route.map((c) => {
    const isStart = c.kind === 'start';
    const isEnd = c.kind === 'end';
    const isWaypoint = c.kind === 'waypoint';
    const isTransit = !isStart && !isEnd && !isWaypoint;
    return {
      visit: c,
      number: isTransit ? String(++transitNo) : null,
      glyph: isStart ? 'flag' : isEnd ? 'check' : isWaypoint ? 'arrowSwap' : null,
    };
  });

  const hoverProps = (c) => ({ onMouseEnter: () => onHover(c.id), onMouseLeave: () => onHover(null) });
  // Picking a city collapses the mobile sheet (desktop ignores `expanded`).
  const pick = (i) => { onSelect(i); setExpanded(false); };

  return (
    <aside className="map-route surface-glass" ref={sheetRef}>
      {grip}
      <div className="map-route__head">
        <span className="t-mono tp-caption">{t('trip.sidebar_route')} · {nCities} {citiesWord}</span>
      </div>
      <div className="map-route__list scrollbar-thin" ref={listRef}>
        {rows.map((row, i) => {
          const c = row.visit;
          const dates = fmtRange(c.start_date, c.end_date);
          return (
            <button
              key={c.id}
              type="button"
              onClick={() => pick(i)}
              {...hoverProps(c)}
              className={'map-route__item' + (activeIdx === i ? ' is-active' : '')}
            >
              <span className="map-route__marker">
                {row.glyph ? <Icon name={row.glyph} size={13} /> : <span className="num t-meta">{row.number}</span>}
              </span>
              <span className="map-route__body">
                <span className="map-route__name t-ui">{c.city_name}</span>
                {dates && <span className="map-route__dates num t-meta">{dates}</span>}
              </span>
            </button>
          );
        })}
      </div>
    </aside>
  );
}

export default ScreenMap;
