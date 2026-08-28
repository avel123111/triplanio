// Shared adaptive "calm" camera for every NON-public map (editor / stats / overview
// / planner / create + the hotel-overlay clustering). ONE tempo, reused everywhere
// so behaviour can't drift between surfaces.
//
// Why adaptive: a fixed duration makes a 1-level nudge and a 9-level decluster take
// the SAME time → the big jump feels fast. Here the duration scales with how far the
// camera travels (|Δzoom| dominates, plus a little for long center pans), so a
// multi-level decluster or a large zoom change glides over a longer, even animation
// while a small hop stays snappy. The public shared-trip reader runs its own reveal
// mechanics (revealActiveId) and deliberately does NOT use these.
//
// Pairs with ./cluster.js — together they are the reusable clustering + zoom-behaviour
// core for any future map surface. The pure duration math lives in ./calmDuration.js
// (dependency-free → unit-testable).
import { fitToPoints, cameraForPoints } from '@/lib/mapbox';
import { calmDuration } from '@/lib/map/calmDuration';
import { getMapInsets, offsetFor } from '@/lib/map/insets';

export { calmDuration };

// How far (in screenfuls) the center would move to `center` ([lng,lat]).
function centerScreens(map, center) {
  if (!center) return 0;
  try {
    const a = map.project(map.getCenter());
    const b = map.project({ lng: center[0], lat: center[1] });
    const px = Math.hypot(b.x - a.x, b.y - a.y);
    const el = map.getContainer();
    const span = Math.max(el?.clientWidth || 0, el?.clientHeight || 0) || 1;
    return px / span;
  } catch { return 0; }
}

// flyTo with an adaptive calm duration. target: { center?: [lng,lat], zoom?: number }.
export function calmFlyTo(map, target = {}) {
  if (!map) return;
  const toZoom = target.zoom != null ? target.zoom : map.getZoom();
  const duration = calmDuration({ dZoom: toZoom - map.getZoom(), screens: centerScreens(map, target.center) });
  // Сдвиг передаётся ЯВНО, хотя `flyTo` без него и сохранил бы текущий: тогда
  // правильность наводки на один город зависела бы от того, кто ходил камерой
  // ДО этого. Здесь цель — «город по центру свободного окна», и она обязана
  // выполняться сама по себе, а не по последствиям предыдущего вызова.
  // Именно СДВИГ, а не `padding`: отступ ломает рендер глобуса (`map/insets.js`).
  map.flyTo({ ...target, offset: offsetFor(getMapInsets(map)), duration, essential: true });
}

// Fit a set of [lng,lat] points with an adaptive calm duration. The target zoom is
// derived from `cameraForPoints` so the duration matches the ACTUAL zoom delta, then
// the same `fitToPoints` does the fit (single source for the fit mechanics).
export function calmFit(map, points, opts = {}) {
  if (!map || !points || points.length === 0) return;
  // Куда камера поедет — считает та же функция, что и сам фит: темп обязан
  // меряться по ФАКТИЧЕСКОЙ дельте зума, а не по её оценке. Отступ (воздух плюс
  // закрытая площадь) она берёт сама — см. `lib/map/insets.js`.
  const cam = cameraForPoints(map, points, opts);
  const toZoom = cam?.zoom ?? map.getZoom();
  const duration = calmDuration({ dZoom: toZoom - map.getZoom(), screens: centerScreens(map, cam?.center ?? null) });
  fitToPoints(map, points, { ...opts, duration });
}
