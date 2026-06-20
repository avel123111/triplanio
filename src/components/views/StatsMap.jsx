import React, { useEffect, useMemo, useRef } from 'react';
import { mapboxgl, fitToPoints } from '@/lib/mapbox';
import { useMapSurface } from '@/lib/map/useMapSurface';
import { createMarkerEl, groupByLocation } from '@/lib/map/markers';
import { dominantTone } from '@/lib/travel-stats';
import {
  ensureCountryFill, setVisitedCountries, setCountryFillVisible, repaintCountryFill,
  COUNTRY_FILL_LAYER,
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
// The fill's ISO-3166-1 alpha-2 set is derived from the points' country codes.
// onPointClick(groupData[]) is optional (stats side-panel).
export default function StatsMap({
  points = [],
  colorScheme = 'LIGHT',
  projection = 'mercator',
  pins = true,
  onPointClick = null,
  onCountryClick = null,
  sizeSignal = null,
  children,
}) {
  const containerRef = useRef(null);
  const markersRef = useRef([]);
  const fittedSigRef = useRef('');

  // Shared singleton lifecycle (acquire/release, ready-seed, theme, resize,
  // marker cleanup on unmount). projection follows the map/globe toggle.
  const { mapRef, ready, error } = useMapSurface(containerRef, {
    markersRef, scheme: colorScheme, projection,
  });

  // Keep latest click handlers without forcing the draw effect to re-run.
  const onPointClickRef = useRef(onPointClick);
  useEffect(() => { onPointClickRef.current = onPointClick; }, [onPointClick]);
  const onCountryClickRef = useRef(onCountryClick);
  useEffect(() => { onCountryClickRef.current = onCountryClick; }, [onCountryClick]);

  // Force a re-fit on (re)mount so the first draw frames all points.
  useEffect(() => { fittedSigRef.current = ''; }, []);

  const drawable = useMemo(
    () => points.filter((p) => p && p.lat != null && p.lng != null),
    [points],
  );

  // ISO codes to fill — unique country codes from the points.
  const visitedSig = useMemo(() => {
    const set = new Set();
    for (const p of drawable) { const c = p.country_code; if (c) set.add(String(c).trim().toUpperCase()); }
    return [...set].sort().join(',');
  }, [drawable]);

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

    // City pins are optional — the Trips home shows country fill only (pins={false}).
    if (pins) {
      groupByLocation(drawable.map((p) => ({ lng: +p.lng, lat: +p.lat, label: null, data: p }))).forEach((g) => {
        const title = g.data.map((p) => p.city_name).filter(Boolean).join(' • ');
        const el = createMarkerEl(null, {
          title,
          tone: dominantTone(g.data),
          onClick: onPointClickRef.current ? () => { const cb = onPointClickRef.current; if (cb) cb(g.data); } : undefined,
        });
        const marker = new mapboxgl.Marker({ element: el }).setLngLat([g.lng, g.lat]).addTo(map);
        markersRef.current.push(marker);
      });
    }

    if (drawable.length > 0 && fittedSigRef.current !== pointsSig) {
      fitToPoints(map, drawable.map((p) => [+p.lng, +p.lat]), { padding: 56, maxZoom: 6, animate: fittedSigRef.current !== '' });
      fittedSigRef.current = pointsSig;
    }
    return undefined;
  }, [ready, drawable, pointsSig, pins]);

  // Country fill click → onCountryClick(isoAlpha2). The fill layer covers every
  // country (visited or not); the consumer decides whether the clicked code is in
  // its data. Cursor turns into a pointer over the layer. Wired once when ready.
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !ready) return undefined;
    const onClick = (e) => {
      const f = e.features && e.features[0];
      const iso = f && f.id;
      const cb = onCountryClickRef.current;
      if (iso && cb) cb(String(iso).toUpperCase());
    };
    const enter = () => { map.getCanvas().style.cursor = 'pointer'; };
    const leave = () => { map.getCanvas().style.cursor = ''; };
    try {
      map.on('click', COUNTRY_FILL_LAYER, onClick);
      map.on('mouseenter', COUNTRY_FILL_LAYER, enter);
      map.on('mouseleave', COUNTRY_FILL_LAYER, leave);
    } catch { /* layer not present yet — ignore */ }
    return () => {
      try {
        map.off('click', COUNTRY_FILL_LAYER, onClick);
        map.off('mouseenter', COUNTRY_FILL_LAYER, enter);
        map.off('mouseleave', COUNTRY_FILL_LAYER, leave);
      } catch { /* ignore */ }
    };
  }, [ready]);

  // Resize when the container changes size out-of-band (e.g. fullscreen toggle):
  // Mapbox can't observe a CSS-driven resize, so the consumer bumps `sizeSignal`.
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !ready) return;
    requestAnimationFrame(() => { try { map.resize(); } catch { /* ignore */ } });
  }, [sizeSignal, ready]);

  return (
    <div style={{ position: 'absolute', inset: 0 }}>
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
