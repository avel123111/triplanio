import React, { useEffect, useRef, useState } from 'react';
import L from 'leaflet';
import { searchCities } from '@/lib/geo';
import { Loader2 } from 'lucide-react';
import { useT } from '@/lib/i18n/I18nContext';

/**
 * Mini map preview for an AI trip draft.
 * Resolves each city's coordinates (best-effort) and shows numbered markers
 * connected by a dashed polyline in trip order.
 */
export default function AiTripMiniMap({ cities = [] }) {
  const t = useT();
  const containerRef = useRef(null);
  const mapRef = useRef(null);
  const [coords, setCoords] = useState([]); // [{ name, lat, lon }]
  const [loading, setLoading] = useState(false);

  // Resolve coordinates whenever the city list changes.
  useEffect(() => {
    let cancelled = false;
    if (!cities.length) { setCoords([]); return; }
    setLoading(true);

    (async () => {
      const out = [];
      for (const c of cities) {
        try {
          const res = await searchCities(`${c.city_name}, ${c.country || ''}`);
          const best = res?.[0];
          if (best?.latitude && best?.longitude) {
            out.push({ name: c.city_name, lat: best.latitude, lon: best.longitude });
          }
        } catch { /* skip */ }
      }
      if (!cancelled) {
        setCoords(out);
        setLoading(false);
      }
    })();

    return () => { cancelled = true; };
  }, [cities]);

  // Init map once.
  useEffect(() => {
    if (!containerRef.current || mapRef.current) return;
    const map = L.map(containerRef.current, {
      scrollWheelZoom: false,
      zoomControl: true,
      attributionControl: false,
    }).setView([20, 0], 2);
    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', { maxZoom: 19 }).addTo(map);
    mapRef.current = map;
    return () => { map.remove(); mapRef.current = null; };
  }, []);

  // Render markers + line on coords change.
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;

    map.eachLayer(layer => { if (!(layer instanceof L.TileLayer)) map.removeLayer(layer); });

    if (coords.length === 0) return;

    coords.forEach((c, i) => {
      const icon = L.divIcon({
        className: '',
        html: `<div style="background:hsl(180 100% 21%);color:white;border-radius:9999px;width:26px;height:26px;display:flex;align-items:center;justify-content:center;font-weight:700;font-size:11px;box-shadow:0 4px 10px rgba(0,0,0,.25);border:2px solid white;">${i + 1}</div>`,
        iconSize: [26, 26],
        iconAnchor: [13, 13],
      });
      L.marker([c.lat, c.lon], { icon }).addTo(map).bindTooltip(c.name);
    });

    if (coords.length > 1) {
      L.polyline(coords.map(c => [c.lat, c.lon]), {
        color: 'hsl(180 100% 21%)', weight: 2.5, opacity: 0.7, dashArray: '6, 8',
      }).addTo(map);
    }

    const bounds = L.latLngBounds(coords.map(c => [c.lat, c.lon]));
    map.fitBounds(bounds, { padding: [24, 24], maxZoom: 7 });
  }, [coords]);

  if (!cities.length) return null;

  return (
    <div className="relative rounded-xl overflow-hidden border h-48">
      <div ref={containerRef} className="w-full h-full" />
      {loading && (
        <div className="absolute top-2 right-2 bg-card/90 backdrop-blur px-2 py-1 rounded-md text-[11px] flex items-center gap-1.5 shadow">
          <Loader2 className="w-3 h-3 animate-spin" />{t('ai_plan.map_loading')}
        </div>
      )}
    </div>
  );
}