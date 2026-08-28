// Share-card map helpers (TRIP-193 → TRIP-443).
//
// The share card's map is the LIVE Mapbox map the user composes in the dialog
// (ShareMapPreview). This module owns the shared pieces: building the ordered
// route + legs, drawing the route line + city markers onto a map, and rendering
// the composed map to a PNG for the browser-rasterised card.
//
// TRIP-443: the card map runs on the SAME Mapbox style as every other app
// surface (MAP_STYLE — the trip Map lens / overview). The map includes the
// start/finish cities (showSE) so the whole journey shows — the stats TEXT under
// the title stays transit-only (edge side).
//
// СВОЕГО ОБЛИКА У ЭТОЙ КАРТЫ БОЛЬШЕ НЕТ. Раньше здесь жили собственные маркеры
// (жирная синяя точка в белом ореоле) и собственные, утолщённые веса линий —
// вторая, ни с чем не сверяемая система поверх той, что рисуют все остальные
// карты. Теперь это ровно те же городские Ring-пины (`markers.js`, облик в
// `.tmk*`) с той же нумерацией транзитов, теми же ролевыми глифами и тем же
// зум-зависимым размером, и линии канонных весов (`mapStyle.js`).
//
// Разница остаётся ровно одна, и она вынужденная: HTML-маркер (mapboxgl.Marker)
// — оверлей НАД canvas, снимок WebGL-канваса его не содержит, а карточка снимает
// именно канвас. Поэтому пины здесь — GL-слой с иконкой, которую печёт
// `pinImage.js`, ИЗМЕРЯЯ настоящий `.tmk` (см. разбор там). Цвета берутся под
// СХЕМУ КАРТЫ (её день/ночь), а не под тему приложения: у растра каскада нет.
import { mapboxgl, MAPBOX_TOKEN, MAP_STYLE, baseConfig, loadMapboxGl } from '@/lib/mapbox';
import { drawRouteLinesCached } from '@/lib/map/routeLines';
import { routeColor } from '@/lib/map/mapTokens';
import { cityPoints, groupByLocation, markerZoomSizeExpr, markerSurfaceWeight } from '@/lib/map/markers';
import { pinImageData, PIN_DPR } from '@/lib/map/pinImage';
import { SOLID_WIDTH, DASHED_WIDTH } from '@/lib/map/mapStyle';
import { sortVisits } from '@/lib/validation';
import { transitSpan } from '@/lib/trip-cities';

/**
 * Ordered geo points + route legs for the trip. Свёрнутый вид считает ОБЩЕЕ
 * правило `transitSpan` — то же самое, по которому рисует живая карта: рукописной
 * копии фильтра здесь больше нет (две копии разъехались молча, разбор — там же).
 */
export function buildRoute(visits, transfers, showSE) {
  const all = sortVisits(visits).filter((v) => v.latitude && v.longitude);
  const ordered = showSE ? all : transitSpan(all);
  const byPair = new globalThis.Map();
  (transfers || []).forEach((t) => {
    const k = `${t.from_city_visit_id}__${t.to_city_visit_id}`;
    if (!byPair.has(k)) byPair.set(k, t);
  });
  const legs = [];
  for (let i = 0; i < ordered.length - 1; i++) {
    const from = ordered[i];
    const to = ordered[i + 1];
    legs.push({ from, to, kind: byPair.get(`${from.id}__${to.id}`)?.transport_type });
  }
  return { ordered, legs };
}

const PIN_SOURCE = 'sc-points';
export const PIN_LAYER = 'sc-pins';
export const LINE_IDS = { solid: 'sc-solid', dashed: 'sc-dashed' };

/** Ячейки пина для спота: по одной на визит, в порядке визитов — ровно тот вход,
 *  который живые карты отдают `createMarkerEl` (слепленный пилюль складывается
 *  сам). Отдельно возвращаем координату спота. */
function pinSpots(ordered) {
  return groupByLocation(cityPoints(ordered)).map((g) => ({
    lng: g.lng,
    lat: g.lat,
    cells: g.kinds.map((kind, i) => ({ kind, label: g.labels[i], id: g.ids[i] })),
  }));
}

