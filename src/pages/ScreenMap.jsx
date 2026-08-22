import React, { useState, useMemo, useEffect } from 'react';
import { Icon } from '../design/icons';
import { MapShell, PageHead } from '../design/index';
import MapView from '@/components/views/MapView';
import { useI18n } from '@/lib/i18n/I18nContext';
import { useTheme } from '@/lib/ThemeContext';
import { DateTime } from 'luxon';
import { sortVisits } from '@/lib/validation';
import { uniqueCityCount } from '@/lib/trip-cities';
import { formatDateRange } from '@/lib/trip-dates';

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

// City date range "1 июл – 5 июл". Collapsing (start/finish nodes and 0-night
// layovers land on a single day) is the shared rule, not a local one.
const fmtRange = (a, b) => formatDateRange(a, b, fmtShortDate);

// Pulled-back reader zoom when focusing a single city (smaller than the editor's
// city zoom — the city sits in its region rather than filling the frame).
const FOCUS_ZOOM = 6;

function ScreenMap({ visits = [], transfers = [], active = true }) {
  // One selection drives everything (no city selected at start): a selected city
  // gets the highlighted pin + glass badge and the camera flies to it; nothing
  // selected ⇒ the whole-route frame with no highlight.
  const [selectedIdx, setSelectedIdx] = useState(null);
  const [hoverId, setHoverId] = useState(null); // city hovered (pin OR route row)

  // Real route — visits with coordinates, in trip order.
  const route = useMemo(() => sortVisits(visits).filter(v => v.latitude && v.longitude), [visits]);

  useEffect(() => {
    if (selectedIdx != null && selectedIdx >= route.length) setSelectedIdx(null);
  }, [route.length, selectedIdx]);

  // Тема — из контекста (React-state), НЕ прямым чтением dataset: контекст
  // ре-рендерит потребителя на каждом переключении, поэтому colorScheme карты
  // обновляется. Прямой DOM-read этого не давал — компонент не подписан на смену
  // темы и оставался со старой схемой (TRIP-337 фикс).
  const { isDark } = useTheme();
  const selectedVisit = selectedIdx != null ? route[selectedIdx] || null : null;

  // Unified select/deselect for BOTH the list rows and the map pins: clicking a
  // city selects it; clicking the already-selected city deselects (back to the
  // whole-route frame). Empty-map clicks call `deselect` directly.
  const select = (i) => setSelectedIdx((cur) => (cur === i ? null : i));
  const deselect = () => setSelectedIdx(null);

  // The badge follows the hovered city (tooltip) and otherwise the selected one.
  const hoverVisit = hoverId != null ? route.find(v => v.id === hoverId) : null;
  const badgeVisit = hoverVisit || selectedVisit;
  const cityBadge = badgeVisit ? {
    lng: badgeVisit.longitude,
    lat: badgeVisit.latitude,
    countryCode: badgeVisit.country_code,
    name: badgeVisit.city_name,
    dates: fmtRange(badgeVisit.start_date, badgeVisit.end_date),
  } : null;

  const focus = selectedVisit ? [[selectedVisit.longitude, selectedVisit.latitude]] : null;

  return (
    <RoutePanel
      route={route}
      selectedIdx={selectedIdx}
      onSelect={select}
      onHover={setHoverId}
      // Отступы камеры под панель (десктоп); на телефоне их нет — там слот сам
      // равен свободному окну. Разбор — в `mapSlotInsets`.
      map={(camera) => (
        <MapView
          camera={camera}
          visits={visits}
          transfers={transfers}
          showStartEnd
          mapControls
          initialProjection="globe"
          active={active}
          colorScheme={isDark ? 'DARK' : 'LIGHT'}
          selectedVisitId={selectedVisit?.id}
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
          onMapClick={deselect}
        />
      )}
    />
  );
}

// ----- Route panel --------------------------------------------------------
// Раскладку (карта во всю площадь + панель поверх / шит на телефоне) держит
// примитив <MapShell>; здесь остаётся СОДЕРЖИМОЕ панели. Каждая остановка —
// ведущий маркер (номер транзита / глиф пересадки / флаг старта·финиша), имя
// города и его даты.
function RoutePanel({ route, selectedIdx, onSelect, onHover, map }) {
  const { t } = useI18n();
  // Шит стоит на нижнем детенте; выбор города опускает его обратно, чтобы город
  // было видно на карте. На десктопе панель просто сворачивается кнопкой.
  const [detent, setDetent] = useState(0);
  const [collapsed, setCollapsed] = useState(false);

  const empty = route.length === 0;
  const nCities = empty ? 0 : uniqueCityCount(route); // dedup repeated cities for the count
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
  // Выбор города опускает шит на нижний детент — иначе выбранный город остаётся
  // под ним (десктоп это игнорирует).
  const pick = (i) => { onSelect(i); setDetent(0); };

  const head = (
    <PageHead
      className="map-route__head"
      title={t('trip.sidebar_route')}
      subtitle={`${nCities} ${citiesWord}`}
    />
  );
  const list = (
    <div className="map-route__list scrollbar-thin">
      {rows.map((row, i) => {
        const c = row.visit;
        const dates = fmtRange(c.start_date, c.end_date);
        return (
          <button
            key={c.id}
            type="button"
            onClick={() => pick(i)}
            {...hoverProps(c)}
            className={'map-route__item' + (selectedIdx === i ? ' is-active' : '')}
          >
            <span className="map-route__marker">
              {row.glyph ? <Icon name={row.glyph} size={13} /> : <span className="num t-meta">{row.number}</span>}
            </span>
            <span className="map-route__body">
              <span className="map-route__name t-label trunc">{c.city_name}</span>
              {dates && <span className="map-route__dates num t-meta">{dates}</span>}
            </span>
          </button>
        );
      })}
    </div>
  );
  const emptyState = (
    <div className="map-route__empty">
      <Icon name="pin" size={26} style={{ opacity: 0.4, marginBottom: 8 }} />
      <div className="t-body muted">{t('view.map_no_cities')}</div>
    </div>
  );

  return (
    <MapShell
      map={map}
      // Полосу нижнего нава шит берёт из `--nav-dock-h` — её публикует сам нав,
      // измеряя себя. Экран про чужую высоту ничего не знает и не передаёт.
      panelHeader={empty ? null : head}
      panel={empty ? emptyState : list}
      panelLabel={t('trip.sidebar_route')}
      detent={detent}
      onDetentChange={setDetent}
      collapsed={collapsed}
      onCollapsedChange={setCollapsed}
      collapseLabel={t('common.panel_collapse')}
      expandLabel={t('common.panel_expand')}
    />
  );
}

export default ScreenMap;
