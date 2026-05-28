import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  APIProvider,
  Map as GoogleMap,
  AdvancedMarker,
  useMap,
  useMapsLibrary,
} from '@vis.gl/react-google-maps';
import { supabase } from '@/api/supabaseClient';
import { countryFlag } from '@/lib/geo';
import { fetchOsrmRoute, isFlightTransport, isRoadTransport } from '@/lib/routing';
import { sortVisits } from '@/lib/validation';

const MARKER_COLOR = 'hsl(243 75% 59%)';
const ROUTE_COLOR = '#5b6cff';

// ---------------- Marker DOM ----------------
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

// ---------------- Routes layer ----------------
function RoutesLayer({ ordered, transfers, visitsSignature }) {
  const map = useMap();
  const mapsLib = useMapsLibrary('maps');
  const fittedSignatureRef = useRef('');

  useEffect(() => {
    if (!map || !mapsLib) return;
    const gmaps = window.google?.maps;
    if (!gmaps) return;
    let cancelled = false;
    const polylines = [];

    const transferByPair = new globalThis.Map();
    transfers.forEach((t) => {
      const key = `${t.from_city_visit_id}__${t.to_city_visit_id}`;
      if (!transferByPair.has(key)) transferByPair.set(key, t);
    });

    const dashedIcon = {
      icon: { path: 'M 0,-1 0,1', strokeOpacity: 1, scale: 3 },
      offset: '0',
      repeat: '14px',
    };

    // Dashed placeholder line — used for "no transfer yet" and for the brief
    // moment while we're fetching the real road route. Pale and thin so it
    // visually reads as "not yet decided".
    const addDashed = (path, opacity = 0.4, weight = 2) => {
      const pl = new gmaps.Polyline({
        path,
        geodesic: false,
        strokeOpacity: 0,
        strokeColor: ROUTE_COLOR,
        strokeWeight: weight,
        icons: [{ ...dashedIcon, icon: { ...dashedIcon.icon, strokeOpacity: opacity, strokeColor: ROUTE_COLOR } }],
        map,
      });
      polylines.push(pl);
      return pl;
    };

    // Solid geodesic line for flights — curved across the globe but a single
    // bold stroke (the previous dashed style was confusing alongside "no
    // transfer" dashed lines).
    const addGeodesic = (path) => {
      const pl = new gmaps.Polyline({
        path,
        geodesic: true,
        strokeOpacity: 1,
        strokeColor: ROUTE_COLOR,
        strokeWeight: 3.5,
        map,
      });
      polylines.push(pl);
      return pl;
    };

    // Solid line for ground transfers (car/train/bus) — follows the road or
    // straight if no route data. Slightly bolder than the dashed placeholder.
    const addSolid = (path) => {
      const pl = new gmaps.Polyline({
        path,
        geodesic: false,
        strokeOpacity: 1,
        strokeColor: ROUTE_COLOR,
        strokeWeight: 3.5,
        map,
      });
      polylines.push(pl);
      return pl;
    };

    for (let i = 0; i < ordered.length - 1; i++) {
      const from = ordered[i];
      const to = ordered[i + 1];
      if (!from.latitude || !to.latitude) continue;
      const key = `${from.id}__${to.id}`;
      const t = transferByPair.get(key);

      const straightPath = [
        { lat: from.latitude, lng: from.longitude },
        { lat: to.latitude, lng: to.longitude },
      ];

      if (!t) {
        // No transfer planned yet — pale dashed placeholder.
        addDashed(straightPath, 0.4, 2);
        continue;
      }

      // Transfer exists — show a slightly stronger placeholder until the real
      // route (geodesic/road) replaces it on the next async tick.
      const placeholder = addDashed(straightPath, 0.6, 2.5);

      (async () => {
        try {
          if (isFlightTransport(t.transport_type)) {
            if (cancelled) return;
            placeholder.setMap(null);
            addGeodesic(straightPath);
          } else if (isRoadTransport(t.transport_type)) {
            const route = await fetchOsrmRoute(from.latitude, from.longitude, to.latitude, to.longitude, t.transport_type);
            if (cancelled) return;
            placeholder.setMap(null);
            // Fall back to a straight solid line if OSRM didn't return anything
            // — so the user still sees "transfer is set" via a bold line.
            const path = route && route.length > 1
              ? route.map(([lat, lng]) => ({ lat, lng }))
              : straightPath;
            addSolid(path);
          } else {
            // Other transport types (ferry, taxi, walk, other) — no route API
            // available, but the transfer exists, so draw a bold straight line.
            if (cancelled) return;
            placeholder.setMap(null);
            addSolid(straightPath);
          }
        } catch { /* keep placeholder */ }
      })();
    }

    if (ordered.length > 0 && fittedSignatureRef.current !== visitsSignature) {
      const bounds = new gmaps.LatLngBounds();
      ordered.forEach((v) => bounds.extend({ lat: v.latitude, lng: v.longitude }));
      map.fitBounds(bounds, 60);
      const listener = map.addListener('idle', () => {
        if (map.getZoom() > 8) map.setZoom(8);
        listener.remove();
      });
      fittedSignatureRef.current = visitsSignature;
    }

    return () => {
      cancelled = true;
      polylines.forEach((p) => p.setMap(null));
    };
  }, [map, mapsLib, ordered, transfers, visitsSignature]);

  return null;
}

