import React, { useEffect, useMemo, useRef } from 'react';
import { mapboxgl, fitToPoints } from '@/lib/mapbox';
import { useMapSurface } from '@/lib/map/useMapSurface';
import { createMarkerEl, groupByLocation } from '@/lib/map/markers';
import {
  ensureCountryFill, setVisitedCountries, setCountryFillVisible, repaintCountryFill,
} from '@/lib/map/countryFill';

// Travel-stats map surface (Trips home + "My statistics"). Renders on the SAME
// app-wide singleton Mapbox map as the trip lenses (one map per session) via
// useMapSurface — it just paints a country-fill layer + simple location pins,
// with NO route lines. MapView is deliberately not reused here: it is built
// around an ordered trip route (sortVisits, transfers, leg highlight), none of
// which applies to an unordered set of lifetime visits.
//
// points: [{ city_name, country_code, lat, lng, kind, start_date, end_date }]
//   from the get_user_travel_stats RPC (already deduped to real destinations).
// visitedCountries: optional explicit ISO-3166-1 alpha-2 list for the fill; when
//   omitted it's derived from the points' country codes.
// Pins are a single colour for now (the default .tmk ring) — per-visit-type
// colouring is deferred. onPointClick(groupData[]) is optional (stats side-panel).
export default function StatsMap({
  points = [],
  visitedCountries = null,
  colorScheme = 'LIGHT',
  active = true,
  onPointClick = null,
  children,
}) {
  const containerRef = useRef(null);
  const markersRef = useRef([]);
  const fittedSigRef = useRef('');

  // Shared singleton lifecycle (acquire/release, ready-seed, theme, resize,
  // marker cleanup on unmount). mercator only — the stats map is a flat world.
  const { mapRef, ready, error } = useMapSurface(containerRef, {
    markersRef, scheme: colorScheme, projection: 'mercator', active,
  });

  // Keep latest click handler without forcing the draw effect to re-run.
  const onPointClickRef = useRef(onPointClick);
  useEffect(() => { onPointClickRef.current = onPointClick; }, [onPointClick]);

  // Force a re-fit on (re)mount so the first draw frames all points.
  useEffect(() => { fittedSigRef.current = ''; }, []);

  const drawable = useMemo(
    () => points.filter((p) => p && p.lat != null && p.lng != null),
    [points],
  );

  // ISO codes to fill (explicit list wins; else unique codes from the points).
  const visitedSig = useMemo(() => {
    const src = visitedCountries
      ? visitedCountries
      : drawable.map((p) => p.country_code);
    const set = new Set();
    for (const c of src) { if (c) set.add(String(c).trim().toUpperCase()); }
    return [...set].sort().join(',');
  }, [visitedCountries, drawable]);

  const pointsSig = useMemo(
    () => drawable.map((p) => `${(+p.lat).toFixed(5)},${(+p.lng).toFixed(5)}`).join('|'),
    [drawable],
  );

  // Country fill: create once, show on this screen, hide again on unmount so the
  // trip lenses (which never touch this layer) stay unfilled. The layer + source
  // persist on the singleton between screens.
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !ready) return undefined;
    ensureCountryFill(map, { visible: true });
    return () => { setCountryFillVisible(map, false); };
  }, [ready]);

  // Repaint visited countries when the set (year filter) changes.
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !ready) return;
    setVisitedCountries(map, visitedSig ? visitedSig.split(',') : []);
  }, [ready, visitedSig]);

  // Follow day/night for the fill colour (markers re-colour themselves via CSS).
  useEffect(() => {
    const map = mapRef.current;
    if (map && ready) repaintCountryFill(map);
  }, [ready, colorScheme]);

  // Draw pins (single colour) + fit the camera to all points.
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !ready) return undefined;

    markersRef.current.forEach((m) => m.remove());
    markersRef.current = [];

    groupByLocation(drawable.map((p) => ({ lng: +p.lng, lat: +p.lat, label: null, data: p }))).forEach((g) => {
      const title = g.data.map((p) => p.city_name).filter(Boolean).join(' • ');
      const el = createMarkerEl(null, {
        title,
        onClick: onPointClickRef.current ? () => { const cb = onPointClickRef.current; if (cb) cb(g.data); } : undefined,
      });
      const marker = new mapboxgl.Marker({ element: el }).setLngLat([g.lng, g.lat]).addTo(map);
      markersRef.current.push(marker);
    });

    if (drawable.length > 0 && fittedSigRef.current !== pointsSig) {
      fitToPoints(map, drawable.map((p) => [+p.lng, +p.lat]), { padding: 56, maxZoom: 6, animate: fittedSigRef.current !== '' });
      fittedSigRef.current = pointsSig;
    }
    return undefined;
  }, [ready, drawable, pointsSig]);

  return (
    <div style={{ width: '100%', height: '100%', position: 'relative' }}>
      <div ref={containerRef} style={{ width: '100%', height: '100%', opacity: ready ? 1 : 0, transition: 'opacity .3s ease' }} />
      {!ready && (
        <div style={{ position: 'absolute', inset: 0, display: 'grid', placeItems: 'center', fontSize: 'var(--fs-base)', color: 'var(--muted)', background: 'var(--surface)', zIndex: 2 }}>
          {error ? `Map error: ${error}` : <div style={{ width: 24, height: 24, border: '2px solid var(--line)', borderTopColor: 'var(--ink)', borderRadius: '50%', animation: 'spin .7s linear infinite' }} />}
        </div>
      )}
      {children}
    </div>
  );
}
