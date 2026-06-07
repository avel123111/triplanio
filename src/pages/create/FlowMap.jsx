import React, { useRef, useEffect, useState } from 'react';
import { mapboxgl, applyBasemapConfig, fitToPoints, htmlMarkerEl } from '@/lib/mapbox';
import { useSharedMap } from '@/lib/map/MapProvider';
import { drawRouteLinesCached } from '@/lib/map/routeLines';
import { groupMarkers, markerSvg, MISSING_COLOR } from '@/lib/mapRoute';
import { Icon } from '../../design/icons';
import { useT } from '@/lib/i18n/I18nContext';

const ROUTE_COLOR = '#2167e2'; // brand (mapbox paint needs a concrete hex; theme-adaptive route = P1)

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
  const sharedMap = useSharedMap();
  const containerRef = useRef(null);
  const mapRef = useRef(null);
  const markersRef = useRef([]);
  const readyRef = useRef(false);
  // Seed from the shared map's state so revisiting doesn't flash the spinner.
  const [ready, setReady] = useState(() => {
    const m = sharedMap?.getMap?.();
    return !!(m && m.isStyleLoaded && m.isStyleLoaded());
  });
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

  // Claim the app-wide singleton map into this screen's slot (see MapProvider).
  // The instance is NOT created/destroyed here — acquired on mount, parked on
  // unmount — so the map survives create → trip and isn't re-initialised.
  useEffect(() => {
    const slot = containerRef.current;
    if (!slot || !sharedMap || !sharedMap.hasToken) return undefined;
    const map = sharedMap.acquire(slot, scheme);
    if (!map) return undefined;
    mapRef.current = map;
    const markReady = () => { readyRef.current = true; setReady(true); };
    if (map.isStyleLoaded()) markReady(); else map.once('style.load', markReady);
    // Re-assert this screen's view state on a reused instance (the projection/
    // theme effects below only fire on later changes, not on a fresh mount).
    try { map.setProjection(projection); } catch { /* ignore */ }
    applyBasemapConfig(map, scheme);
    return () => {
      // Remove only this screen's markers; the route LINE layers stay on the
      // shared instance (drawRouteLinesCached replaces them only on change).
      markersRef.current.forEach((m) => m.remove());
      markersRef.current = [];
      sharedMap.release(slot);
      mapRef.current = null;
      readyRef.current = false;
      setReady(false);
    };
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
  // Same geometry rule as the trip MapView — shared in drawRouteLines (only the
  // leg source, layer ids and colours differ here).
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return undefined;
    let disposed = false;
    const draw = () => {
      if (disposed) return;
      const drawLegs = legs.map((leg) => ({ from: leg.from, to: leg.to, kind: transport[leg.id]?.kind }));
      // Cached by accent+legs: reopening with the same route is a no-op (no
      // rebuild, no OSRM refetch, no straight→road flicker).
      drawRouteLinesCached(map, `create:${accent}:${legsKey}`, drawLegs, {
        dashedId: 'flow-dashed', solidId: 'flow-solid',
        dashedColor: MISSING_COLOR, solidColor: accent, dashedOpacity: 0.5,
      });
    };
    if (readyRef.current) draw(); else map.once('load', draw);
    return () => { disposed = true; };
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
            style={{ width: 36, height: 36, borderRadius: 9, border: '1px solid var(--line)', background: 'var(--surface)', color: 'var(--ink)', display: 'grid', placeItems: 'center', cursor: 'pointer', boxShadow: 'var(--shadow-soft)' }}>
            <Icon name={b.icon} size={17} />
          </button>
        ))}
      </div>}

      {badge && pts.length > 0 && (
        <div style={{
          position: 'absolute', top: 14, left: 14,
          display: 'inline-flex', alignItems: 'center', gap: 6, padding: '5px 12px',
          background: 'var(--surface)', border: '1px solid var(--line)', borderRadius: 999,
          fontSize: 'var(--fs-micro)', fontWeight: 650, color: badge.color || accent, boxShadow: 'var(--shadow-soft)',
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
