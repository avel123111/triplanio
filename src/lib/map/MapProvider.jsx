import React, { createContext, useContext, useCallback, useMemo, useRef, useState, useEffect } from 'react';
import { mapboxgl, MAPBOX_TOKEN, MAP_STYLE, baseConfig, isMapboxGlLoaded, loadMapboxGl } from '@/lib/mapbox';

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
  // Библиотека карты грузится ПО ТРЕБОВАНИЮ (см. `loadMapboxGl`), поэтому у
  // провайдера есть третье состояние помимо «карта есть» / «токена нет»:
  // «библиотека ещё едет». Оно обязано отличаться от отказа — иначе экран
  // покажет «нет карты» за секунду до того, как карта появится.
  // Начальное значение читается синхронно: если библиотеку уже кто-то загрузил
  // (второй заход на экран с картой), ждать нечего и лишнего кадра не будет.
  const [libReady, setLibReady] = useState(isMapboxGlLoaded);

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
  // `lang` localises basemap labels and is read ONCE here (map is created fresh on
  // each page load → new locale applies on reload). Later acquires can't change it.
  const ensureMap = useCallback((scheme, lang) => {
    if (mapRef.current || !MAPBOX_TOKEN || !holderRef.current) return mapRef.current;
    // Библиотеки ещё нет — заказываем её и уходим ни с чем. Потребитель увидит
    // `null`, останется в состоянии загрузки, а переключённый `libReady`
    // перезапустит его эффект и приведёт сюда второй раз, уже с библиотекой.
    if (!mapboxgl) {
      // Без «жив ли ещё компонент»-страховки СОЗНАТЕЛЬНО: в React 18 setState на
      // размонтированном — безобидный no-op, а вот страховка проглотила бы
      // ответ, пришедший в окно между размонтированием и монтированием (хот-
      // релоад сегодня, `StrictMode` — если его когда-нибудь включат), и карта
      // не появилась бы уже никогда: второго заказа никто не сделает, промис у
      // загрузчика уже разрешён.
      loadMapboxGl()
        .then(() => setLibReady(true))
        .catch(() => { /* сеть; следующий acquire закажет снова */ });
      return null;
    }
    const el = document.createElement('div');
    el.style.cssText = 'width:100%;height:100%;';
    holderRef.current.appendChild(el);
    const map = new mapboxgl.Map({
      container: el,
      style: MAP_STYLE,
      config: baseConfig(scheme),
      // Токен СВОЕЙ опцией, а не из глобального `mapboxgl.accessToken`: глобал
      // ставился побочным эффектом импорта двери, а теперь порядок загрузки не
      // гарантирован (см. `loadMapboxGl`). Правило одно на все три места, где
      // создаётся карта, и пинится тестом.
      ...(MAPBOX_TOKEN ? { accessToken: MAPBOX_TOKEN } : {}),
      // Localise basemap labels. `language` is a top-level Map option (NOT a
      // basemap config prop) — Mapbox Standard reads it at construction and shows
      // labels in this language where the tile data has them. Read once here; the
      // singleton is recreated on each page load, so a new locale applies on reload.
      ...(lang ? { language: lang } : {}),
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
  // `lang` is forwarded to the first-ever creation only (singleton).
  const acquire = useCallback((slot, scheme, lang) => {
    if (!slot) return null;
    const map = ensureMap(scheme, lang);
    if (!map) return null;
    const el = map.getContainer();
    if (el.parentNode !== slot) slot.appendChild(el);
    ownerRef.current = slot;
    // Mapbox can't observe the DOM move. Resize SYNCHRONOUSLY now so the new
    // slot's dimensions are picked up before the consumer's draw/fit effect runs
    // in this same effect flush — otherwise fitBounds computes zoom against the
    // previous screen's canvas size (too close on big→small, too far on
    // small→big). The rAF resize stays as a safety net for late layout.
    try { map.resize(); } catch { /* ignore */ }
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
    () => ({ acquire, release, getMap: () => mapRef.current, hasToken: !!MAPBOX_TOKEN, libReady }),
    [acquire, release, libReady],
  );

  return <MapCtx.Provider value={value}>{children}</MapCtx.Provider>;
}

export function useSharedMap() {
  return useContext(MapCtx);
}
