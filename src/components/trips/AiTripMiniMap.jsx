import React, { useEffect, useRef, useState } from 'react';
import { mapboxgl, MAPBOX_TOKEN, MAP_STYLE, baseConfig, fitToPoints, lineFeature, setLineLayer } from '@/lib/mapbox';
import { searchCities } from '@/lib/geo';
import { Loader2 } from 'lucide-react';
import { useT } from '@/lib/i18n/I18nContext';

const PIN = 'hsl(180 100% 21%)';

function pinEl(n) {
  const el = document.createElement('div');
  el.style.cssText = `background:${PIN};color:white;border-radius:9999px;width:26px;height:26px;display:flex;align-items:center;justify-content:center;font-weight:700;font-size:11px;box-shadow:0 4px 10px rgba(0,0,0,.25);border:2px solid white;`;
  el.textContent = String(n);
  return el;
}

/**
 * Mini map preview for an AI trip draft. Resolves each city's coordinates
 * (best-effort) and shows numbered markers connected by a dashed line.
 */
export default function AiTripMiniMap({ cities = [] }) {
  const t = useT();
  const containerRef = useRef(null);
  const mapRef = useRef(null);
  const markersRef = useRef([]);
  const readyRef = useRef(false);
  const [coords, setCoords] = useState([]); // [{ name, lat, lon }]
  const [loading, setLoading] = useState(false);

  // Resolve coordinates whenever the city list changes.
  useEffect(() => {
    let cancelled = false;
    if (!cities.length) { setCoords([]); return undefined; }
    setLoading(true);
    (async () => {
      const out = [];
      for (const c of cities) {
        try {
          const res = await searchCities(`${c.city_name}, ${c.country || ''}`);
          const best = res?.[0];
          if (best?.latitude && best?.longitude) out.push({ name: c.city_name, lat: best.latitude, lon: best.longitude });
        } catch { /* skip */ }
      }
      if (!cancelled) { setCoords(out); setLoading(false); }
    })();
    return () => { cancelled = true; };
  }, [cities]);

  // Init map once.
  useEffect(() => {
    if (!containerRef.current || mapRef.current || !MAPBOX_TOKEN) return undefined;
    const dark = typeof document !== 'undefined' && document.documentElement.dataset.theme === 'dark';
    const map = new mapboxgl.Map({
      container: containerRef.current,
      style: MAP_STYLE,
      config: baseConfig(dark ? 'DARK' : 'LIGHT'),
      center: [0, 20],
      zoom: 1.5,
      projection: 'mercator',
      attributionControl: false,
      interactive: true,
    });
    mapRef.current = map;
    map.on('load', () => { readyRef.current = true; });
    return () => { map.remove(); mapRef.current = null; readyRef.current = false; };
  }, []);

  // Render markers + line on coords change.
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return undefined;
    const draw = () => {
      markersRef.current.forEach((m) => m.remove());
      markersRef.current = [];
      if (coords.length === 0) {
        if (map.getSource('mini-line')) setLineLayer(map, 'mini-line', [], { color: PIN, width: 2.5, dashed: true, opacity: 0.7 });
        return;
      }
      coords.forEach((c, i) => {
        const marker = new mapboxgl.Marker({ element: pinEl(i + 1) }).setLngLat([c.lon, c.lat]).addTo(map);
        marker.getElement().title = c.name;
        markersRef.current.push(marker);
      });
      const lineFeatures = coords.length > 1 ? [lineFeature(coords.map((c) => [c.lon, c.lat]))] : [];
      setLineLayer(map, 'mini-line', lineFeatures, { color: PIN, width: 2.5, dashed: true, opacity: 0.7 });
      fitToPoints(map, coords.map((c) => [c.lon, c.lat]), { padding: 24, maxZoom: 7 });
    };
    if (readyRef.current) draw(); else map.once('load', draw);
    return undefined;
  }, [coords]);

  if (!cities.length) return null;

  return (
    <div className="relative rounded-xl overflow-hidden border h-48">
      <div ref={containerRef} className="w-full h-full" />
      {loading && (
        <div className="absolute top-2 right-2 bg-card/90 backdrop-blur px-2 py-1 rounded-md text-[11px] flex items-center gap-1.5 shadow z-10">
          <Loader2 className="w-3 h-3 animate-spin" />{t('ai_plan.map_loading')}
        </div>
      )}
    </div>
  );
}
