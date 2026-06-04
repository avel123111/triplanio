import React, { useRef, useEffect, useState } from 'react';
import { mapboxgl, MAPBOX_TOKEN, MAP_STYLE, baseConfig, applyBasemapConfig, fitToPoints, htmlMarkerEl, lineFeature, setLineLayer } from '@/lib/mapbox';
import { groupMarkers, markerSvg, MISSING_COLOR } from '@/lib/mapRoute';
import { fetchOsrmRoute, geodesicLine, isFlightTransport, isRoadTransport } from '@/lib/routing';
import { Icon } from '../../design/icons';
import { useT } from '@/lib/i18n/I18nContext';

const ROUTE_COLOR = '#5b6cff';

// Build ordered legs (home → cities → return) - self-contained so the map has
// no dependency on the planner's save logic. Mirrors computeLegs ordering.
function buildLegs(home, cities, returnCity, finalPoint) {
  const stops = [];
  if (home?.latitude) stops.push(home);
  cities.forEach((c) => { if (c.latitude) stops.push(c); });
  const lastCity = cities[cities.length - 1];
  if (!finalPoint && returnCity?.latitude && returnCity.city_name !== lastCity?.city_name) {
    stops.push(returnCity);
  }
  const legs = [];
  for (let i = 0; i < stops.length - 1; i++) legs.push({ id: `leg_${i}`, from: stops[i], to: stops[i + 1] });
  return legs;
}

