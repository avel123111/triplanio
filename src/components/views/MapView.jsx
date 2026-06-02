import React, { useEffect, useMemo, useRef, useState } from 'react';
import { mapboxgl, MAPBOX_TOKEN, styleFor, fitToPoints, lineFeature, setLineLayer } from '@/lib/mapbox';
import { countryFlag } from '@/lib/geo';
import { fetchOsrmRoute, geodesicLine, isFlightTransport, isRoadTransport } from '@/lib/routing';
import { sortVisits } from '@/lib/validation';

const MARKER_COLOR = 'hsl(243 75% 59%)';
const ROUTE_COLOR = '#5b6cff';

// ---------------- Marker DOM (unchanged visual) ----------------
function markerDom(numbers) {
  const wrap = document.createElement('div');
  const baseStyle = `background:${MARKER_COLOR};color:white;font-weight:700;box-shadow:0 4px 12px rgba(0,0,0,.25);border:2px solid white;border-radius:9999px;display:flex;align-items:center;justify-content:center;`;
  if (numbers.length === 1) {
    wrap.style.cssText = `${baseStyle}width:28px;height:28px;font-size:12px;cursor:pointer;`;
    wrap.textContent = String(numbers[0]);
    return wrap;
  }
  wrap.style.cssText = `${baseStyle}width:44px;height:28px;font-size:11px;overflow:hidden;position:relative;cursor:pointer;align-items:stretch;`;
  wrap.innerHTML = `
    <div style="flex:1;display:flex;align-items:center;justify-content:center;padding-right:1px;">${numbers[0]}</div>
    <div style="width:1px;background:rgba(255,255,255,.7);transform:skewX(-20deg);"></div>
    <div style="flex:1;display:flex;align-items:center;justify-content:center;padding-left:1px;">${numbers[1]}</div>
  `;
  return wrap;
}

