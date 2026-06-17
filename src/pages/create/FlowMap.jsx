import React, { useRef, useEffect, useState } from 'react';
import { mapboxgl, fitToPoints } from '@/lib/mapbox';
import { useMapSurface } from '@/lib/map/useMapSurface';
import { drawRouteLinesCached } from '@/lib/map/routeLines';
import { groupByLocation, createMarkerEl, iconForKinds } from '@/lib/map/markers';
import MapControls from '@/lib/map/MapControls';
import { Icon } from '../../design/icons';
import { useT } from '@/lib/i18n/I18nContext';

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
// constant spatial anchor (vs. the old small map card). Same singleton
// instance, markers, route lines and controls as the trip MapView — only the
// data source (home/cities/transport) and the start/finish labels differ.
// =====================================================================
export default function FlowMap({ home, cities = [], returnCity, transport = {}, finalPoint = false, badge }) {
  const t = useT();
  const containerRef = useRef(null);
  const markersRef = useRef([]);

  // On-map controls (same set as MapView): projection / theme / start-finish.
  const [projection, setProjection] = useState('mercator');
  const [scheme, setScheme] = useState(() => (typeof document !== 'undefined' && document.documentElement.dataset.theme === 'dark' ? 'DARK' : 'LIGHT'));
  const [showSE, setShowSE] = useState(true);

  // Shared singleton lifecycle (acquire/release, ready-seed, theme, projection,
  // marker cleanup on unmount).
  const { mapRef, ready } = useMapSurface(containerRef, { markersRef, scheme, projection });

  // Unified with the trip MapView: home → start flag, return → finish flag,
  // transit cities numbered 1..N (icons/flags come from the shared renderer).
  const pts = [];
  if (home?.latitude && showSE) pts.push({ lat: home.latitude, lng: home.longitude, label: null, kind: 'start', name: home.city_name });
  cities.forEach((c, i) => {
    if (c.latitude) pts.push({ lat: c.latitude, lng: c.longitude, label: String(i + 1), kind: 'transit', name: c.city_name });
  });
  if (!finalPoint && returnCity?.latitude && returnCity.city_name !== home?.city_name && showSE) {
    pts.push({ lat: returnCity.latitude, lng: returnCity.longitude, label: null, kind: 'end', name: returnCity.city_name });
  }

  const positions = pts.map((p) => [p.lng, p.lat]);
  const totalNights = cities.reduce((n, c) => n + (+c.nights || 0), 0);
  const legs = buildLegs(home, cities, returnCity, finalPoint);

  const ptsKey = pts.map((p) => `${p.kind || ''}:${p.label}@${p.lat},${p.lng}`).join('|');
  const legsKey = legs.map((l) => `${l.from?.latitude},${l.from?.longitude}|${l.to?.latitude},${l.to?.longitude}|${transport[l.id]?.kind || ''}`).join('::');

  // Markers + fit.
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !ready) return undefined;
    markersRef.current.forEach((m) => m.remove());
    markersRef.current = [];
    const points = pts.map((p) => ({ lng: p.lng, lat: p.lat, label: p.label, kind: p.kind, data: p.name }));
    groupByLocation(points).forEach((g) => {
      const el = createMarkerEl(g.labels.filter((l) => l != null), { icon: iconForKinds(g.kinds), title: g.data.filter(Boolean).join(' • ') });
      const marker = new mapboxgl.Marker({ element: el }).setLngLat([g.lng, g.lat]).addTo(map);
      markersRef.current.push(marker);
    });
    if (positions.length) fitToPoints(map, positions, { padding: 48, maxZoom: 7, singleZoom: 8, animate: true });
    return undefined;
  }, [ready, ptsKey]);

  // Route lines: dashed = no transport, solid = flight/road/other; road via OSRM.
  // Same shared rule + colours as the trip MapView (only the layer ids differ).
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !ready) return undefined;
    const drawLegs = legs.map((leg) => ({ from: leg.from, to: leg.to, kind: transport[leg.id]?.kind }));
    // Cached by legs: reopening with the same route is a no-op (no rebuild, no
    // OSRM refetch, no straight→road flicker).
    drawRouteLinesCached(map, `create:${legsKey}`, drawLegs, { dashedId: 'flow-dashed', solidId: 'flow-solid' });
    return undefined;
  }, [ready, legsKey]);

  return (
    <div className="flow-map" style={{ position: 'absolute', inset: 0, overflow: 'hidden' }}>
      <div ref={containerRef} style={{ width: '100%', height: '100%', opacity: ready ? 1 : 0, transition: 'opacity .3s ease' }} />
      {!ready && (
        <div style={{ position: 'absolute', inset: 0, display: 'grid', placeItems: 'center', background: 'var(--surface)', zIndex: 2 }}>
          <div style={{ width: 24, height: 24, border: '2px solid var(--line)', borderTopColor: 'var(--ink)', borderRadius: '50%', animation: 'spin .7s linear infinite' }} />
        </div>
      )}

      {ready && (
        <MapControls
          projection={projection}
          onToggleProjection={() => setProjection((p) => (p === 'globe' ? 'mercator' : 'globe'))}
          scheme={scheme}
          onToggleScheme={() => setScheme((s) => (s === 'DARK' ? 'LIGHT' : 'DARK'))}
          showSE={showSE}
          onToggleSE={() => setShowSE((v) => !v)}
        />
      )}

      {badge && pts.length > 0 && (
        <div style={{
          position: 'absolute', top: 14, left: 14,
          display: 'inline-flex', alignItems: 'center', gap: 6, padding: '5px 12px',
          background: 'var(--surface)', border: '1px solid var(--line)', borderRadius: 999,
          fontSize: 'var(--fs-micro)', fontWeight: 650, color: badge.color || 'var(--brand)', boxShadow: 'var(--shadow-soft)',
        }}>
          <Icon name={badge.icon || 'map'} size={12} /> {badge.label}
        </div>
      )}

      {totalNights > 0 && (
        <div style={{
          position: 'absolute', bottom: 14, left: 14,
          display: 'inline-flex', alignItems: 'center', gap: 8, padding: '6px 12px',
          background: 'var(--surface)', border: '1px solid var(--line)', borderRadius: 999,
          fontSize: 'var(--fs-micro)', color: 'var(--muted)', boxShadow: 'var(--shadow-soft)',
        }}>
          <span style={{ fontWeight: 600, color: 'var(--ink-2)' }}>{cities.length}</span> {cities.length === 1 ? t('trip.cities_count_one') : cities.length < 5 ? t('trip.cities_count_few') : t('trip.cities_count_many')}
          <span style={{ color: 'var(--muted-2)' }}>·</span>
          <span style={{ fontWeight: 600, color: 'var(--ink-2)' }}>{totalNights}</span> {totalNights === 1 ? t('view.nights_one') : totalNights < 5 ? t('view.nights_few') : t('view.nights_many')}
        </div>
      )}

    </div>
  );
}
