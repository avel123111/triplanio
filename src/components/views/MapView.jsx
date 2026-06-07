import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Icon } from '@/design/icons';
import { useT } from '@/lib/i18n/I18nContext';
import { mapboxgl, MAPBOX_TOKEN, applyBasemapConfig, fitToPoints } from '@/lib/mapbox';
import { useSharedMap } from '@/lib/map/MapProvider';
import { drawRouteLinesCached } from '@/lib/map/routeLines';
import { countryFlag } from '@/lib/geo';
import { sortVisits } from '@/lib/validation';

const MARKER_COLOR = 'hsl(243 75% 59%)';
const ROUTE_COLOR = '#2167e2'; // brand (mapbox paint needs a concrete hex; theme-adaptive route = P1)

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
  const sharedMap = useSharedMap();
  const containerRef = useRef(null);
  const mapRef = useRef(null);
  const markersRef = useRef([]);
  const fittedSigRef = useRef('');
  // Seed `ready` from the shared map's current state so revisiting a map screen
  // doesn't flash the spinner/fade-in (the instance is already loaded).
  const [ready, setReady] = useState(() => {
    const m = sharedMap?.getMap?.();
    return !!(m && m.isStyleLoaded && m.isStyleLoaded());
  });
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

  // --- Claim the app-wide singleton map into this screen's slot. The map is
  // NOT created or destroyed here: it's acquired (its element moved into our
  // container) on mount and parked back on unmount, so the instance, camera,
  // tiles and sources persist across screens/trips. Day/night and projection
  // are applied via config below, not by re-creating the map. ---
  useEffect(() => {
    const slot = containerRef.current;
    if (!slot) return undefined;
    if (!sharedMap || !sharedMap.hasToken) { setError('No Mapbox token'); return undefined; }
    const map = sharedMap.acquire(slot, schemeRef.current);
    if (!map) { setError('No map'); return undefined; }
    mapRef.current = map;
    fittedSigRef.current = '';
    // 'load'/'style.load' only fire on the instance's first life; on reuse the
    // style is already loaded, so check synchronously and fall back to the event.
    const markReady = () => setReady(true);
    if (map.isStyleLoaded()) markReady(); else map.once('style.load', markReady);
    const onErr = (e) => { if (e?.error?.message) setError(e.error.message); };
    map.on('error', onErr);
    return () => {
      map.off('error', onErr);
      // Remove only this screen's markers. The route LINE layers stay on the
      // shared instance so reopening the same route doesn't rebuild/re-fetch
      // them — drawRouteLinesCached replaces them only when the route changes.
      markersRef.current.forEach((m) => m.remove());
      markersRef.current = [];
      sharedMap.release(slot);
      mapRef.current = null;
      setReady(false);
      fittedSigRef.current = '';
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
    drawRouteLinesCached(map, lineSig, legs, {
      dashedId: 'mv-dashed', solidId: 'mv-solid',
      dashedColor: ROUTE_COLOR, solidColor: ROUTE_COLOR, dashedOpacity: 0.4,
    });

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
  }, [ready, ordered, transfers, visitsSignature]);

  return (
    <div style={{ width: '100%', height: '100%', position: 'relative' }}>
      <div ref={containerRef} style={{ width: '100%', height: '100%', opacity: ready ? 1 : 0, transition: 'opacity .3s ease' }} />
      {!ready && (
        <div style={{ position: 'absolute', inset: 0, display: 'grid', placeItems: 'center', fontSize: 'var(--fs-base)', color: 'var(--muted)', background: 'var(--surface)', zIndex: 2 }}>
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
