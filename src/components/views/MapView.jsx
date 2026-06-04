import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Icon } from '@/design/icons';
import { useT } from '@/lib/i18n/I18nContext';
import { mapboxgl, MAPBOX_TOKEN, MAP_STYLE, baseConfig, applyBasemapConfig, fitToPoints, lineFeature, setLineLayer } from '@/lib/mapbox';
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
// Pure map surface - the parent supplies chrome (theme toggle, overlays) and
// MUST give this component explicit dimensions (it fills 100% × 100%).
export default function MapView({
  visits,
  transfers,
  showStartEnd = true,
  colorScheme = 'LIGHT',
  onCityClick,
  // Optional camera focus driven by the parent (e.g. the editor's open panel):
  // array of [lng,lat] points. 1 point → flyTo the city; 2 → fit both cities.
  // Falsy/empty → no override (the whole-route auto-fit stays in charge); when
  // it clears after a focus, the camera eases back to the full route.
  focus = null,
  // When the map is kept mounted but hidden behind another tab, the parent flips
  // `active` to false. On re-show its container regains size, so the map needs a
  // resize() (Mapbox can't observe a display:none→block transition).
  active = true,
  // Show the on-map control buttons (projection, theme, start/finish toggles).
  mapControls = false,
  children,
}) {
  const t = useT();
  const containerRef = useRef(null);
  const mapRef = useRef(null);
  const markersRef = useRef([]);
  const fittedSigRef = useRef('');
  const [ready, setReady] = useState(false);
  const [projection, setProjection] = useState('mercator');
  // Internal toggles (driven by the on-map control buttons). Seeded from props and
  // re-synced if the prop changes (e.g. the app theme), but the buttons can override.
  const [mapScheme, setMapScheme] = useState(colorScheme);
  const [showSE, setShowSE] = useState(showStartEnd);
  useEffect(() => { setMapScheme(colorScheme); }, [colorScheme]);
  useEffect(() => { setShowSE(showStartEnd); }, [showStartEnd]);
  const [error, setError] = useState(MAPBOX_TOKEN ? null : 'No Mapbox token');

  // Keep the latest onCityClick without forcing the draw effect to re-run.
  const onCityClickRef = useRef(onCityClick);
  useEffect(() => { onCityClickRef.current = onCityClick; }, [onCityClick]);

  // Current theme captured for the one-time map init (live changes handled below).
  const schemeRef = useRef(mapScheme);
  useEffect(() => { schemeRef.current = mapScheme; }, [mapScheme]);

  const ordered = useMemo(() => {
    const all = sortVisits(visits).filter((v) => v.latitude && v.longitude);
    return showSE ? all : all.filter((v) => v.kind !== 'start' && v.kind !== 'end');
  }, [visits, showSE]);

  const visitsSignature = useMemo(
    () => ordered.map((v) => `${v.id}:${v.latitude.toFixed(5)},${v.longitude.toFixed(5)}`).join('|'),
    [ordered],
  );

  // --- Init map once. Day/night is applied via config (below), not by
  // re-creating the map - so markers/routes persist across theme toggles. ---
  useEffect(() => {
    if (!containerRef.current || !MAPBOX_TOKEN) return undefined;
    const map = new mapboxgl.Map({
      container: containerRef.current,
      style: MAP_STYLE,
      config: baseConfig(schemeRef.current),
      center: [0, 20],
      zoom: 2,
      projection: 'mercator',
      cooperativeGestures: true,
      // Default attribution sits bottom-RIGHT, where the editor's warnings widget
      // lives — its control would swallow those clicks. Move it bottom-LEFT.
      attributionControl: false,
    });
    map.addControl(new mapboxgl.AttributionControl({ compact: true }), 'bottom-left');
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
  }, []);

  // --- Resize when re-shown after being hidden behind another tab ---
  useEffect(() => {
    if (active && mapRef.current && ready) {
      requestAnimationFrame(() => { try { mapRef.current.resize(); } catch { /* ignore */ } });
    }
  }, [active, ready]);

  // --- Switch day/night in place when the theme changes (no map re-render) ---
  useEffect(() => {
    if (mapRef.current && ready) applyBasemapConfig(mapRef.current, mapScheme);
  }, [mapScheme, ready]);

  // --- Projection (flat mercator ↔ globe), applied in place ---
  useEffect(() => {
    if (mapRef.current && ready) { try { mapRef.current.setProjection(projection); } catch { /* ignore */ } }
  }, [projection, ready]);

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
    let cancelled = false;

    // Markers - clear previous, then group visits that share a location.
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

    // Routes - dashed for "no transfer", solid for road/flight/other.
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

    // Fit once per distinct set of visits - animate the camera so the map
    // glides out/in to the route as it changes (e.g. while editing structure).
    // First fit (after load / style reload) is instant; later changes ease.
    // BUT don't override an active parent focus (e.g. landing straight on a city/
    // transfer via a create-intent) — the focus effect owns the camera then.
    if (ordered.length > 0 && fittedSigRef.current !== visitsSignature && !focusSig) {
      fitToPoints(map, ordered.map((v) => [v.longitude, v.latitude]), { padding: 60, maxZoom: 8, animate: fittedSigRef.current !== '' });
      fittedSigRef.current = visitsSignature;
    }

    return () => { cancelled = true; };
  }, [ready, ordered, transfers, visitsSignature]);

  return (
    <div style={{ width: '100%', height: '100%', position: 'relative' }}>
      <div ref={containerRef} style={{ width: '100%', height: '100%', opacity: ready ? 1 : 0, transition: 'opacity .3s ease' }} />
      {!ready && (
        <div style={{ position: 'absolute', inset: 0, display: 'grid', placeItems: 'center', fontSize: 13, color: 'var(--muted)', background: 'var(--surface)', zIndex: 2 }}>
          {error ? `Map error: ${error}` : <div style={{ width: 24, height: 24, border: '2px solid var(--line)', borderTopColor: 'var(--ink)', borderRadius: '50%', animation: 'spin .7s linear infinite' }} />}
        </div>
      )}
      {mapControls && ready && (
        <div style={{ position: 'absolute', top: 12, right: 12, zIndex: 6, display: 'flex', flexDirection: 'column', gap: 8 }}>
          {[
            { key: 'proj', title: projection === 'globe' ? t('tse.map_flat') : t('tse.map_globe'), icon: projection === 'globe' ? 'map' : 'globe', onClick: () => setProjection((p) => (p === 'globe' ? 'mercator' : 'globe')) },
            { key: 'theme', title: mapScheme === 'DARK' ? t('tse.map_light') : t('tse.map_dark'), icon: mapScheme === 'DARK' ? 'sun' : 'moon', onClick: () => setMapScheme((s) => (s === 'DARK' ? 'LIGHT' : 'DARK')) },
            { key: 'se', title: t('tse.map_startend'), icon: showSE ? 'flag' : 'eyeOff', onClick: () => setShowSE((v) => !v) },
          ].map((b) => (
            // Constant surface-coloured control buttons (white in light theme,
            // dark in dark theme) — only the icon changes per state.
            <button key={b.key} type="button" onClick={b.onClick} title={b.title} aria-label={b.title}
              style={{ width: 36, height: 36, borderRadius: 9, border: '1px solid var(--line)', background: 'var(--surface)', color: 'var(--ink)', display: 'grid', placeItems: 'center', cursor: 'pointer', boxShadow: 'var(--shadow-soft)' }}>
              <Icon name={b.icon} size={17} />
            </button>
          ))}
        </div>
      )}
      {children}
    </div>
  );
}