// ---------------- City markers ----------------
function CityMarkers({ ordered, onCityClick }) {
  const onCityClickRef = useRef(onCityClick);
  useEffect(() => { onCityClickRef.current = onCityClick; }, [onCityClick]);

  const groups = useMemo(() => {
    const m = new globalThis.Map();
    ordered.forEach((v, i) => {
      const key = `${v.latitude.toFixed(5)},${v.longitude.toFixed(5)}`;
      if (!m.has(key)) m.set(key, { lat: v.latitude, lon: v.longitude, items: [] });
      m.get(key).items.push({ visit: v, index: i + 1 });
    });
    return Array.from(m.values());
  }, [ordered]);

  return (
    <>
      {groups.map((g) => {
        const numbers = g.items.map((x) => x.index);
        const visitsAtPoint = g.items.map((x) => x.visit);
        const title = g.items
          .map((x) => `${countryFlag(x.visit.country_code)} ${x.visit.city_name}${x.visit.country ? ', ' + x.visit.country : ''}`)
          .join(' • ');
        return (
          <AdvancedMarker
            key={`${g.lat.toFixed(5)},${g.lon.toFixed(5)}`}
            position={{ lat: g.lat, lng: g.lon }}
            title={title}
            onClick={() => {
              const cb = onCityClickRef.current;
              if (cb) cb(visitsAtPoint);
            }}>
            <div
              ref={(el) => {
                if (!el || el.dataset.built === '1') return;
                el.appendChild(markerDom(numbers));
                el.dataset.built = '1';
              }}
            />
          </AdvancedMarker>
        );
      })}
    </>
  );
}

// ---------------- Main MapView ----------------
const MAP_ID = 'horizon-trip-map';

export default function MapView({
  visits,
  transfers,
  visitsById,
  showStartEnd = true,
  colorScheme = 'LIGHT',
  onCityClick,
  children,
}) {
  const [apiKey, setApiKey] = useState(null);
  const [keyError, setKeyError] = useState(null);

  useEffect(() => {
    let alive = true;
    supabase.functions.invoke('getMapsApiKey')
      .then((res) => {
        if (!alive) return;
        const key = res?.data?.apiKey;
        if (key) setApiKey(key);
        else setKeyError(res?.data?.error || res?.error?.message || 'No API key');
      })
      .catch((e) => alive && setKeyError(e.message || 'Failed to load API key'));
    return () => { alive = false; };
  }, []);

  const ordered = useMemo(() => {
    const all = sortVisits(visits).filter(v => v.latitude && v.longitude);
    return showStartEnd ? all : all.filter(v => v.kind !== 'start' && v.kind !== 'end');
  }, [visits, showStartEnd]);

  const visitsSignature = useMemo(() => {
    return ordered.map(v => `${v.id}:${v.latitude.toFixed(5)},${v.longitude.toFixed(5)}`).join('|');
  }, [ordered]);

  // MapView is now a pure map surface — ScreenMap (or any wrapper) supplies
  // chrome (theme toggle, hints, overlays). The map fills its parent
  // container 100% × 100%, so the parent must give it explicit dimensions.
  return (
    <div style={{ width: '100%', height: '100%', position: 'relative' }}>
      {apiKey ? (
        <APIProvider apiKey={apiKey}>
          <GoogleMap
            key={colorScheme}
            mapId={MAP_ID}
            colorScheme={colorScheme}
            defaultCenter={{ lat: 20, lng: 0 }}
            defaultZoom={2}
            gestureHandling="cooperative"
            disableDefaultUI={false}
            clickableIcons={false}
            streetViewControl={false}
            mapTypeControl={false}
            keyboardShortcuts={false}
            fullscreenControl={false}>
            <CityMarkers ordered={ordered} onCityClick={onCityClick} />
            <RoutesLayer ordered={ordered} transfers={transfers} visitsSignature={visitsSignature} />
          </GoogleMap>
        </APIProvider>
      ) : (
        <div style={{ width: '100%', height: '100%', display: 'grid', placeItems: 'center', fontSize: 13, color: 'var(--muted)' }}>
          {keyError ? `Map error: ${keyError}` : <div style={{ width: 24, height: 24, border: '2px solid var(--line)', borderTopColor: 'var(--ink)', borderRadius: '50%', animation: 'spin .7s linear infinite' }} />}
        </div>
      )}
      {children}
    </div>
  );
}