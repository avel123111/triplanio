// @ts-check
import { useEffect, useRef } from 'react';
import { mapboxgl } from '@/lib/mapbox';
import { groupByLocation, createMarkerEl, iconForKinds } from './markers';

/**
 * Городские пины трипа — ЕДИНАЯ сборка для линзы «Маршрут»/редактора (`MapView`)
 * и планировщика (`FlowMap`). До этого оба гоняли построчно совпадающие эффекты:
 * `groupByLocation` → `createMarkerEl` → тег id → `addTo`, плюс отдельный тогл
 * `.is-sel/.is-hover`. Здесь это один шов; экраны различаются лишь ИСТОЧНИКОМ
 * данных, который они нормализуют в `points` ДО хука (нумерация транзитов, выбор
 * иконки — это их дело), и формой колбэков (что вынуть из группы).
 *
 * Хук владеет ДВУМЯ вещами и только ими:
 *   1. build — пересобрать маркеры при смене `rebuildKey` (сигнатура точек);
 *   2. toggle — повесить `.is-sel/.is-hover` на СУЩЕСТВУЮЩИЕ элементы при смене
 *      выделения/ховера, БЕЗ пересборки (ховер списка дёшев).
 * Кадрирование камеры и reveal НЕ здесь: они у экранов разные (у `MapView` —
 * фокус/reveal/hotel, у `FlowMap` — пустой глобус), и общий шов их бы только
 * запутал. `MapView` домешивает reveal-видимость через `onAfterBuild`.
 *
 * points: [{ id, lng, lat, label, kind, data }] — уже нормализованы экраном.
 *   label — текст пина (или null под иконку), kind — роль (start/end/…),
 *   id — стабильный ключ (тегается в `data-mids`), data — что уедет в колбэки.
 *
 * @param {{ current: any }} mapRef
 * @param {boolean} ready
 * @param {{
 *   points: any[],
 *   markersRef: { current: any[] },
 *   rebuildKey: string,
 *   onClick?: ((group:any)=>void)|null,
 *   onHover?: ((entering:boolean, group:any)=>void)|null,
 *   selectedId?: any,
 *   hoveredId?: any,
 *   enabled?: boolean,
 *   onAfterBuild?: ((markers:any[])=>void)|null,
 * }} p
 */
export function useCityMarkers(mapRef, ready, {
  points,
  markersRef,
  rebuildKey,
  onClick = null,
  onHover = null,
  selectedId = null,
  hoveredId = null,
  enabled = true,
  onAfterBuild = null,
}) {
  // Колбэки и точки — в рефах: свежее замыкание родителя не должно
  // пересобирать маркеры (перестройка идёт СТРОГО по `rebuildKey`).
  const clickRef = useRef(onClick);
  const hoverRef = useRef(onHover);
  const afterRef = useRef(onAfterBuild);
  const pointsRef = useRef(points);
  useEffect(() => { clickRef.current = onClick; }, [onClick]);
  useEffect(() => { hoverRef.current = onHover; }, [onHover]);
  useEffect(() => { afterRef.current = onAfterBuild; }, [onAfterBuild]);
  pointsRef.current = points;

  // Build / rebuild. Старые снимаем в начале прогона; на размонтировании их
  // снимает `useMapSurface` (владелец жизненного цикла инстанса).
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !ready) return undefined;
    markersRef.current.forEach((m) => m.remove());
    markersRef.current = [];
    if (!enabled) return undefined;
    groupByLocation(pointsRef.current).forEach((g) => {
      const el = createMarkerEl(g.labels.filter((l) => l != null), {
        icon: iconForKinds(g.kinds),
        onClick: clickRef.current ? () => { const cb = clickRef.current; if (cb) cb(g); } : undefined,
        onHover: hoverRef.current ? (entering) => { const cb = hoverRef.current; if (cb) cb(entering, g); } : undefined,
      });
      // ОДНО имя атрибута на обе карты (`data-mids`) — тогл выделения читает его.
      el.dataset.mids = g.ids.filter(Boolean).join(',');
      markersRef.current.push(new mapboxgl.Marker({ element: el }).setLngLat([g.lng, g.lat]).addTo(map));
    });
    if (afterRef.current) afterRef.current(markersRef.current);
    return undefined;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ready, enabled, rebuildKey]);

  // Выделение + ховер — тоглом на готовых элементах (без пересборки). Гоняется и
  // после rebuild (в deps `rebuildKey`), чтобы состояние пережило перерисовку.
  useEffect(() => {
    if (!ready) return;
    const sel = selectedId != null ? String(selectedId) : null;
    const hov = hoveredId != null ? String(hoveredId) : null;
    markersRef.current.forEach((m) => {
      const el = m.getElement();
      const ids = (el.dataset.mids || '').split(',').filter(Boolean);
      const isSel = sel != null && ids.includes(sel);
      el.classList.toggle('is-sel', isSel);
      el.classList.toggle('is-hover', !isSel && hov != null && ids.includes(hov));
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ready, selectedId, hoveredId, rebuildKey]);
}

export default useCityMarkers;
