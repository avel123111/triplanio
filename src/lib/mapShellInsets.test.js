import test from 'node:test';
import assert from 'node:assert/strict';
import { mapShellInsets } from './mapShellInsets.js';

const NONE = { top: 0, right: 0, bottom: 0, left: 0 };

test('★★ ТЕЛЕФОН: шит режет ВЫСОТУ ОТСТУПОМ КАМЕРЫ, холст не трогаем', () => {
  // Холст, меняющий размер вслед за шитом, стоил трёх дефектов сразу: полосы
  // фона на всё время жеста, телепорта на Δ/2 от `map.resize()` и предельного
  // зума, посчитанного в 20-пиксельную щель верхнего детента. Разбор — в модуле.
  assert.deepEqual(mapShellInsets({ phone: true, sheetPx: 612 }),
    { contentBottom: 612, camera: { ...NONE, bottom: 612 } });
  assert.deepEqual(mapShellInsets({ phone: true, sheetPx: 135 }),
    { contentBottom: 135, camera: { ...NONE, bottom: 135 } });
});

test('★★ ДЕСКТОП: панель режет ШИРИНУ — тем же механизмом, другой стороной', () => {
  assert.deepEqual(mapShellInsets({ panelPx: 550 }), { contentBottom: 0, camera: { ...NONE, left: 550 } });
});

test('свёрнутая панель не закрывает ничего', () => {
  assert.deepEqual(mapShellInsets({ panelPx: 550, collapsed: true }), { contentBottom: 0, camera: NONE });
});

test('★ открытый слой закрывает колонку — и при свёрнутом маршруте (булев флаг)', () => {
  assert.deepEqual(mapShellInsets({ panelPx: 550, collapsed: true, overlayOpen: true }),
    { contentBottom: 0, camera: { ...NONE, left: 550 } });
  assert.deepEqual(mapShellInsets({ panelPx: 550, overlayOpen: true }),
    { contentBottom: 0, camera: { ...NONE, left: 550 } });
  assert.deepEqual(mapShellInsets({ panelPx: 550, collapsed: true, overlayOpen: false }),
    { contentBottom: 0, camera: NONE });
});

test('★ режимы не смешиваются: чужая величина не читается', () => {
  // Шит в портале успевает подержать прошлую высоту на переходе в десктоп —
  // прочитать её значит отрезать у десктопной карты низ по призраку.
  assert.deepEqual(mapShellInsets({ phone: false, sheetPx: 612, panelPx: 550 }),
    { contentBottom: 0, camera: { ...NONE, left: 550 } });
  assert.deepEqual(mapShellInsets({ phone: true, sheetPx: 612, panelPx: 550 }),
    { contentBottom: 612, camera: { ...NONE, bottom: 612 } });
});

test('★ ГРАНИЦА СОДЕРЖИМОГО И ОТСТУП КАМЕРЫ — ОДНА ВЕЛИЧИНА, А НЕ ДВЕ', () => {
  // Их разъезд и был прежним `slotUnder`: у элемента поверх карты «низ карты»
  // отличался от «низа свободного окна» на радиус скруглений, и пилюля
  // планировщика оказывалась лежащей на шите. Теперь величина одна на обоих.
  for (const sheet of [612, 135, 12, 0, 900]) {
    const box = mapShellInsets({ phone: true, sheetPx: sheet });
    assert.equal(box.contentBottom, box.camera.bottom, `${sheet}`);
  }
});

test('★ немеряное вырождается в «карта во всю площадь», а не в минус', () => {
  for (const bad of [0, -40, NaN, Infinity, undefined, null, '550']) {
    assert.deepEqual(mapShellInsets({ phone: true, sheetPx: /** @type {any} */ (bad) }),
      { contentBottom: 0, camera: NONE });
    assert.deepEqual(mapShellInsets({ panelPx: /** @type {any} */ (bad) }),
      { contentBottom: 0, camera: NONE });
  }
});

test('дробные измерения округляются (пиксель — целое)', () => {
  assert.equal(mapShellInsets({ phone: true, sheetPx: 611.6 }).camera.bottom, 612);
  assert.equal(mapShellInsets({ panelPx: 549.6 }).camera.left, 550);
});

test('без аргументов — карта во всю площадь', () => {
  assert.deepEqual(mapShellInsets(), { contentBottom: 0, camera: NONE });
});
