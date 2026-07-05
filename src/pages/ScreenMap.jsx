import React, { useState, useMemo, useEffect } from 'react';
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
          onCityClick={(visitsAtPoint) => {
            const idx = route.findIndex(v => v.id === visitsAtPoint[0]?.id);
            if (idx !== -1) select(idx);
          }}
          onCityHover={(visitsAtPoint) => setHoverId(visitsAtPoint ? (visitsAtPoint[0]?.id ?? null) : null)}
        />
      </div>

      <RoutePanel
        route={route}
        transfers={transfers}
        activeIdx={activeIdx}
        onSelect={select}
        onHover={setHoverId}
      />
    </div>
  );
}

// ----- Floating glass route panel -----------------------------------------
// Vertical list: each stop = a leading marker (transit number / interchange
// glyph / start·finish flag), the city name and its dates. No timeline dot.
function RoutePanel({ route, transfers, activeIdx, onSelect, onHover }) {
  const { t } = useI18n();
  if (route.length === 0) {
    return (
      <aside className="map-route surface-glass">
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

  return (
    <aside className="map-route surface-glass">
      <div className="map-route__head">
        <span className="t-mono tp-caption">{t('trip.sidebar_route')} · {nCities} {citiesWord}</span>
      </div>
      <div className="map-route__list scrollbar-thin">
        {rows.map((row, i) => {
          const c = row.visit;
          const dates = fmtRange(c.start_date, c.end_date);
          return (
            <button
              key={c.id}
              type="button"
              onClick={() => onSelect(i)}
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
