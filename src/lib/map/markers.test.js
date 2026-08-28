// @ts-check
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { groupByLocation, markerZoomScale, markerZoomSizeExpr, markerSurfaceWeight, cityPoints, MARKER_REF_WIDTH, MARKER_ZOOM_SCALE } from './markers.js';
import { isMapAlive } from './alive.js';

// groupByLocation теперь несёт `ids` — единый источник для `data-mids`, которым
// `useCityMarkers` адресует пин при тогле выделения на ОБЕИХ картах. Раньше id
// вынимался по-разному в MapView (`data-vids` из visit.id) и FlowMap (`data-mid`
// из сырого id); тест пинит, что группировка собирает их в одном поле.
test('groupByLocation: собирает ids вместе с labels/kinds/data', () => {
  const [g] = groupByLocation([
    { id: 'a', lng: 10, lat: 20, label: '1', kind: 'transit', data: { id: 'a' } },
  ]);
  assert.deepEqual(g.ids, ['a']);
  assert.deepEqual(g.labels, ['1']);
  assert.deepEqual(g.kinds, ['transit']);
  assert.equal(g.data.length, 1);
});

test('groupByLocation: совпадающие координаты схлопываются в один пин со всеми ids', () => {
  const groups = groupByLocation([
    { id: 'a', lng: 10, lat: 20, label: '1', kind: 'transit' },
    { id: 'b', lng: 10, lat: 20, label: '2', kind: 'transit' }, // тот же спот
    { id: 'c', lng: 30, lat: 40, label: '3', kind: 'transit' },
  ]);
  assert.equal(groups.length, 2);
  const shared = groups.find((g) => g.ids.length === 2);
  assert.deepEqual(shared.ids, ['a', 'b']);
  assert.deepEqual(shared.labels, ['1', '2']);
});

test('groupByLocation: точки без координат отбрасываются; id может отсутствовать', () => {
  const groups = groupByLocation([
    { id: undefined, lng: 1, lat: 2, label: null }, // без id (как у stats-карты)
    { id: 'x', lng: null, lat: 2, label: '1' },      // без lng — выкидывается
    null,                                            // мусор
  ]);
  assert.equal(groups.length, 1);
  assert.deepEqual(groups[0].ids, [undefined]);
});

// isMapAlive: предикат «по карте безопасно читать слои» — жив ли style.
test('isMapAlive: истинно только при живом style', () => {
  assert.equal(isMapAlive(null), false);
  assert.equal(isMapAlive(undefined), false);
  assert.equal(isMapAlive({}), false);            // ссылка жива, style снесён
  assert.equal(isMapAlive({ style: null }), false);
  assert.equal(isMapAlive({ style: {} }), true);
});

// ── размер пина по зуму + нумерация городов (TRIP-443) ───────────────────────
// Правило размера читают ДВЕ разные машины: живые карты кладут число в CSS-
// переменную `--mk-scale`, а карта share-карточки — в `icon-size` GL-слоя своих
// растровых пинов. Пока чисел два, разъехаться они могут молча: обе поверхности
// продолжат рисовать пины, просто разного размера, и заметить это можно только
// положив карточку рядом с приложением. Тест держит их на одном источнике.

test('markerZoomScale: MIN на мелком зуме, MAX на детальном, линейно между', () => {
  const { MIN, MAX, Z_LO, Z_HI } = MARKER_ZOOM_SCALE;
  assert.equal(markerZoomScale(0), MIN);        // и ниже Z_LO — та же полка
  assert.equal(markerZoomScale(Z_LO), MIN);
  assert.equal(markerZoomScale(Z_HI), MAX);
  assert.equal(markerZoomScale(22), MAX);       // и выше Z_HI — та же полка
  assert.equal(markerZoomScale((Z_LO + Z_HI) / 2), (MIN + MAX) / 2);
});

test('markerZoomSizeExpr: выражение mapbox повторяет ту же кривую в тех же стопах', () => {
  const { Z_LO, Z_HI } = MARKER_ZOOM_SCALE;
  const [op, interp, zoom, zLo, aLo, zHi, aHi] = markerZoomSizeExpr();
  assert.equal(op, 'interpolate');
  assert.deepEqual(interp, ['linear']);
  assert.deepEqual(zoom, ['zoom']);
  assert.equal(zLo, Z_LO); // s = 1 ⇒ сдвига нет
  assert.equal(zHi, Z_HI);
  assert.equal(aLo, markerZoomScale(Z_LO));
  assert.equal(aHi, markerZoomScale(Z_HI));
});

test('markerZoomSizeExpr: усадка поверхности множит ОБА конца кривой', () => {
  // Калька карточки мельче финального слота: пин обязан ужаться ровно во
  // столько же раз на любом зуме, иначе превью перестаёт быть превью.
  const s = 0.4;
  const full = markerZoomSizeExpr();
  const small = markerZoomSizeExpr(s);
  assert.equal(small[4], full[4] * s);
  assert.equal(small[6], full[6] * s);
});