/** Ключ иконки: спот с тем же составом ролей/номеров, в той же схеме и в том же
 *  разрешении = та же картинка, печь заново нечего. Разрешение — часть ключа: на
 *  другом полотне тот же пин печётся из другого числа пикселей. */
const pinKey = (spot, scheme, dpr) => `sc-pin:${scheme}:${dpr}:${spot.cells.map((c) => `${c.kind || ''}#${c.label ?? ''}`).join('|')}`;

/**
 * Испечь иконки пинов и уложить точки в источник. Асинхронно: иконка ждёт
 * шрифты (номер) и глиф роли, а слой обязан появиться ТОЛЬКО когда картинки уже
 * в атласе — иначе mapbox ругается `Image "…" could not be loaded` и рисует
 * пустоту (та же грабля, что была у прежних бейджей с именами городов).
 */
async function drawPinLayer(map, ordered, scheme, shrink, weight) {
  const spots = pinSpots(ordered);
  // Тяжёлая метка = растянутая иконка: при весе ~2 `icon-size` тянет 58-пиксельный
  // исходник на пин шириной под 60 px, и в расшариваемой картинке это мыло.
  // Печём сразу под нужное число пикселей — логический размер не меняется,
  // пиксели и `pixelRatio` растут вместе.
  const dpr = Math.ceil(PIN_DPR * weight);
  const keys = [];
  for (const spot of spots) {
    const key = pinKey(spot, scheme, dpr);
    keys.push(key);
    if (map.hasImage(key)) continue;
    // Последовательно, а не Promise.all: споты делят кэш глифов, и параллельный
    // запуск печёт одну и ту же картинку по нескольку раз.
    const { data } = await pinImageData(spot.cells, { scheme, dpr });
    if (!map.style) return; // карту снесли, пока пекли
    if (!map.hasImage(key)) map.addImage(key, data, { pixelRatio: dpr });
  }
  const data = {
    type: 'FeatureCollection',
    features: spots.map((spot, i) => ({
      type: 'Feature',
      geometry: { type: 'Point', coordinates: [spot.lng, spot.lat] },
      properties: { pin: keys[i] },
    })),
  };
  if (map.getSource(PIN_SOURCE)) map.getSource(PIN_SOURCE).setData(data);
  else map.addSource(PIN_SOURCE, { type: 'geojson', data });
  if (!map.getLayer(PIN_LAYER)) {
    map.addLayer({
      id: PIN_LAYER,
      type: 'symbol',
      source: PIN_SOURCE,
      layout: {
        'icon-image': ['get', 'pin'],
        'icon-size': markerZoomSizeExpr(shrink, weight),
        'icon-anchor': 'center',
        // Живые карты показывают ВСЕ пины и никогда их не прячут — mapbox по
        // умолчанию скрывает пересекающиеся символы, и на плотном маршруте
        // города молча исчезали бы с карточки.
        'icon-allow-overlap': true,
        'icon-ignore-placement': true,
      },
    });
  }
}

/**
 * Draw the route line + city pins on a map (shared by capture + live preview).
 * Возвращает промис ПИНОВ (иконки пекутся асинхронно) — снимок обязан его
 * дождаться, иначе в PNG уедет карта без городов.
 */
