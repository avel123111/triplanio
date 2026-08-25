// @ts-check
import { useEffect, useRef } from 'react';
import { mapboxgl } from '@/lib/mapbox';
import { createCityBadgeEl } from './markers';

/**
 * Стеклянная плашка «флаг + город + даты» у активного города (линза «Маршрут»/
 * редактор и планировщик). Несётся `mapboxgl.Popup` без фиксированного `anchor`,
 * поэтому mapbox сам разворачивает её той стороной, что держит на экране (город у
 * края открывает внутрь). Эффект был построчной копией в `MapView` и `FlowMap` —
 * теперь один шов на обоих.
 *
 * `cityBadge` — `{ lng, lat, countryCode, name, dates } | null`. `null` (и режим
 * hotel-pick у редактора через `enabled=false`) снимает плашку.
 *
 * @param {{ current: any }} mapRef
 * @param {boolean} ready
 * @param {any} cityBadge
 * @param {{ enabled?: boolean }} [opts]
 */
export function useCityBadge(mapRef, ready, cityBadge, { enabled = true } = {}) {
  const popupRef = useRef(/** @type {any} */ (null));
  useEffect(() => {
    const map = mapRef.current;
    if (popupRef.current) { popupRef.current.remove(); popupRef.current = null; }
    if (!map || !ready || !enabled || !cityBadge || cityBadge.lng == null || cityBadge.lat == null) return undefined;
    const el = createCityBadgeEl({ countryCode: cityBadge.countryCode, name: cityBadge.name, dates: cityBadge.dates });
    popupRef.current = new mapboxgl.Popup({
      closeButton: false, closeOnClick: false, focusAfterOpen: false,
      className: 'cbadge-popup', offset: 16, maxWidth: 'none',
    })
      .setLngLat([cityBadge.lng, cityBadge.lat])
      .setDOMContent(el)
      .addTo(map);
    return () => { if (popupRef.current) { popupRef.current.remove(); popupRef.current = null; } };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ready, enabled, cityBadge?.lng, cityBadge?.lat, cityBadge?.name, cityBadge?.dates, cityBadge?.countryCode]);
}

export default useCityBadge;
