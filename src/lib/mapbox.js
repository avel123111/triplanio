// Shared Mapbox GL setup - single source of truth for token + styles so the
// trip Map lens, the planner previews and the mini-map all render consistently.
// Note: Mapbox uses [lng, lat] order (GeoJSON), the opposite of Leaflet/Google.
import mapboxgl from 'mapbox-gl';
// Путь ОТНОСИТЕЛЬНЫЙ, а не через `@/`: алиас знает только Vite, и с ним модуль
// не импортируется в `node --test`. Та же конвенция, по которой чистым держат
// `trip-cities.js` — узел, у которого есть тест, не имеет права зависеть от
// сборщика.
import { MIN_FREE_WINDOW, addBox, getMapInsets, toBox } from './map/insets.js';

// `?.` — не перестраховка: без него модуль нельзя ИМПОРТИРОВАТЬ вне Vite, а
// значит нельзя и покрыть тестами (`node --test` про `import.meta.env` не
// знает). Кадрирование ниже — самое дорогое правило этого файла, и оно обязано
// судиться тестом, а не чтением.
export const MAPBOX_TOKEN = import.meta.env?.VITE_MAPBOX_TOKEN;
if (MAPBOX_TOKEN) mapboxgl.accessToken = MAPBOX_TOKEN;

// One Mapbox Standard style for every map surface. Light/dark is the
// `lightPreset` config (day/night), switched in place - the map is NOT
// re-created on theme change. `theme: 'default'`.
export const MAP_STYLE = 'mapbox://styles/avel1231/cmqogtezo001s01qzal5699es';
// Dedicated Standard-based style for the share card map only (TRIP-193). Same
// `lightPreset` day/night config as MAP_STYLE, so the card's light/dark toggle
// keeps working; the in-app map surfaces stay on MAP_STYLE.
export const SHARE_MAP_STYLE = 'mapbox://styles/avel1231/cmr9qqc7u001801r1923v90fn';
export const lightPresetFor = (scheme) => (scheme === 'DARK' ? 'night' : 'day');

// Initial style config - passed to `new mapboxgl.Map({ config })` to avoid a flash.
// `theme` is the Standard basemap theme: 'default' (colour) everywhere, except the
// Trips home + "My statistics" maps which pass 'monochrome' (grey). Switching it is
// an in-place setConfigProperty (same as lightPreset) — NOT setStyle — so the single
// session instance is preserved (tiles/sources/markers/lines stay).
// NOTE: label language is NOT a basemap config property — it is the top-level Map
// option `language` set at construction in MapProvider (see ensureMap).
export const baseConfig = (scheme, theme = 'default') => ({ basemap: { theme, lightPreset: lightPresetFor(scheme) } });

// Apply/refresh basemap config after the style is ready (for live theme toggling).
export function applyBasemapConfig(map, scheme, theme = 'default') {
  if (!map) return;
  const set = () => {
    try {
      map.setConfigProperty('basemap', 'theme', theme);
      map.setConfigProperty('basemap', 'lightPreset', lightPresetFor(scheme));
    } catch { /* style/config not ready */ }
  };
  if (map.isStyleLoaded()) set(); else map.once('style.load', set);
}

// Clamp a numeric bounds-fit padding to the map's current canvas so a fit is always
// geometrically possible. Mapbox's cameraForBounds (used by fitBounds AND directly)
// emits warnOnce("Map cannot fit within canvas with the given bounds, padding, and/or
// offset.") and silently refuses the fit whenever the padding meets/exceeds the canvas
// on either axis. The `canFit` gate (useMapSurface) already blocks a ZERO-size slot;
// this closes the SMALL-but-nonzero slot (a mini-map, a short lens) where e.g.
// padding 110 needs a >220px axis. On a normal-size canvas the clamp is a no-op, so
// the common path is unchanged — it only ever shrinks padding that literally cannot
// fit, making the illegal camera command unrepresentable rather than papering over it.
/** Полоса канваса, которую отступ не имеет права съесть (px). Тот же закон, что
 *  у `canFrame`, поэтому и число ОДНО — берётся оттуда, а не пишется заново. */
const MIN_FIT_BOX = MIN_FREE_WINDOW;

export function clampPadding(map, padding = 0) {
  const box = toBox(padding);
  let W = 0, H = 0;
  try {
    const el = map && map.getContainer();
    W = el?.clientWidth || 0; H = el?.clientHeight || 0;
  } catch { return box; }
  if (!(W > 0) || !(H > 0)) return box; // unmeasured — the canFit gate should have prevented this
  // Один закон по каждой оси отдельно: сумма противоположных сторон обязана
  // оставить полосу канваса. Асимметричный отступ здесь не экзотика, а основной
  // случай — именно им выражается площадь, закрытая панелью или шитом.
  const axis = (a, b, size) => {
    const room = Math.max(0, size - MIN_FIT_BOX);
    const sum = a + b;
    if (sum <= room) return [a, b];
    const k = sum > 0 ? room / sum : 0;
    return [Math.floor(a * k), Math.floor(b * k)];
  };
  const [left, right] = axis(box.left, box.right, W);
  const [top, bottom] = axis(box.top, box.bottom, H);
  return { top, right, bottom, left };
}