export function drawTripRoute(map, ordered, legs, { scheme, surfaceWidth = 0, shrink = 1 } = {}) {
  // Вес метки — от ширины ФИНАЛЬНОГО полотна (слот карточки), а усадка `shrink`
  // — от того, во сколько раз мельче его калька. Первое отвечает «насколько
  // жирно рисовать», второе — «во сколько раз это уменьшить, чтобы превью
  // осталось превью»; путать их нельзя, поэтому и приезжают они порознь.
  const weight = markerSurfaceWeight(surfaceWidth);
  // Подпись маршрута СЧИТАЕТСЯ ИЗ ПЛЕЧ, а не фиксирована строкой: кэш линий
  // сравнивает именно её и на совпадение НЕ перерисовывает. С постоянной
  // подписью живое превью карточки не могло сменить состав маршрута — точки
  // обновлялись (`setData`), а линии оставались от прошлого набора.
  const sig = `sc-route:${legs.map((l) => `${l.from?.id}>${l.to?.id}:${l.kind || ''}`).join('|')}`;
  const color = routeColor(scheme);
  drawRouteLinesCached(map, sig, legs, {
    dashedId: LINE_IDS.dashed, solidId: LINE_IDS.solid,
    solidColor: color, dashedColor: color,
    solidWidth: SOLID_WIDTH * weight * shrink, dashedWidth: DASHED_WIDTH * weight * shrink,
    // Карточка — законченная картинка, а не план: дыру «переезд не заведён» ей
    // предупреждать не перед кем, и приглушённый пунктир читался бы на ней
    // дефектом печати. Маршрут рисуется целым (см. `legLook` в mapStyle.js).
    markGaps: false,
  });
  // Кэш линий сравнивает ГЕОМЕТРИЮ (подпись плеч) и на совпадении не
  // перерисовывает вообще ничего — а цвет зависит от СХЕМЫ КАРТЫ, которая
  // меняется без единого движения маршрута. Поэтому цвет доводим отдельно, на
  // каждом заходе: иначе тумблер «день/ночь» красил бы подложку, оставляя
  // маршрут в цвете прежней темы (ровно этот дефект и чинится).
  [LINE_IDS.solid, LINE_IDS.dashed].forEach((id) => {
    try { if (map.getLayer(id)) map.setPaintProperty(id, 'line-color', color); } catch { /* слоя нет */ }
  });
  return drawPinLayer(map, ordered, scheme, shrink, weight).catch((e) => { console.error('card pins failed', e); });
}

// ---- browser-side card rendering (TRIP-193 Ф2) ------------------------------
// The final card is rasterised in the browser now (no edge resvg -> no HTTP 546,
// no 600px map cap). Two pieces live here: render the composed route map at the
// card's real resolution, and turn the card SVG (with that map baked in) into a
// PNG blob.

/**
 * Перенос зума композиции между поверхностями РАЗНОЙ ширины — единственный дом
 * формулы (читают capture ниже и живой ShareMapPreview): зум mapbox мерит мир в
 * пикселях, та же геосцена на вдвое широкой поверхности = +1 зум. Неизвестная
 * ширина с любой стороны → зум не пересчитывается (сдвиг 0), NaN невозможен.
 */
export const rescaleZoom = (zoom, fromW, toW) =>
  zoom + Math.log2((toW || fromW || 1) / (fromW || toW || 1));

/**
 * Render the trip route map to a PNG blob at `width`x`height`, reproducing the
 * camera the user composed in the preview. A throwaway offscreen map is used so
 * we can render at the card's real resolution instead of the tiny on-screen
 * preview - this is what makes the map sharp. Zoom is compensated for the larger
 * pixel size (`+log2(width/previewCssWidth)`) so the FRAMING matches the preview.
 * Resolves null if the map can't be produced (caller surfaces an error).
 */
