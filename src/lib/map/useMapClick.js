// @ts-check
import { useEffect, useRef } from 'react';

/**
 * Клик по ПУСТОЙ карте (родитель обычно снимает выделение). Mapbox шлёт 'click'
 * только на реальный клик по канвасу: перетаскивание эмитит move-события, а
 * HTML-маркеры гасят собственный клик в отдельном DOM-слое (`createMarkerEl`
 * делает `stopPropagation`) — поэтому обработчик не срабатывает ни на пинах, ни
 * на панорамировании. Колбэк держим в ref: свежее замыкание родителя не
 * переподписывает слушатель. Единый шов для `FlowMap` (планировщик) и `MapView`
 * (линза «Маршрут»/редактор), где клик по пустому месту снимает выделение.
 *
 * @param {{ current: any }} mapRef
 * @param {boolean} ready
 * @param {((e:any)=>void)|undefined|null} onMapClick
 */
export function useMapClick(mapRef, ready, onMapClick) {
  const cbRef = useRef(onMapClick);
  useEffect(() => { cbRef.current = onMapClick; }, [onMapClick]);
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !ready) return undefined;
    const handler = (e) => { const cb = cbRef.current; if (cb) cb(e); };
    map.on('click', handler);
    return () => { try { map.off('click', handler); } catch { /* ignore */ } };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ready]);
}

export default useMapClick;
