import React, { createContext, useContext, useCallback, useMemo, useRef, useEffect } from 'react';
import { mapboxgl, MAPBOX_TOKEN, MAP_STYLE, baseConfig } from '@/lib/mapbox';

// ─── App-wide singleton Mapbox map ────────────────────────────────────────────
// There is exactly ONE mapboxgl.Map for the whole app. It is created once
// (lazily, on the first screen that mounts a MapView) into an off-screen holder,
// then its container element is *moved* (appendChild) into whichever screen's
// slot is currently visible. Because the instance is never destroyed between
// screens, the camera, loaded tiles, GeoJSON sources, markers and route persist
// across lens switches and even across trips within the same session — without
// re-initialising the map (a new "map load").
//
// Hard limit to keep in mind: a live Mapbox GL map is a runtime WebGL object and
// CANNOT survive a full page reload. "Next day", a hard refresh, another device
// or another user are each a fresh page load = one new map load. The singleton
// only removes *redundant* re-creation within one live page session.
//
// Invariant: only ONE MapView (slot) may be mounted at a time, since there is a
// single map element that can live in a single slot. Callers must not mount two
// map surfaces simultaneously (screens are mutually exclusive).

const MapCtx = createContext(null);

export function MapProvider({ children }) {
  const mapRef = useRef(null);
  const holderRef = useRef(null);
  const ownerRef = useRef(null);

  // Off-screen holder where the map is parked while no screen is showing it.
  // Real dimensions so a parked map keeps a valid size (avoids a 0×0 canvas).
  if (!holderRef.current && typeof document !== 'undefined') {
    const h = document.createElement('div');
    h.style.cssText = 'position:fixed;left:-99999px;top:0;width:800px;height:600px;pointer-events:none;';
    holderRef.current = h;
  }

  useEffect(() => {
    const h = holderRef.current;
    if (h && !h.isConnected) document.body.appendChild(h);
    return () => {
      // Full app teardown (or dev hot-reload): dispose the instance + holder.
      try { mapRef.current?.remove(); } catch { /* ignore */ }
      mapRef.current = null;
      ownerRef.current = null;
      try { h?.remove(); } catch { /* ignore */ }
    };
  }, []);

  // Create the single map on first demand (parked in the holder).
  const ensureMap = useCallback((scheme) => {
    if (mapRef.current || !MAPBOX_TOKEN || !holderRef.current) return mapRef.current;
    const el = document.createElement('div');
    el.style.cssText = 'width:100%;height:100%;';
    holderRef.current.appendChild(el);
    const map = new mapboxgl.Map({
      container: el,
      style: MAP_STYLE,
      config: baseConfig(scheme),
      center: [0, 20],
      zoom: 2,
      projection: 'mercator',
      cooperativeGestures: true,
      // Attribution moved bottom-left so it doesn't swallow clicks on the
      // editor's bottom-right warnings widget (matches the old MapView setup).
      attributionControl: false,
    });
    map.addControl(new mapboxgl.AttributionControl({ compact: true }), 'bottom-left');
    mapRef.current = map;
    return map;
  }, []);

  // A screen claims the map: move its element into `slot` and resize.
  const acquire = useCallback((slot, scheme) => {
    if (!slot) return null;
    const map = ensureMap(scheme);
    if (!map) return null;
    const el = map.getContainer();
    if (el.parentNode !== slot) slot.appendChild(el);
    ownerRef.current = slot;
    // Mapbox can't observe the DOM move; resize after the browser lays out.
    requestAnimationFrame(() => { try { map.resize(); } catch { /* ignore */ } });
    return map;
  }, [ensureMap]);

  // A screen unmounts: park the map back in the holder so it survives. If a newer
  // screen already took ownership, do nothing (don't steal it back).
  const release = useCallback((slot) => {
    const map = mapRef.current;
    if (!map || !holderRef.current) return;
    if (ownerRef.current && ownerRef.current !== slot) return;
    const el = map.getContainer();
    if (el.parentNode !== holderRef.current) holderRef.current.appendChild(el);
    ownerRef.current = null;
  }, []);

  const value = useMemo(
    () => ({ acquire, release, getMap: () => mapRef.current, hasToken: !!MAPBOX_TOKEN }),
    [acquire, release],
  );

  return <MapCtx.Provider value={value}>{children}</MapCtx.Provider>;
}

export function useSharedMap() {
  return useContext(MapCtx);
}