export async function renderCardMapPng({
  visits, transfers, showSE = true,
  center, zoom, bearing = 0, pitch = 0, projection = 'mercator', scheme = 'DARK',
  previewCssWidth, width, height,
}) {
  if (!MAPBOX_TOKEN || !center || !width || !height) return null;
  // Библиотека карты грузится ПО ТРЕБОВАНИЮ (TRIP-445), поэтому ждём её здесь, а
  // не рассчитываем, что её уже загрузил экран с картой: карточку собирают и с
  // линзы, где карты не было, — тогда не приехал бы и `mapbox-gl.css`.
  try { await loadMapboxGl(); } catch { return null; }
  return new Promise((resolve) => {
    const { ordered, legs } = buildRoute(visits, transfers, showSE);
    if (!ordered.length) { resolve(null); return; }

    const holder = document.createElement('div');
    holder.style.cssText = `position:absolute;left:-99999px;top:0;width:${width}px;height:${height}px;`;
    document.body.appendChild(holder);

    const zoomAdj = rescaleZoom(zoom, previewCssWidth, width);
    const map = new mapboxgl.Map({
      container: holder,
      style: MAP_STYLE,
      config: baseConfig(scheme),
      // Токен СВОЕЙ опцией: раньше он прилетал сюда побочным эффектом импорта
      // `@/lib/mapbox` (глобальный `mapboxgl.accessToken`). Библиотека грузится
      // по требованию (TRIP-445), порядок загрузки больше не гарантирован —
      // поэтому каждый, кто создаёт карту, называет токен сам.
      ...(MAPBOX_TOKEN ? { accessToken: MAPBOX_TOKEN } : {}),
      center,
      zoom: zoomAdj,
      bearing,
      pitch,
      projection,
      interactive: false,
      attributionControl: false,
      preserveDrawingBuffer: true, // canvas must be readable for the snapshot
      fadeDuration: 0,
    });

    let settled = false;
    let drew = false;
    let pinsDone = false;
    let safety;
    const cleanup = () => { try { map.remove(); } catch { /* already gone */ } holder.remove(); };
    const snapshot = () => {
      if (settled) return;
      settled = true;
      clearTimeout(safety);
      map.off('idle', onIdle);
      try {
        const src = map.getCanvas();
        const out = document.createElement('canvas');
        out.width = width;
        out.height = height;
        out.getContext('2d').drawImage(src, 0, 0, width, height);
        out.toBlob((b) => { cleanup(); resolve(b); }, 'image/png');
      } catch (e) { console.error('card map render failed', e); cleanup(); resolve(null); }
    };
    // On the Standard style 'load' can precede style readiness, so addLayer would
    // silently no-op and the snapshot would miss the route (same trap the live
    // preview hit). Draw on 'idle' once the style is ready — и снимаем ТОЛЬКО
    // после того, как испеклись иконки пинов: они ждут шрифт номера и глиф роли,
    // и снимок «по первому idle» уехал бы картой без городов.
    const tryDraw = () => {
      if (drew || !map.isStyleLoaded()) return;
      try {
        // Резолв промиса пинов сам по себе кадра не рисует — просим перерисовку,
        // чтобы idle пришёл ещё раз уже с пинами на канвасе.
        drawTripRoute(map, ordered, legs, { scheme, surfaceWidth: width })
          .then(() => { pinsDone = true; try { map.triggerRepaint(); } catch { /* карты уже нет */ } });
        drew = true;
      } catch { /* retry next idle */ }
    };
    const onIdle = () => { if (!drew) tryDraw(); else if (pinsDone) snapshot(); };
    map.once('load', tryDraw);
    map.on('idle', onIdle);
    // Safety net: never hang the "build card" button if 'idle' never settles.
    safety = setTimeout(snapshot, 8000);
  });
}

/** Read a Blob as a data URI (to inline the map into the card SVG). */
export function blobToDataUri(blob) {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(r.result);
    r.onerror = reject;
    r.readAsDataURL(blob);
  });
}

/**
 * Rasterise a self-contained card SVG string (fonts + images all data URIs) to a
 * PNG blob at `width`x`height`. Fonts are awaited first so the SVG paints with the
 * embedded faces, not a fallback. Everything inside the SVG is a data URI, so the
 * canvas is not tainted and toBlob() succeeds.
 */
export async function rasterizeSvgToPng(svg, width, height) {
  if (document?.fonts?.ready) { try { await document.fonts.ready; } catch { /* ignore */ } }
  const url = URL.createObjectURL(new Blob([svg], { type: 'image/svg+xml;charset=utf-8' }));
  try {
    const img = await new Promise((resolve, reject) => {
      const im = new Image();
      im.onload = () => resolve(im);
      im.onerror = () => reject(new Error('svg image load failed'));
      im.src = url;
    });
    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    canvas.getContext('2d').drawImage(img, 0, 0, width, height);
    return await new Promise((resolve, reject) => {
      canvas.toBlob((b) => (b ? resolve(b) : reject(new Error('toBlob returned null'))), 'image/png');
    });
  } finally {
    URL.revokeObjectURL(url);
  }
}