/**
 * ОТСТУП ФИТА для этой карты: воздух кадра ПЛЮС объявленная закрытая площадь.
 * Единственное место, где эти два слагаемых встречаются, — поэтому забыть одно
 * из них у вызывателя нельзя по построению.
 */
export function fitPadding(map, air = 0) {
  return clampPadding(map, addBox(toBox(air), getMapInsets(map)));
}

/**
 * Куда встанет камера, чтобы вписать точки. `null`, если вписать нельзя.
 * Вынесено отдельно, потому что ответ нужен ДВАЖДЫ: для самого кадрирования и
 * для расчёта темпа анимации (`calmFit` меряет по фактической дельте зума).
 */
export function cameraForPoints(map, points, opts = {}) {
  if (!map || !points || points.length === 0) return null;
  const maxZoom = opts.maxZoom ?? 8;
  // Одиночная точка: `singleZoom` НЕ ограничивается `maxZoom` — они про разное.
  // `maxZoom` — потолок для ВПИСЫВАНИЯ набора (не наезжать слишком близко на
  // компактный маршрут), а одиночная точка вписывать нечего, у неё свой зум
  // (планировщик просит 8 при потолке 7 — и это не опечатка).
  if (points.length === 1) return { center: points[0], zoom: opts.singleZoom ?? 7 };
  try {
    const b = new mapboxgl.LngLatBounds();
    points.forEach((p) => b.extend(p));
    const cam = map.cameraForBounds(b, { padding: fitPadding(map, opts.padding ?? 48), maxZoom });
    if (!cam || typeof cam.zoom !== 'number') return null;
    return { center: [cam.center.lng, cam.center.lat], zoom: Math.min(cam.zoom, maxZoom) };
  } catch { return null; }
}

// ═══════════════════════════════════════════════════════════════════════════
// КАДРИРОВАНИЕ — ОДНА ДВЕРЬ (TRIP-422)
//
// ★ `map.fitBounds()` ЗДЕСЬ БОЛЬШЕ НЕ ИСПОЛЬЗУЕТСЯ, И ЭТО НЕ ПРИДИРКА. Проверено
// по исходнику mapbox-gl 3.24 (`Camera._fitInternal`): он берёт отступ, которым
// СЧИТАЛ кадр, и кладёт его же в анимацию — то есть в `transform.padding`, в
// постоянное состояние карты. Отступ фита включает ВОЗДУХ вокруг маршрута,
// отступ поверхности — нет. Значит каждый `fitBounds` молча сдвигает состояние
// карты на величину воздуха, и дальше по этому испорченному значению
// центрируется всё, что рисуется без фита. Дефект невидим глазом (при
// симметричном воздухе сдвиг центра сокращается) и не ловится ничем.
//
// Поэтому кадрируем в два явных шага: `cameraForPoints` считает center+zoom по
// отступу ФИТА, а перелёт получает отступ ПОВЕРХНОСТИ. Разбор обоих — в
// `lib/map/insets.js`.
//
// `opts.padding` — ВОЗДУХ вокруг маршрута (число или коробка). Закрытую площадь
// сюда передавать не нужно и НЕЛЬЗЯ: её карта знает сама.
// ═══════════════════════════════════════════════════════════════════════════
export function fitToPoints(map, points, opts = {}) {
  if (!map || !points || points.length === 0) return;
  const duration = opts.duration ?? (opts.animate ? 650 : 0);
  const cam = cameraForPoints(map, points, opts);
  if (!cam) return;
  const move = {
    center: cam.center,
    zoom: cam.zoom,
    duration,
    // Отступ ПОВЕРХНОСТИ — только закрытая площадь. mapbox интерполирует его
    // сам, поэтому смена отступа едет тем же перелётом, что и сама камера.
    padding: getMapInsets(map),
    ...(opts.easing ? { easing: opts.easing } : null),
  };
  // Одиночная точка — всегда ровный наезд: дуга `flyTo` на месте выглядит как
  // рывок. `opts.offset` остаётся ради вызывателей, которые уводят точку из-под
  // своего оверлея вручную.
  if (points.length === 1 || opts.linear) {
    map.easeTo({ ...move, offset: opts.offset ?? [0, 0] });
    return;
  }
  map.flyTo({ ...move, essential: true });
}

// GeoJSON LineString feature from [[lng,lat], ...].
export const lineFeature = (coords) => ({
  type: 'Feature',
  geometry: { type: 'LineString', coordinates: coords },
  properties: {},
});

// Idempotently create a line source+layer, then push features into it.
export function setLineLayer(map, id, features, { color, width, dashed = false, opacity }) {
  const data = { type: 'FeatureCollection', features };
  if (!map.getSource(id)) {
    map.addSource(id, { type: 'geojson', data });
    map.addLayer({
      id,
      type: 'line',
      source: id,
      layout: { 'line-cap': 'round', 'line-join': 'round' },
      paint: {
        'line-color': color,
        'line-width': width,
        'line-opacity': opacity ?? (dashed ? 0.5 : 1),
        // Mapbox Standard lights layers by the scene; without full emissive
        // strength custom lines render dark/black under the `night` preset.
        // Keeping it at 1 makes the line show its true colour in both themes.
        'line-emissive-strength': 1,
        ...(dashed ? { 'line-dasharray': [2, 2] } : {}),
      },
    });
  } else {
    map.getSource(id).setData(data);
  }
}

export { mapboxgl };
