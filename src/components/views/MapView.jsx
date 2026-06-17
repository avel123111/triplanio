import React, { useEffect, useMemo, useRef, useState } from 'react';
import { mapboxgl, fitToPoints } from '@/lib/mapbox';
import { useMapSurface } from '@/lib/map/useMapSurface';
import { drawRouteLinesCached } from '@/lib/map/routeLines';
import { groupByLocation, createMarkerEl, iconForKinds } from '@/lib/map/markers';
import MapControls from '@/lib/map/MapControls';
import { countryFlag } from '@/lib/geo';
import { sortVisits } from '@/lib/validation';

// ---------------- Main MapView ----------------
// Pure map surface - the parent supplies chrome (theme toggle, overlays) and
// MUST give this component explicit dimensions (it fills 100% × 100%). The
// singleton lifecycle (acquire/release/ready/resize/theme/projection) lives in
// useMapSurface; markers + route lines are drawn with the shared map modules so
// every map screen renders them identically.
export default function MapView({
  visits,
  transfers,
  showStartEnd = true,
  colorScheme = 'LIGHT',
  onCityClick,
  // Optional: id of the city_visit currently selected/open in the parent (the
  // editor's open panel, the Map lens' active stepper item). Its marker renders
  // in the highlighted "selected" state. Falsy ⇒ nothing selected.
  selectedVisitId = null,
  // Optional camera focus driven by the parent (e.g. the editor's open panel):
  // array of [lng,lat] points. 1 point → flyTo the city; 2 → fit both cities.
  // Falsy/empty → no override (the whole-route auto-fit stays in charge); when
  // it clears after a focus, the camera eases back to the full route.
  focus = null,
  // When the map is kept mounted but hidden behind another tab, the parent flips
  // `active` to false. On re-show its container regains size, so the map needs a
  // resize() (handled in useMapSurface).
  active = true,
  // Show the on-map control buttons (projection, theme, start/finish toggles).
  mapControls = false,
  children,
}) {
  const containerRef = useRef(null);
  const markersRef = useRef([]);
  const fittedSigRef = useRef('');

  const [projection, setProjection] = useState('mercator');
  // Internal toggles (driven by the on-map control buttons). Seeded from props and
  // re-synced if the prop changes (e.g. the app theme), but the buttons can override.
  const [mapScheme, setMapScheme] = useState(colorScheme);
  const [showSE, setShowSE] = useState(showStartEnd);
  useEffect(() => { setMapScheme(colorScheme); }, [colorScheme]);
  useEffect(() => { setShowSE(showStartEnd); }, [showStartEnd]);

  // Shared singleton lifecycle (acquire/release, ready-seed, theme, projection,
  // resize, marker cleanup on unmount).
  const { mapRef, ready, error } = useMapSurface(containerRef, {
    markersRef, scheme: mapScheme, projection, active,
  });

  // Force a re-fit on (re)mount so the first draw frames the route.
  useEffect(() => { fittedSigRef.current = ''; }, []);

  // Keep the latest onCityClick without forcing the draw effect to re-run.
  const onCityClickRef = useRef(onCityClick);
  useEffect(() => { onCityClickRef.current = onCityClick; }, [onCityClick]);

  const ordered = useMemo(() => {
    const all = sortVisits(visits).filter((v) => v.latitude && v.longitude);
    return showSE ? all : all.filter((v) => v.kind !== 'start' && v.kind !== 'end');
  }, [visits, showSE]);

  const visitsSignature = useMemo(
    () => ordered.map((v) => `${v.id}:${v.latitude.toFixed(5)},${v.longitude.toFixed(5)}`).join('|'),
    [ordered],
  );

  // --- Parent-driven camera focus (panel ↔ map). Independent of the data draw
  // effect: opening a panel doesn't change `visits`, so the auto-fit won't move;
  // this flies to the focused city / fits the two transfer cities, and eases
  // back to the full route once focus clears. ---
  const focusSig = useMemo(
    () => (Array.isArray(focus) && focus.length ? focus.map((p) => p.join(',')).join('|') : ''),
    [focus],
  );
  const hadFocusRef = useRef(false);
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !ready) return;
    if (focusSig) {
      hadFocusRef.current = true;
      if (focus.length === 1) {
        map.flyTo({ center: focus[0], zoom: 9.5, duration: 700, essential: true });
      } else {
        fitToPoints(map, focus, { padding: 110, maxZoom: 9, animate: true });
      }
    } else if (hadFocusRef.current) {
      hadFocusRef.current = false;
      if (ordered.length > 0) {
        fitToPoints(map, ordered.map((v) => [v.longitude, v.latitude]), { padding: 60, maxZoom: 8, animate: true });
      }
    }
  }, [ready, focusSig]);

  // --- Draw markers + route lines whenever the data changes ---
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !ready) return undefined;

    // Markers - clear previous, then group visits that share a location.
    markersRef.current.forEach((m) => m.remove());
    markersRef.current = [];
    // Number ONLY transit cities (1,2,3…). start / end / waypoint carry no
    // number; they render as flags / a transit glyph (see iconForKinds). Unknown
    // kinds default to transit so legacy rows still get a number.
    let transitNo = 0;
    const points = ordered.map((v) => {
      const isTransit = v.kind !== 'start' && v.kind !== 'end' && v.kind !== 'waypoint';
      return {
        lng: v.longitude,
        lat: v.latitude,
        label: isTransit ? String(++transitNo) : null,
        kind: v.kind,
        data: v,
      };
    });
    groupByLocation(points).forEach((g) => {
      const title = g.data
        .map((v) => `${countryFlag(v.country_code)} ${v.city_name}${v.country ? ', ' + v.country : ''}`)
        .join(' • ');
      const selected = selectedVisitId != null && g.data.some((v) => v && v.id === selectedVisitId);
      const el = createMarkerEl(g.labels.filter((l) => l != null), {
        title,
        icon: iconForKinds(g.kinds),
        selected,
        onClick: () => { const cb = onCityClickRef.current; if (cb) cb(g.data); },
      });
      const marker = new mapboxgl.Marker({ element: el }).setLngLat([g.lng, g.lat]).addTo(map);
      markersRef.current.push(marker);
    });

    // Routes - dashed for "no transfer", solid for road/flight/other. Leg kind
    // comes from the transfer between consecutive visits (none ⇒ dashed).
    const transferByPair = new globalThis.Map();
    transfers.forEach((t) => {
      const k = `${t.from_city_visit_id}__${t.to_city_visit_id}`;
      if (!transferByPair.has(k)) transferByPair.set(k, t);
    });
    const legs = [];
    for (let i = 0; i < ordered.length - 1; i++) {
      const from = ordered[i];
      const to = ordered[i + 1];
      legs.push({ from, to, kind: transferByPair.get(`${from.id}__${to.id}`)?.transport_type });
    }
    // Signature of everything the lines depend on (route order/coords +
    // per-leg transport). If unchanged, the cached draw is a no-op → no rebuild,
    // no OSRM refetch, no flicker when reopening the map.
    const transfersSig = transfers
      .map((t) => `${t.from_city_visit_id}>${t.to_city_visit_id}:${t.transport_type || ''}`)
      .join('|');
    const lineSig = `trip:${visitsSignature}::${transfersSig}`;
    // Colours/widths come from the shared mapStyle defaults.
    drawRouteLinesCached(map, lineSig, legs, { dashedId: 'mv-dashed', solidId: 'mv-solid' });

    // Fit once per distinct set of visits - animate the camera so the map
    // glides out/in to the route as it changes (e.g. while editing structure).
    // First fit (after load / style reload) is instant; later changes ease.
    // BUT don't override an active parent focus (e.g. landing straight on a city/
    // transfer via a create-intent) — the focus effect owns the camera then.
    if (ordered.length > 0 && fittedSigRef.current !== visitsSignature && !focusSig) {
      fitToPoints(map, ordered.map((v) => [v.longitude, v.latitude]), { padding: 60, maxZoom: 8, animate: fittedSigRef.current !== '' });
      fittedSigRef.current = visitsSignature;
    }

    return undefined;
  }, [ready, ordered, transfers, visitsSignature, selectedVisitId]);

  return (
    <div style={{ width: '100%', height: '100%', position: 'relative' }}>
      <div ref={containerRef} style={{ width: '100%', height: '100%', opacity: ready ? 1 : 0, transition: 'opacity .3s ease' }} />
      {!ready && (
        <div style={{ position: 'absolute', inset: 0, display: 'grid', placeItems: 'center', fontSize: 'var(--fs-base)', color: 'var(--muted)', background: 'var(--surface)', zIndex: 2 }}>
          {error ? `Map error: ${error}` : <div style={{ width: 24, height: 24, border: '2px solid var(--line)', borderTopColor: 'var(--ink)', borderRadius: '50%', animation: 'spin .7s linear infinite' }} />}
        </div>
      )}
      {mapControls && ready && (
        <MapControls
          projection={projection}
          onToggleProjection={() => setProjection((p) => (p === 'globe' ? 'mercator' : 'globe'))}
          scheme={mapScheme}
          onToggleScheme={() => setMapScheme((s) => (s === 'DARK' ? 'LIGHT' : 'DARK'))}
          showSE={showSE}
          onToggleSE={() => setShowSE((v) => !v)}
        />
      )}
      {children}
    </div>
  );
}
