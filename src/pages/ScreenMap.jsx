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

function ScreenMap({ visits = [], transfers = [], active = true }) {
  const [activeIdx, setActiveIdx] = useState(0);
  // The camera stays on the whole-route frame until the user picks a city; then
  // it flies to that city (MapView's `focus`). Selecting always shows the badge.
  const [picked, setPicked] = useState(false);
  const [hoverIdx, setHoverIdx] = useState(null); // route row hovered → highlight its map pin

  // Real route — visits with coordinates, in trip order.
  const route = useMemo(() => sortVisits(visits).filter(v => v.latitude && v.longitude), [visits]);

  useEffect(() => {
    if (activeIdx >= route.length) { setActiveIdx(0); setPicked(false); }
  }, [route.length, activeIdx]);

  const isDark = document.documentElement.dataset.theme === 'dark';
  const activeVisit = route[activeIdx] || null;

  const select = (i) => { setActiveIdx(i); setPicked(true); };

  // Glass badge for the active city (flag + name + dates), drawn next to its pin.
  const cityBadge = activeVisit ? {
    lng: activeVisit.longitude,
    lat: activeVisit.latitude,
    countryCode: activeVisit.country_code,
    name: activeVisit.city_name,
    dates: fmtRange(activeVisit.start_date, activeVisit.end_date),
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
          hoveredVisitId={hoverIdx != null ? route[hoverIdx]?.id : null}
          focus={focus}
          cityBadge={cityBadge}
          onCityClick={(visitsAtPoint) => {
            const idx = route.findIndex(v => v.id === visitsAtPoint[0]?.id);
            if (idx !== -1) select(idx);
          }}
        />
      </div>

      <RoutePanel
        route={route}
        transfers={transfers}
        activeIdx={activeIdx}
        onSelect={select}
        onHover={setHoverIdx}
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

  const hoverProps = (i) => ({ onMouseEnter: () => onHover(i), onMouseLeave: () => onHover(null) });

  return (
    <aside className="map-route surface-glass">
      <div className="map-route__head">
        <span className="eyebrow">{t('trip.sidebar_route')} · {nCities} {citiesWord}</span>
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
              {...hoverProps(i)}
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