// =====================================================================
// FLOW MAP - full-bleed Mapbox route preview that fills its container.
// Shared across every step of the unified create flow so the map is the
// constant spatial anchor (vs. the old small map card).
// =====================================================================
export default function FlowMap({ home, cities = [], returnCity, transport = {}, finalPoint = false, accent = ROUTE_COLOR, badge }) {
  const t = useT();
  const containerRef = useRef(null);
  const mapRef = useRef(null);
  const markersRef = useRef([]);
  const readyRef = useRef(false);
  const [ready, setReady] = useState(false);
  // On-map controls (same set as MapView): projection / theme / start-finish.
  const [projection, setProjection] = useState('mercator');
  const [scheme, setScheme] = useState(() => (typeof document !== 'undefined' && document.documentElement.dataset.theme === 'dark' ? 'DARK' : 'LIGHT'));
  const [showSE, setShowSE] = useState(true);
  useEffect(() => { if (mapRef.current && readyRef.current) { try { mapRef.current.setProjection(projection); } catch { /* ignore */ } } }, [projection]);
  useEffect(() => { if (mapRef.current && readyRef.current) applyBasemapConfig(mapRef.current, scheme); }, [scheme]);

  const pts = [];
  if (home?.latitude && showSE) pts.push({ lat: home.latitude, lng: home.longitude, label: '🏠', name: home.city_name });
  cities.forEach((c, i) => {
    if (c.latitude) pts.push({ lat: c.latitude, lng: c.longitude, label: String(i + 1), name: c.city_name });
  });
  if (!finalPoint && returnCity?.latitude && returnCity.city_name !== home?.city_name && showSE) {
    pts.push({ lat: returnCity.latitude, lng: returnCity.longitude, label: '↩', name: returnCity.city_name });
  }

  const positions = pts.map((p) => [p.lng, p.lat]);
  const groups = groupMarkers(pts);
  const totalNights = cities.reduce((n, c) => n + (+c.nights || 0), 0);
  const legs = buildLegs(home, cities, returnCity, finalPoint);

  const ptsKey = pts.map((p) => `${p.lat},${p.lng}`).join('|');
  const legsKey = legs.map((l) => `${l.from?.latitude},${l.from?.longitude}|${l.to?.latitude},${l.to?.longitude}|${transport[l.id]?.kind || ''}`).join('::');

  // Init map once.
  useEffect(() => {
    if (!containerRef.current || mapRef.current || !MAPBOX_TOKEN) return undefined;
    const dark = typeof document !== 'undefined' && document.documentElement.dataset.theme === 'dark';
    const map = new mapboxgl.Map({
      container: containerRef.current,
      style: MAP_STYLE,
      config: baseConfig(dark ? 'DARK' : 'LIGHT'),
      center: positions[0] || [15, 50],
      zoom: 4,
      projection: 'mercator',
      attributionControl: false,
      cooperativeGestures: true,
    });
    mapRef.current = map;
    map.on('load', () => { readyRef.current = true; setReady(true); });
    return () => { map.remove(); mapRef.current = null; readyRef.current = false; };
  }, []);

  // Numbered markers + fit.
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return undefined;
    const draw = () => {
      markersRef.current.forEach((m) => m.remove());
      markersRef.current = [];
      groups.forEach((g) => {
        const marker = new mapboxgl.Marker({ element: htmlMarkerEl(markerSvg(g.labels, false)) }).setLngLat([g.lng, g.lat]).addTo(map);
        markersRef.current.push(marker);
      });
      if (positions.length) fitToPoints(map, positions, { padding: 48, maxZoom: 7, singleZoom: 8, animate: true });
    };
    if (readyRef.current) draw(); else map.once('load', draw);
    return undefined;
  }, [ptsKey]);

  // Route lines: dashed = no transport, solid = flight/road/other; road via OSRM.
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return undefined;
    let cancelled = false;
    const draw = () => {
      const dashed = [];
      const solid = [];
      const roadTasks = [];
      legs.forEach((leg) => {
        if (!leg.from?.latitude || !leg.to?.latitude) return;
        const straight = [[leg.from.longitude, leg.from.latitude], [leg.to.longitude, leg.to.latitude]];
        const kind = transport[leg.id]?.kind;
        if (!kind) { dashed.push(lineFeature(straight)); return; }
        if (isFlightTransport(kind)) {
          const arc = geodesicLine(leg.from.latitude, leg.from.longitude, leg.to.latitude, leg.to.longitude).map(([la, lo]) => [lo, la]);
          solid.push(lineFeature(arc));
        } else if (isRoadTransport(kind)) {
          const idx = solid.length;
          solid.push(lineFeature(straight));
          roadTasks.push({ idx, leg, kind });
        } else {
          solid.push(lineFeature(straight));
        }
      });
      setLineLayer(map, 'flow-dashed', dashed, { color: MISSING_COLOR, width: 2, dashed: true, opacity: 0.5 });
      setLineLayer(map, 'flow-solid', solid, { color: accent, width: 3.5 });
      (async () => {
        for (const task of roadTasks) {
          const route = await fetchOsrmRoute(task.leg.from.latitude, task.leg.from.longitude, task.leg.to.latitude, task.leg.to.longitude, task.kind);
          if (cancelled || !mapRef.current) return;
          const coords = route && route.length > 1 ? route.map(([la, lo]) => [lo, la]) : null;
          if (coords) { solid[task.idx] = lineFeature(coords); setLineLayer(map, 'flow-solid', solid, { color: accent, width: 3.5 }); }
        }
      })();
    };
    if (readyRef.current) draw(); else map.once('load', draw);
    return () => { cancelled = true; };
  }, [legsKey]);

  return (
    <div className="flow-map" style={{ position: 'absolute', inset: 0, overflow: 'hidden' }}>
      <div ref={containerRef} style={{ width: '100%', height: '100%', opacity: ready ? 1 : 0, transition: 'opacity .3s ease' }} />
      {!ready && (
        <div style={{ position: 'absolute', inset: 0, display: 'grid', placeItems: 'center', background: 'var(--surface)', zIndex: 2 }}>
          <div style={{ width: 24, height: 24, border: '2px solid var(--line)', borderTopColor: 'var(--ink)', borderRadius: '50%', animation: 'spin .7s linear infinite' }} />
        </div>
      )}

      {ready && <div style={{ position: 'absolute', top: 12, right: 12, zIndex: 6, display: 'flex', flexDirection: 'column', gap: 8 }}>
        {[
          { key: 'proj', title: projection === 'globe' ? t('tse.map_flat') : t('tse.map_globe'), icon: projection === 'globe' ? 'map' : 'globe', onClick: () => setProjection((p) => (p === 'globe' ? 'mercator' : 'globe')) },
          { key: 'theme', title: scheme === 'DARK' ? t('tse.map_light') : t('tse.map_dark'), icon: scheme === 'DARK' ? 'sun' : 'moon', onClick: () => setScheme((s) => (s === 'DARK' ? 'LIGHT' : 'DARK')) },
          { key: 'se', title: t('tse.map_startend'), icon: showSE ? 'flag' : 'eyeOff', onClick: () => setShowSE((v) => !v) },
        ].map((b) => (
          <button key={b.key} type="button" onClick={b.onClick} title={b.title} aria-label={b.title}
            style={{ width: 36, height: 36, borderRadius: 9, border: 'none', background: 'var(--brand)', color: '#fff', display: 'grid', placeItems: 'center', cursor: 'pointer', boxShadow: 'var(--shadow-soft)' }}>
            <Icon name={b.icon} size={17} />
          </button>
        ))}
      </div>}

      {badge && pts.length > 0 && (
        <div style={{
          position: 'absolute', top: 14, left: 14,
          display: 'inline-flex', alignItems: 'center', gap: 6, padding: '5px 12px',
          background: 'var(--surface)', border: '1px solid var(--line)', borderRadius: 999,
          fontSize: 11.5, fontWeight: 650, color: badge.color || accent, boxShadow: 'var(--shadow-soft)',
        }}>
          <Icon name={badge.icon || 'map'} size={12} /> {badge.label}
        </div>
      )}

      {totalNights > 0 && (
        <div style={{
          position: 'absolute', bottom: 14, left: 14,
          display: 'inline-flex', alignItems: 'center', gap: 8, padding: '6px 12px',
          background: 'var(--surface)', border: '1px solid var(--line)', borderRadius: 999,
          fontSize: 11.5, color: 'var(--muted)', boxShadow: 'var(--shadow-soft)',
        }}>
          <span style={{ fontWeight: 600, color: 'var(--ink-2)' }}>{cities.length}</span> {cities.length === 1 ? t('trip.cities_count_one') : cities.length < 5 ? t('trip.cities_count_few') : t('trip.cities_count_many')}
          <span style={{ color: 'var(--muted-2)' }}>·</span>
          <span style={{ fontWeight: 600, color: 'var(--ink-2)' }}>{totalNights}</span> {totalNights === 1 ? t('view.nights_one') : totalNights < 5 ? t('view.nights_few') : t('view.nights_many')}
        </div>
      )}

    </div>
  );
}
