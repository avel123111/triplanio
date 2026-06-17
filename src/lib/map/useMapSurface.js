import { useEffect, useRef, useState } from 'react';
import { MAPBOX_TOKEN, applyBasemapConfig } from '@/lib/mapbox';
import { repaintRouteLines } from './routeLines';
import { useSharedMap } from './MapProvider';

// Shared lifecycle for any screen that shows the app-wide singleton Mapbox map.
// The instance is never created/destroyed here: it's acquired (its element moved
// into `containerRef`) on mount and parked back on unmount, so camera, tiles,
// sources and route layers persist across screens. This hook owns the bits that
// were copy-pasted between MapView and FlowMap — acquire/release, ready-seeding
// (no spinner flash on revisit), day/night + projection re-assert, the resize on
// re-show, and this screen's marker cleanup on unmount (route LINE layers are
// deliberately left on the instance so reopening the same route doesn't rebuild
// or re-fetch them).
//
// containerRef : ref to the slot div the map should fill.
// markersRef   : ref to an array of this screen's mapboxgl.Markers (removed on
//                unmount); the draw effect in the consumer fills/clears it.
// scheme       : 'LIGHT' | 'DARK' (live-applied).
// projection   : 'mercator' | 'globe' (live-applied).
// active       : false when the map is kept mounted but hidden behind a tab;
//                flipping back to true triggers a resize().
export function useMapSurface(containerRef, { markersRef, scheme = 'LIGHT', projection = 'mercator', active = true }) {
  const sharedMap = useSharedMap();
  const mapRef = useRef(null);
  const [ready, setReady] = useState(() => {
    const m = sharedMap?.getMap?.();
    return !!(m && m.isStyleLoaded && m.isStyleLoaded());
  });
  const [error, setError] = useState(MAPBOX_TOKEN ? null : 'No Mapbox token');

  // Latest scheme/projection captured for the one-time acquire below.
  const schemeRef = useRef(scheme);
  const projRef = useRef(projection);
  useEffect(() => { schemeRef.current = scheme; }, [scheme]);
  useEffect(() => { projRef.current = projection; }, [projection]);

  // Claim the singleton into this slot on mount; park it back on unmount.
  useEffect(() => {
    const slot = containerRef.current;
    if (!slot) return undefined;
    if (!sharedMap || !sharedMap.hasToken) { setError('No Mapbox token'); return undefined; }
    const map = sharedMap.acquire(slot, schemeRef.current);
    if (!map) { setError('No map'); return undefined; }
    mapRef.current = map;

    // 'style.load' only fires on the instance's first life; on reuse the style is
    // already loaded, so check synchronously and fall back to the event.
    const markReady = () => setReady(true);
    if (map.isStyleLoaded()) markReady(); else map.once('style.load', markReady);

    // Re-assert this screen's view state on a reused instance (the live effects
    // below only fire on a later change, not on a fresh mount).
    try { map.setProjection(projRef.current); } catch { /* ignore */ }
    applyBasemapConfig(map, schemeRef.current);

    const onErr = (e) => { if (e?.error?.message) setError(e.error.message); };
    map.on('error', onErr);

    return () => {
      map.off('error', onErr);
      // Remove only this screen's markers; the route line layers stay on the
      // shared instance (drawRouteLinesCached replaces them only on change).
      if (markersRef?.current) {
        markersRef.current.forEach((m) => m.remove());
        markersRef.current = [];
      }
      sharedMap.release(slot);
      mapRef.current = null;
      setReady(false);
    };
  }, []);

  // Live day/night switch (in place — no map re-render). Re-apply the basemap
  // preset AND re-read the route colour token so existing line layers follow the
  // theme (markers are CSS-tokened DOM, so they re-colour themselves).
  useEffect(() => {
    if (mapRef.current && ready) {
      applyBasemapConfig(mapRef.current, scheme);
      repaintRouteLines(mapRef.current);
    }
  }, [scheme, ready]);

  // Live projection (flat mercator ↔ globe).
  useEffect(() => {
    if (mapRef.current && ready) { try { mapRef.current.setProjection(projection); } catch { /* ignore */ } }
  }, [projection, ready]);

  // Resize when re-shown after being hidden behind another tab (Mapbox can't
  // observe a display:none→block transition).
  useEffect(() => {
    if (active && mapRef.current && ready) {
      requestAnimationFrame(() => { try { mapRef.current.resize(); } catch { /* ignore */ } });
    }
  }, [active, ready]);

  return { mapRef, ready, error };
}