test('markerZoomSizeExpr: на узкой поверхности стопы съезжают на log2(s)', () => {
  // Дефект, который это сторожит, невидим: калька продолжает рисовать пины,
  // просто мельче, чем будет в файле — «превью == финал» рвётся молча.
  const { Z_LO, Z_HI } = MARKER_ZOOM_SCALE;
  const s = 0.25; // калька вчетверо уже слота ⇒ та же сцена на 2 зума ниже
  const e = markerZoomSizeExpr(s);
  assert.equal(e[3], Z_LO - 2);
  assert.equal(e[5], Z_HI - 2);
});

test('markerZoomSizeExpr: калька и слот дают ОДИН относительный размер на одной сцене', () => {
  // Главное свойство, ради которого сдвиг и заведён: доля пина от ширины
  // поверхности обязана совпасть на кальке и на слоте для ОДНОЙ И ТОЙ ЖЕ сцены.
  const slotZoom = 5.69; // кадр «Классическая Италия» на слоте 810 px
  const s = 194 / 810;
  const previewZoom = slotZoom + Math.log2(s); // та же сцена на кальке 194 px
  /** Значение interpolate-выражения на зуме z. */
  const at = (e, z) => {
    const [, , , z0, a0, z1, a1] = e;
    const t = Math.max(0, Math.min(1, (z - z0) / (z1 - z0)));
    return a0 + t * (a1 - a0);
  };
  const onSlot = at(markerZoomSizeExpr(), slotZoom);       // доля от 810
  const onPreview = at(markerZoomSizeExpr(s), previewZoom); // доля от 194
  assert.ok(Math.abs(onPreview / s - onSlot) < 1e-9,
    `калька ${onPreview} при усадке ${s} не сводится к слоту ${onSlot}`);
});

test('cityPoints: номер несут ТОЛЬКО города, роли — нет; нумерация сквозная', () => {
  const pts = cityPoints([
    { id: 'a', kind: 'start', latitude: 1, longitude: 2 },
    { id: 'b', kind: 'transit', latitude: 3, longitude: 4 },
    { id: 'c', kind: 'waypoint', latitude: 5, longitude: 6 },
    { id: 'd', kind: undefined, latitude: 7, longitude: 8 }, // легаси-строка = город
    { id: 'e', kind: 'end', latitude: 9, longitude: 10 },
  ]);
  assert.deepEqual(pts.map((p) => p.label), [null, '1', null, '2', null]);
  // Координаты переезжают в язык маркеров (lng/lat), данные визита — в `data`.
  assert.deepEqual([pts[1].lng, pts[1].lat], [4, 3]);
  assert.equal(pts[1].data.id, 'b');
});

test('cityPoints: пустой/отсутствующий вход — пустой список, не падение', () => {
  assert.deepEqual(cityPoints([]), []);
  assert.deepEqual(cityPoints(undefined), []);
});

// ── вес метки под размер полотна ─────────────────────────────────────────────
// Дефект, который это сторожит, тоже молчит: метки продолжают рисоваться, просто
// на широком полотне весят вдвое меньше, чем на эталонном, — и «не видно» ловится
// только глазами на готовой картинке.

test('markerSurfaceWeight: эталонное полотно = канон, вдвое шире = вдвое тяжелее', () => {
  assert.equal(markerSurfaceWeight(MARKER_REF_WIDTH), 1);
  assert.equal(markerSurfaceWeight(MARKER_REF_WIDTH * 2), 2);
});

test('markerSurfaceWeight: узкое полотно НЕ измельчает метки ниже канона', () => {
  // Ниже эталона правило перестаёт действовать: узкая карта — повод оставить
  // канон, а не ужать пин до нечитаемости.
  assert.equal(markerSurfaceWeight(MARKER_REF_WIDTH / 3), 1);
  assert.equal(markerSurfaceWeight(0), 1);
  assert.equal(markerSurfaceWeight(undefined), 1);
});

test('markerZoomSizeExpr: вес множит амплитуду и НЕ трогает стопы', () => {
  // Разделение несущее: стопы отвечают на «какой зум у финала», вес — на
  // «насколько жирно рисовать». Смешать их значило бы двигать кадр размером.
  const s = 0.25;
  const plain = markerZoomSizeExpr(s);
  const heavy = markerZoomSizeExpr(s, 2);
  assert.equal(heavy[3], plain[3]);
  assert.equal(heavy[5], plain[5]);
  assert.equal(heavy[4], plain[4] * 2);
  assert.equal(heavy[6], plain[6] * 2);
});

test('вес полотна выравнивает метку карточки с меткой приложения', () => {
  // Смысл всего правила одним числом: доля пина от ширины карты на слоте
  // карточки обязана сойтись с долей на эталонной карте приложения.
  const slot = 810;
  const share = (px, w) => px / w;
  const canon = share(29, MARKER_REF_WIDTH);
  const card = share(29 * markerSurfaceWeight(slot), slot);
  assert.ok(Math.abs(card - canon) < 1e-9, `карточка ${card} != канон ${canon}`);
});
