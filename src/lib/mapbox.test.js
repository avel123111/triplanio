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

test('★★★ В РАСЧЁТ КАДРА — ОТСТУП, В КАМЕРУ — СДВИГ. `padding` В КАМЕРУ НЕ УХОДИТ НИКОГДА', () => {
  // ГЛАВНОЕ правило этого файла, и оно куплено дорого. `transform.padding` на
  // проекции `globe` ломает рендер: движок рисует планету ДИСКОМ и оставляет
  // остальной канвас ПРОЗРАЧНЫМ, сквозь него видна подложка элемента — те самые
  // «круги и заливка вокруг глобуса». Замер: холст 446x600, зум 4, отступ снизу
  // 456 → диск радиусом ~215px; на зуме 5 диск заметно больше; на `mercator`
  // дефекта нет. Поэтому закрытая площадь уходит в камеру СДВИГОМ ЦЕНТРА.
  //
  // В РАСЧЁТ (`cameraForBounds`) отступ по-прежнему уходит, и это другое: там
  // он только уменьшает коробку и состояния карты не касается.
  const m = fakeMap();
  setMapInsets(m, { left: 550 });
  fitToPoints(m, [[0, 0], [20, 40]], { padding: 60, maxZoom: 8 });

  assert.deepEqual(call(m, 'cameraForBounds').padding, { top: 60, right: 60, bottom: 60, left: 610 },
    'расчёт кадра обязан знать и воздух, и закрытую площадь');
  assert.equal(call(m, 'flyTo').padding, undefined,
    '★ в камеру `padding` не передаётся ВООБЩЕ — он ломает глобус');
  assert.deepEqual(call(m, 'flyTo').offset, [275, 0],
    'панель слева на 550 → цель уезжает вправо на половину закрытого');
});

test('закрытой площади нет — сдвига нет', () => {
  const m = fakeMap();
  setMapInsets(m, null);
  fitToPoints(m, [[0, 0], [20, 40]], { padding: 60 });
  assert.deepEqual(call(m, 'cameraForBounds').padding, { top: 60, right: 60, bottom: 60, left: 60 });
  assert.equal(call(m, 'flyTo').padding, undefined);
  assert.deepEqual(call(m, 'flyTo').offset, [0, 0]);
});

test('★ одиночная точка встаёт по центру СВОБОДНОГО окна', () => {
  // Для одной точки вписывать нечего, и сдвиг — единственное, что уводит её
  // из-под виджета.
  const m = fakeMap();
  setMapInsets(m, { bottom: 612 });
  fitToPoints(m, [[7, 8]], { singleZoom: 9 });
  const ease = call(m, 'easeTo');
  assert.deepEqual(ease.center, [7, 8]);
  assert.equal(ease.zoom, 9);
  assert.equal(ease.padding, undefined);
  assert.deepEqual(ease.offset, [0, -306], 'шит снизу на 612 → цель уезжает вверх на половину');
  assert.equal(call(m, 'cameraForBounds'), undefined, 'одну точку через bounds не гоняем');
});

test('★ ручной сдвиг вызывателя СКЛАДЫВАЕТСЯ с нашим, а не заменяет его', () => {
  const m = fakeMap();
  setMapInsets(m, { bottom: 400 });
  fitToPoints(m, [[7, 8]], { offset: [10, -30] });
  assert.deepEqual(call(m, 'easeTo').offset, [10, -230]);
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
