import { useEffect, useRef, useState } from 'react';
import { MAPBOX_TOKEN, applyBasemapConfig } from '@/lib/mapbox';
import { useI18n } from '@/lib/i18n/I18nContext';
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
export function useMapSurface(containerRef, { markersRef, scheme = 'LIGHT', projection = 'mercator', active = true, basemapTheme = 'default', cooperativeGestures = true }) {
  const sharedMap = useSharedMap();
  const { lang } = useI18n();
  const mapRef = useRef(null);
  // `ready` = the STYLE is loaded → hide the loading overlay / fade the map in.
  // Seeded from a reused singleton's style so revisits don't flash a spinner.
  const [ready, setReady] = useState(() => {
    const m = sharedMap?.getMap?.();
    return !!(m && m.isStyleLoaded && m.isStyleLoaded());
  });
  // `canFit` = style loaded AND the slot is MEASURED (non-zero box). Consumers
  // gate every camera fit-by-bounds on this (not `ready`), so a fit can no longer
  // run against a zero-size slot — the ROOT fix for "Map cannot fit within canvas"
  // (fresh mount / singleton re-parent / a collapsed lens). Kept separate from
  // `ready` so the overlay still hides on style-load without waiting for layout
  // (no spinner flash), while the camera waits for a real container. (TRIP-202)
  const [canFit, setCanFit] = useState(false);
  const [error, setError] = useState(MAPBOX_TOKEN ? null : 'No Mapbox token');

  // Latest scheme/projection/lang captured for the one-time acquire below.
  // `lang` only feeds the map's first-ever creation (singleton, set once); it is
  // not re-applied live — a new locale is picked up on the next page load.
  const schemeRef = useRef(scheme);
  const projRef = useRef(projection);
  const themeRef = useRef(basemapTheme);
  const langRef = useRef(lang);
  const coopRef = useRef(cooperativeGestures);
  useEffect(() => { schemeRef.current = scheme; }, [scheme]);
  useEffect(() => { projRef.current = projection; }, [projection]);
  useEffect(() => { themeRef.current = basemapTheme; }, [basemapTheme]);
  useEffect(() => { langRef.current = lang; }, [lang]);
  useEffect(() => { coopRef.current = cooperativeGestures; }, [cooperativeGestures]);

  // Claim the singleton into this slot on mount; park it back on unmount.
  useEffect(() => {
    const slot = containerRef.current;
    if (!slot) return undefined;
    if (!sharedMap || !sharedMap.hasToken) { setError('No Mapbox token'); return undefined; }
    const map = sharedMap.acquire(slot, schemeRef.current, langRef.current);
    if (!map) { setError('No map'); return undefined; }
    mapRef.current = map;

    // Two readiness halves: styleOK (style loaded → overlay) and sizeOK (slot
    // measured). `ready` latches on style; `canFit` latches only when BOTH hold.
    let styleOK = map.isStyleLoaded();
    let sizeOK = false;
    const slotSized = () => {
      const el = map.getContainer();
      return !!el && el.clientWidth > 0 && el.clientHeight > 0;
    };
    const settle = () => {
      if (styleOK) setReady(true);
      if (styleOK && sizeOK) setCanFit(true);
    };
    // 'style.load' only fires on the instance's first life; on reuse the style is
    // already loaded (styleOK true synchronously). 'idle' is a reliable fallback
    // if isStyleLoaded() read false transiently right after a re-parent.
    const markStyle = () => { styleOK = true; settle(); };
    if (styleOK) markStyle();
    else {
      map.once('style.load', markStyle);
      map.once('idle', markStyle);
    }
    // ResizeObserver drives the "measured" half AND resizes the canvas when the
    // slot appears / changes size (fresh slot after a re-parent, or a collapsed
    // lens becoming visible) — one owner of "the map follows its slot's size".
    const ro = new ResizeObserver(() => {
      if (!slotSized()) return;
      sizeOK = true;
      try { map.resize(); } catch { /* ignore */ }
      settle();
    });
    ro.observe(slot);
    sizeOK = slotSized();
    settle();

    // Re-assert this screen's view state on a reused instance (the live effects
    // below only fire on a later change, not on a fresh mount).
    try { map.setProjection(projRef.current); } catch { /* ignore */ }
    applyBasemapConfig(map, schemeRef.current, themeRef.current);
    // Cooperative-gestures guard ("use two fingers / ctrl+scroll") is a property of
    // the SHARED singleton, so it must be re-asserted per screen: whichever surface
    // owns the map now sets its own value (default on; the Map lens turns it off).
    try { if (typeof map.setCooperativeGestures === 'function') map.setCooperativeGestures(coopRef.current); } catch { /* ignore */ }

    // The singleton is re-parented into this screen's slot; Mapbox keeps the
    // canvas at its previous size until told. On a REUSED instance `ready` is
    // already true (no style.load transition), so the [active, ready] resize
    // effect can fire before layout settles — resize again after two frames so
    // the canvas matches the new container (otherwise the map can render blank,
    // e.g. the stats screen whose .mapwrap sizes via min-height).
    requestAnimationFrame(() => requestAnimationFrame(() => {
      try { map.resize(); } catch { /* ignore */ }
      // Reused instance has settled into the new slot — re-check both readiness
      // halves after the canvas resizes (no later 'style.load'). Backstop for
      // environments/tests without ResizeObserver delivery.
      if (map.isStyleLoaded && map.isStyleLoaded()) styleOK = true;
      if (slotSized()) sizeOK = true;
      settle();
      // Re-assert this screen's basemap theme/preset after the canvas settles in
      // its new slot. The synchronous applyBasemapConfig above can be dropped while
      // the singleton is mid re-parent (the previous screen's variant — e.g. the
      // monochrome Trips/Stats map — then lingers until a later remount/resize).
      // Re-applying here flips the style immediately on navigation.
      applyBasemapConfig(map, schemeRef.current, themeRef.current);
      repaintRouteLines(map);
    }));

    // Belt-and-braces: re-apply theme/preset once the re-parented map is fully
    // idle. setConfigProperty('basemap','theme',…) called synchronously (or even
    // on rAF) right after the DOM move can throw "style is not done loading" and
    // get swallowed by applyBasemapConfig's try/catch — leaving the PREVIOUS
    // screen's basemap theme (the grey monochrome map from Home/Stats) on a
    // trip/planner map until a remount. 'idle' fires after the resize + first
    // render settle, when the config is reliably writable, so the theme actually
    // flips here. Self-removes after the first successful pass.
    const applyThemeOnIdle = () => {
      applyBasemapConfig(map, schemeRef.current, themeRef.current);
      repaintRouteLines(map);
      try { map.off('idle', applyThemeOnIdle); } catch { /* ignore */ }
    };
    map.on('idle', applyThemeOnIdle);

    const onErr = (e) => { if (e?.error?.message) setError(e.error.message); };
    map.on('error', onErr);

    return () => {
      try { ro.disconnect(); } catch { /* ignore */ }
      try { map.off('idle', applyThemeOnIdle); } catch { /* ignore */ }
      map.off('error', onErr);
      // Hand the singleton back with the guard ON (the protected default) so a
      // later screen that doesn't opt out isn't left ungated. Uses the local `map`
      // (mapRef is nulled below), so it runs reliably on unmount.
      try { if (typeof map.setCooperativeGestures === 'function') map.setCooperativeGestures(true); } catch { /* ignore */ }
      // Remove only this screen's markers; the route line layers stay on the
      // shared instance (drawRouteLinesCached replaces them only on change).
      if (markersRef?.current) {
        markersRef.current.forEach((m) => m.remove());
        markersRef.current = [];
      }
      sharedMap.release(slot);
      mapRef.current = null;
      setReady(false);
      setCanFit(false);
    };
  }, []);

  // Live day/night switch (in place — no map re-render). Re-apply the basemap
  // preset AND re-read the route colour token so existing line layers follow the
  // theme (markers are CSS-tokened DOM, so they re-colour themselves).
  useEffect(() => {
    if (mapRef.current && ready) {
      applyBasemapConfig(mapRef.current, scheme, basemapTheme);
      repaintRouteLines(mapRef.current);
    }
  }, [scheme, ready, basemapTheme]);

  // Live projection (flat mercator ↔ globe).
  useEffect(() => {
    if (mapRef.current && ready) { try { mapRef.current.setProjection(projection); } catch { /* ignore */ } }
  }, [projection, ready]);

  // Live cooperative-gestures guard (also fires on mount, so it re-asserts this
  // screen's value on a reused singleton even if the acquire pass missed).
  useEffect(() => {
    if (mapRef.current && ready && typeof mapRef.current.setCooperativeGestures === 'function') {
      try { mapRef.current.setCooperativeGestures(cooperativeGestures); } catch { /* ignore */ }
    }
  }, [cooperativeGestures, ready]);

  // Resize when re-shown after being hidden behind another tab (Mapbox can't
  // observe a display:none→block transition).
  useEffect(() => {
    if (active && mapRef.current && ready) {
      requestAnimationFrame(() => { try { mapRef.current.resize(); } catch { /* ignore */ } });
    }
  }, [active, ready]);

  return { mapRef, ready, canFit, error };
}
