import test from 'node:test';
import assert from 'node:assert/strict';
import { cameraForPoints, clampPadding, fitToPoints } from './mapbox.js';
import { setMapInsets } from './map/insets.js';

/** Карта-заглушка: записывает, ЧЕМ её позвали. Проверяем именно вызовы. */
function fakeMap({ W = 1280, H = 900, zoom = 3, cam = { center: { lng: 10, lat: 20 }, zoom: 4 } } = {}) {
  const calls = [];
  return {
    calls,
    getContainer: () => ({ clientWidth: W, clientHeight: H }),
    getZoom: () => zoom,
    getCenter: () => ({ lng: 0, lat: 0 }),
    project: () => ({ x: 0, y: 0 }),
    cameraForBounds: (b, opts) => { calls.push(['cameraForBounds', opts]); return cam; },
    flyTo: (o) => { calls.push(['flyTo', o]); },
    easeTo: (o) => { calls.push(['easeTo', o]); },
  };
}
const call = (m, name) => m.calls.find(([n]) => n === name)?.[1];

test('★★ В ФИТ УХОДИТ СУММА, В ПОВЕРХНОСТЬ — ТОЛЬКО ЗАКРЫТАЯ ПЛОЩАДЬ', () => {
  // Ровно то правило, которое нарушает штатный `map.fitBounds`: он кладёт
  // отступ фита (с ВОЗДУХОМ) и в расчёт, и в состояние карты — и состояние
  // молча уезжает на величину воздуха при каждом кадрировании.
  const m = fakeMap();
  setMapInsets(m, { left: 550 });
  fitToPoints(m, [[0, 0], [20, 40]], { padding: 60, maxZoom: 8 });

  assert.deepEqual(call(m, 'cameraForBounds').padding, { top: 60, right: 60, bottom: 60, left: 610 },
    'расчёт кадра обязан знать и воздух, и закрытую площадь');
  assert.deepEqual(call(m, 'flyTo').padding, { top: 0, right: 0, bottom: 0, left: 550 },
    'состояние карты — ТОЛЬКО закрытая площадь, без воздуха');
});

test('закрытой площади нет — отступ поверхности нулевой', () => {
  const m = fakeMap();
  setMapInsets(m, null);
  fitToPoints(m, [[0, 0], [20, 40]], { padding: 60 });
  assert.deepEqual(call(m, 'cameraForBounds').padding, { top: 60, right: 60, bottom: 60, left: 60 });
  assert.deepEqual(call(m, 'flyTo').padding, { top: 0, right: 0, bottom: 0, left: 0 });
});

test('★ одиночная точка встаёт по центру СВОБОДНОГО окна', () => {
  // Для одной точки вписывать нечего, и отступ поверхности — единственное, что
  // уводит её из-под виджета. Раньше это делал ручной `offset` у вызывателя.
  const m = fakeMap();
  setMapInsets(m, { bottom: 612 });
  fitToPoints(m, [[7, 8]], { singleZoom: 9 });
  const ease = call(m, 'easeTo');
  assert.deepEqual(ease.center, [7, 8]);
  assert.equal(ease.zoom, 9);
  assert.deepEqual(ease.padding, { top: 0, right: 0, bottom: 612, left: 0 });
  assert.equal(call(m, 'cameraForBounds'), undefined, 'одну точку через bounds не гоняем');
});

test('★ singleZoom не режется потолком maxZoom — они про разное', () => {
  // Планировщик просит singleZoom 8 при maxZoom 7, и это не опечатка: потолок
  // ограничивает ВПИСЫВАНИЕ набора, а у одной точки вписывать нечего.
  const m = fakeMap();
  setMapInsets(m, null);
  assert.equal(cameraForPoints(m, [[1, 2]], { singleZoom: 8, maxZoom: 7 }).zoom, 8);
});

test('потолок зума применяется к вписыванию набора', () => {
  const m = fakeMap({ cam: { center: { lng: 1, lat: 2 }, zoom: 11 } });
  setMapInsets(m, null);
  assert.equal(cameraForPoints(m, [[0, 0], [1, 1]], { maxZoom: 8 }).zoom, 8);
});

test('★ вписать нельзя — молчим, а не ставим камеру наугад', () => {
  // `cameraForBounds` отказывает (возвращает undefined) и пишет warnOnce. Раньше
  // за нас это проглатывал `fitBounds`; теперь отказ обязан быть явным.
  const m = fakeMap({ cam: null });
  setMapInsets(m, null);
  fitToPoints(m, [[0, 0], [1, 1]], { padding: 60 });
  assert.equal(m.calls.filter(([n]) => n === 'flyTo' || n === 'easeTo').length, 0);
});

test('★ кламп режет отступ ПО ОСЯМ, оставляя полосу канваса', () => {
  // Асимметричный отступ — основной случай (им выражается панель), и закон у
  // каждой оси свой: сумма противоположных сторон не имеет права съесть канвас.
  const m = fakeMap({ W: 400, H: 300 });
  const out = clampPadding(m, { left: 350, right: 100, top: 10, bottom: 10 });
  assert.ok(out.left + out.right <= 400 - 80, `по X осталось ${400 - out.left - out.right}`);
  assert.ok(out.left > out.right, 'пропорция сторон сохраняется');
  assert.deepEqual({ top: out.top, bottom: out.bottom }, { top: 10, bottom: 10 }, 'ось, где места хватает, не трогается');
});

test('кламп на неизмеренном контейнере отдаёт коробку как есть', () => {
  const m = fakeMap({ W: 0, H: 0 });
  assert.deepEqual(clampPadding(m, 48), { top: 48, right: 48, bottom: 48, left: 48 });
});

test('★ линейный режим — ровный наезд, а не дуга', () => {
  // Смена отступа под осадку детента обязана ехать `easeTo`: дуга `flyTo` на
  // коротком ходе читается как рывок.
  const m = fakeMap();
  setMapInsets(m, { bottom: 300 });
  fitToPoints(m, [[0, 0], [5, 5]], { padding: 40, linear: true, duration: 320 });
  assert.ok(call(m, 'easeTo'), 'linear → easeTo');
  assert.equal(call(m, 'flyTo'), undefined);
  assert.equal(call(m, 'easeTo').duration, 320);
});