// ---------------- Main MapView ----------------
// Pure map surface — the parent supplies chrome (theme toggle, overlays) and
// MUST give this component explicit dimensions (it fills 100% × 100%).
export default function MapView({
  visits,
  transfers,
  showStartEnd = true,
  colorScheme = 'LIGHT',
  onCityClick,
  children,
}) {
  const containerRef = useRef(null);
  const mapRef = useRef(null);
  const markersRef = useRef([]);
  const fittedSigRef = useRef('');
  const [ready, setReady] = useState(false);
  const [error, setError] = useState(MAPBOX_TOKEN ? null : 'No Mapbox token');

  // Keep the latest onCityClick without forcing the draw effect to re-run.
  const onCityClickRef = useRef(onCityClick);
  useEffect(() => { onCityClickRef.current = onCityClick; }, [onCityClick]);

  const ordered = useMemo(() => {
    const all = sortVisits(visits).filter((v) => v.latitude && v.longitude);
    return showStartEnd ? all : all.filter((v) => v.kind !== 'start' && v.kind !== 'end');
  }, [visits, showStartEnd]);

  const visitsSignature = useMemo(
    () => ordered.map((v) => `${v.id}:${v.latitude.toFixed(5)},${v.longitude.toFixed(5)}`).join('|'),
    [ordered],
  );

  // --- Init map (recreated when the colour scheme changes, like the old key) ---
  useEffect(() => {
    if (!containerRef.current || !MAPBOX_TOKEN) return undefined;
    const map = new mapboxgl.Map({
      container: containerRef.current,
      style: styleFor(colorScheme),
      center: [0, 20],
      zoom: 2,
      cooperativeGestures: true,
      attributionControl: true,
    });
    mapRef.current = map;
    setReady(false);
    fittedSigRef.current = '';
    map.on('load', () => setReady(true));
    map.on('error', (e) => { if (e?.error?.message) setError(e.error.message); });
    return () => {
      markersRef.current.forEach((m) => m.remove());
      markersRef.current = [];
      map.remove();
      mapRef.current = null;
      setReady(false);
    };
  }, [colorScheme]);

  // --- Draw markers + route lines whenever the data changes ---
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !ready) return undefined;
    let cancelled = false;

    // Markers — clear previous, then group visits that share a location.
    markersRef.current.forEach((m) => m.remove());
    markersRef.current = [];
    const groups = new globalThis.Map();
    ordered.forEach((v, i) => {
      const key = `${v.latitude.toFixed(5)},${v.longitude.toFixed(5)}`;
      if (!groups.has(key)) groups.set(key, { lat: v.latitude, lng: v.longitude, items: [] });
      groups.get(key).items.push({ visit: v, index: i + 1 });
    });
    groups.forEach((g) => {
      const numbers = g.items.map((x) => x.index);
      const visitsAtPoint = g.items.map((x) => x.visit);
      const el = markerDom(numbers);
      el.title = g.items
        .map((x) => `${countryFlag(x.visit.country_code)} ${x.visit.city_name}${x.visit.country ? ', ' + x.visit.country : ''}`)
        .join(' • ');
      el.addEventListener('click', () => { const cb = onCityClickRef.current; if (cb) cb(visitsAtPoint); });
      const marker = new mapboxgl.Marker({ element: el }).setLngLat([g.lng, g.lat]).addTo(map);
      markersRef.current.push(marker);
    });

    // Routes — dashed for "no transfer", solid for road/flight/other.
    const transferByPair = new globalThis.Map();
    transfers.forEach((t) => {
      const k = `${t.from_city_visit_id}__${t.to_city_visit_id}`;
      if (!transferByPair.has(k)) transferByPair.set(k, t);
    });

    const dashedFeatures = [];
    const solidFeatures = []; // indexed; road legs upgraded in place after OSRM
    const roadTasks = [];

    for (let i = 0; i < ordered.length - 1; i++) {
      const from = ordered[i];
      const to = ordered[i + 1];
      if (!from.latitude || !to.latitude) continue;
      const straight = [[from.longitude, from.latitude], [to.longitude, to.latitude]];
      const t = transferByPair.get(`${from.id}__${to.id}`);
      if (!t) { dashedFeatures.push(lineFeature(straight)); continue; }
      if (isFlightTransport(t.transport_type)) {
        const arc = geodesicLine(from.latitude, from.longitude, to.latitude, to.longitude).map(([la, lo]) => [lo, la]);
        solidFeatures.push(lineFeature(arc));
      } else if (isRoadTransport(t.transport_type)) {
        const idx = solidFeatures.length;
        solidFeatures.push(lineFeature(straight)); // straight now, upgrade to road geometry async
        roadTasks.push({ idx, from, to, t });
      } else {
        solidFeatures.push(lineFeature(straight));
      }
    }

    setLineLayer(map, 'mv-dashed', dashedFeatures, { color: ROUTE_COLOR, width: 2, dashed: true, opacity: 0.4 });
    setLineLayer(map, 'mv-solid', solidFeatures, { color: ROUTE_COLOR, width: 3.5 });

    (async () => {
      for (const task of roadTasks) {
        const route = await fetchOsrmRoute(task.from.latitude, task.from.longitude, task.to.latitude, task.to.longitude, task.t.transport_type);
        if (cancelled || !mapRef.current) return;
        const coords = route && route.length > 1 ? route.map(([la, lo]) => [lo, la]) : null;
        if (coords) {
          solidFeatures[task.idx] = lineFeature(coords);
          setLineLayer(map, 'mv-solid', solidFeatures, { color: ROUTE_COLOR, width: 3.5 });
        }
      }
    })();

    // Fit once per distinct set of visits.
    if (ordered.length > 0 && fittedSigRef.current !== visitsSignature) {
      fitToPoints(map, ordered.map((v) => [v.longitude, v.latitude]), { padding: 60, maxZoom: 8 });
      fittedSigRef.current = visitsSignature;
    }

    return () => { cancelled = true; };
  }, [ready, ordered, transfers, visitsSignature]);

  return (
    <div style={{ width: '100%', height: '100%', position: 'relative' }}>
      <div ref={containerRef} style={{ width: '100%', height: '100%' }} />
      {!ready && (
        <div style={{ position: 'absolute', inset: 0, display: 'grid', placeItems: 'center', fontSize: 13, color: 'var(--muted)', pointerEvents: 'none' }}>
          {error ? `Map error: ${error}` : <div style={{ width: 24, height: 24, border: '2px solid var(--line)', borderTopColor: 'var(--ink)', borderRadius: '50%', animation: 'spin .7s linear infinite' }} />}
        </div>
      )}
      {children}
    </div>
  );
}
